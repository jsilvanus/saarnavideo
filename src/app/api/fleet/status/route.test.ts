import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetFleetStatusCache } from "@/lib/fleet-status";
import { GET } from "./route";

type Seen = { path: string; auth: string | undefined };

/** A fake fffleet orchestrator: capabilities for any login, workers/pools only for an admin token. */
function startOrchestrator() {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const path = req.url ?? "";
    const auth = req.headers.authorization;
    seen.push({ path, auth });
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (path === "/v1/auth/token") return send(200, { access_token: "client-token", expires_in: 3600 });
    if (auth !== "Bearer admin" && auth !== "Bearer client-token") return send(401, { error: { code: "UNAUTHORIZED" } });
    if (path === "/v1/capabilities") return send(200, { role: "orchestrator", workers: 3, slots: { default: { total: 8, used: 5 } }, queued: 2, capabilities: [] });
    if (auth !== "Bearer admin") return send(403, { error: { code: "FORBIDDEN" } });
    if (path === "/v1/workers") return send(200, { workers: [{ id: "a", slots: { default: 4 }, used: { default: 3 } }, { id: "b", slots: { default: 2 }, used: { default: 2 } }, { id: "c", slots: { default: 2 }, used: {} }] });
    if (path === "/v1/pools") return send(200, { pools: [{ name: "hetzner", instances: 1, max: 5 }] });
    send(404, {});
  });
  return new Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }>(resolve => server.listen(0, "127.0.0.1", () =>
    resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise(done => server.close(() => done())) })));
}

const KEYS = ["FFFLEET_URL", "FFFLEET_TOKEN", "FFFLEET_CLIENT_ID", "FFFLEET_CLIENT_SECRET", "FLEET_STRIP", "AUDITOR_STT_URL", "AUDITOR_STT_API_KEY"] as const;

describe("GET /api/fleet/status", () => {
  const saved: Record<string, string | undefined> = {};
  let orch: Awaited<ReturnType<typeof startOrchestrator>>;
  let projectId: string;
  beforeAll(async () => { orch = await startOrchestrator(); });
  afterAll(async () => { await orch.close(); });
  beforeEach(async () => {
    for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
    resetFleetStatusCache();
    orch.seen.length = 0;
    projectId = (await prisma.project.create({ data: { title: "Fleet status test", definition: {} } })).id;
  });
  afterEach(async () => {
    for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    vi.unstubAllGlobals();
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });
  type Body = { enabled: boolean; fleet: unknown; local: { lanes: number } | null; app: { running: number; queued: number }; stt: unknown };
  const call = async () => (await GET()).json() as Promise<Body>;

  it("reads capabilities, workers and pools with an admin token and never returns the address or the token", async () => {
    process.env.FFFLEET_URL = orch.url;
    process.env.FFFLEET_TOKEN = "admin";
    const raw = JSON.stringify(await call());
    resetFleetStatusCache();
    const body = JSON.parse(JSON.stringify(await call()));
    expect(body.enabled).toBe(true);
    expect(body.fleet).toEqual({ state: "ok", workers: 3, slotsUsed: 5, slotsTotal: 8, queued: 2, pools: [{ name: "hetzner", instances: 1, max: 5 }] });
    expect(body.local).toBeNull();
    expect(raw).not.toContain("admin");
    expect(raw).not.toContain(orch.url);
  });

  it("falls back to capabilities when the client login has no admin scope (403)", async () => {
    process.env.FFFLEET_URL = orch.url;
    process.env.FFFLEET_CLIENT_ID = "app";
    process.env.FFFLEET_CLIENT_SECRET = "s3cret";
    const body = await call();
    expect(body.fleet).toEqual({ state: "ok", workers: 3, slotsUsed: 5, slotsTotal: 8, queued: 2 });
    expect(orch.seen.some(s => s.path === "/v1/auth/token")).toBe(true);
    expect(orch.seen.find(s => s.path === "/v1/workers")?.auth).toBe("Bearer client-token");
  });

  it("caches the orchestrator answer for two seconds", async () => {
    process.env.FFFLEET_URL = orch.url;
    process.env.FFFLEET_TOKEN = "admin";
    await call(); await call(); await call();
    expect(orch.seen.filter(s => s.path === "/v1/capabilities")).toHaveLength(1);
  });

  it("reports the fleet as offline when it does not answer", async () => {
    process.env.FFFLEET_URL = "http://127.0.0.1:1";
    expect((await call()).fleet).toEqual({ state: "offline" });
  });

  it("without FFFLEET_URL shows the local worker lanes and the app's own queue", async () => {
    await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "QUEUED" } });
    await prisma.mediaJob.create({ data: { projectId, type: "VIDEO", status: "RUNNING" } });
    const body = await call();
    expect(body.fleet).toBeNull();
    expect(body.local?.lanes).toBeGreaterThanOrEqual(1);
    expect(body.app.queued).toBeGreaterThanOrEqual(1);
    expect(body.app.running).toBeGreaterThanOrEqual(1);
    expect(body.stt).toBeNull();
  });

  it("adds the speech-to-text queue from the auditor /status, and omits it silently on failure", async () => {
    const auditor = http.createServer((req, res) => {
      if (req.headers.authorization !== "Bearer key") { res.writeHead(401).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ queue: {}, model: {}, jobs: { queued: 1, running: 0, queued_seconds: 60, unknown_duration: 0 }, rate: 2, rate_samples: 3, live: null }));
    });
    await new Promise<void>(resolve => auditor.listen(0, "127.0.0.1", () => resolve()));
    try {
      process.env.AUDITOR_STT_URL = `http://127.0.0.1:${(auditor.address() as AddressInfo).port}`;
      process.env.AUDITOR_STT_API_KEY = "key";
      expect((await call()).stt).toEqual({ queued: 1, running: 0 });
      process.env.AUDITOR_STT_API_KEY = "wrong";
      resetFleetStatusCache();
      expect((await call()).stt).toBeNull();
    } finally {
      await new Promise(resolve => auditor.close(resolve));
    }
  });

  it("FLEET_STRIP=0 turns it off and asks nobody", async () => {
    process.env.FFFLEET_URL = orch.url;
    process.env.FLEET_STRIP = "0";
    expect(await call()).toEqual({ enabled: false });
    expect(orch.seen).toHaveLength(0);
  });
});
