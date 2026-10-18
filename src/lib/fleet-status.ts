import { createTokenProvider } from "fffleet";
import { AuditorSttClient } from "@/integrations/auditorStt/client";
import { summariseFleet, type FleetStripData } from "@/components/jobs-panel/fleet-strip";
import { prisma } from "@/lib/prisma";

/**
 * Data for the fleet strip in the job panel (GET /api/fleet/status). Nothing here reaches the browser except
 * numbers: the orchestrator address, token and client secret stay on the server.
 */

export const FLEET_TIMEOUT_MS = 1500;
export const FLEET_CACHE_MS = 2000;
const WORKER_LEASE_PREFIX = "worker:";

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;
export type FleetStatus = { enabled: false } | ({ enabled: true } & FleetStripData);

/** True unless `FLEET_STRIP=0` (or `false`/`off`) turns the strip off. */
export const fleetStripEnabled = (env: Env = process.env) => !["0", "false", "off"].includes((env.FLEET_STRIP ?? "").toLowerCase());

type Credentials = { url: string; token?: string; clientId?: string; clientSecret?: string };

/** Orchestrator address and credentials from the same variables as the render executor (not S3: the strip only reads). */
export function fleetCredentials(env: Env = process.env): Credentials | null {
  const url = env.FFFLEET_URL?.trim();
  if (!url) return null;
  return { url: url.replace(/\/+$/, ""), token: env.FFFLEET_TOKEN || undefined, clientId: env.FFFLEET_CLIENT_ID || undefined, clientSecret: env.FFFLEET_CLIENT_SECRET || undefined };
}

const tokenProviders = new Map<string, ReturnType<typeof createTokenProvider>>();

async function authorization(cred: Credentials, f: FetchLike, refresh = false): Promise<Record<string, string>> {
  if (cred.clientId && cred.clientSecret) {
    const key = `${cred.url}|${cred.clientId}|${cred.clientSecret}`;
    let provider = tokenProviders.get(key);
    if (!provider) {
      // No scope asked: the token carries all the client's scopes, so admin routes work when the client has admin.
      provider = createTokenProvider({ url: cred.url, clientId: cred.clientId, clientSecret: cred.clientSecret, fetch: f, timeoutMs: FLEET_TIMEOUT_MS });
      tokenProviders.set(key, provider);
    }
    return { authorization: `Bearer ${await provider.get({ refresh })}` };
  }
  return cred.token ? { authorization: `Bearer ${cred.token}` } : {};
}

class HttpFailure extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

async function getJson<T>(cred: Credentials, path: string, f: FetchLike): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(`${cred.url}${path}`, { headers: await authorization(cred, f, attempt > 0), signal: AbortSignal.timeout(FLEET_TIMEOUT_MS), cache: "no-store" });
    // An expired token: log in once more.
    if (res.status === 401 && attempt === 0 && cred.clientId) continue;
    if (!res.ok) throw new HttpFailure(res.status);
    return (await res.json()) as T;
  }
}

type Caps = Parameters<typeof summariseFleet>[0];
type Workers = NonNullable<Parameters<typeof summariseFleet>[1]>;
type Pools = NonNullable<Parameters<typeof summariseFleet>[2]>;

/** Asks the orchestrator. Capabilities are required; workers and pools need an admin login and are skipped on 401/403 or any failure. */
export async function readFleet(cred: Credentials, f: FetchLike = fetch): Promise<NonNullable<FleetStripData["fleet"]>> {
  const [caps, workers, pools] = await Promise.allSettled([
    getJson<Caps>(cred, "/v1/capabilities", f),
    getJson<Workers>(cred, "/v1/workers", f),
    getJson<Pools>(cred, "/v1/pools", f),
  ]);
  if (caps.status === "rejected") return { state: "offline" };
  return summariseFleet(caps.value, workers.status === "fulfilled" ? workers.value : null, pools.status === "fulfilled" ? pools.value : null);
}

/** Queue of the speech-to-text service, or null when it is not configured or does not answer. */
export async function readStt(env: Env = process.env): Promise<FleetStripData["stt"]> {
  if (!env.AUDITOR_STT_URL || !env.AUDITOR_STT_API_KEY) return null;
  try {
    const status = await new AuditorSttClient({ baseUrl: env.AUDITOR_STT_URL, apiKey: env.AUDITOR_STT_API_KEY, requestTimeoutMs: FLEET_TIMEOUT_MS }).getServiceStatus();
    return status.jobs ? { queued: status.jobs.queued, running: status.jobs.running } : null;
  } catch {
    return null;
  }
}

type Cached = { at: number; fleet: FleetStripData["fleet"]; stt: FleetStripData["stt"] };
let cache: Cached | null = null;
let inflight: Promise<Cached> | null = null;
export const resetFleetStatusCache = () => { cache = null; inflight = null; };

/** The outside part (orchestrator, speech-to-text), shared by all callers for FLEET_CACHE_MS. */
async function outside(env: Env, f: FetchLike, now: number): Promise<Cached> {
  if (cache && now - cache.at < FLEET_CACHE_MS) return cache;
  inflight ??= (async () => {
    const cred = fleetCredentials(env);
    const [fleet, stt] = await Promise.all([cred ? readFleet(cred, f) : Promise.resolve(null), readStt(env)]);
    cache = { at: Date.now(), fleet, stt };
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Job lanes per worker, as the worker computes them. */
export function workerLanes(env: Env = process.env): number {
  return Math.max(1, Number(env.MAX_CONCURRENT_JOBS ?? (env.RENDER_EXECUTOR === "fffleet" ? 4 : 1)) || 1);
}

export async function getFleetStatus(env: Env = process.env, f: FetchLike = fetch, now = Date.now()): Promise<FleetStatus> {
  if (!fleetStripEnabled(env)) return { enabled: false };
  const [grouped, ext, leases] = await Promise.all([
    prisma.mediaJob.groupBy({ by: ["status"], where: { status: { in: ["QUEUED", "RUNNING"] } }, _count: { _all: true } }),
    outside(env, f, now),
    prisma.lease.count({ where: { name: { startsWith: WORKER_LEASE_PREFIX }, expiresAt: { gt: new Date() } } }),
  ]);
  const count = (status: string) => grouped.find(row => row.status === status)?._count._all ?? 0;
  return {
    enabled: true,
    fleet: ext.fleet,
    local: ext.fleet ? null : { workers: leases, lanes: Math.max(leases, 1) * workerLanes(env) },
    app: { running: count("RUNNING"), queued: count("QUEUED") },
    stt: ext.stt,
  };
}
