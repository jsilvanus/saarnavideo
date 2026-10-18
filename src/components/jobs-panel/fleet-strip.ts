import type { Translate } from "./job-panel";

/**
 * The numbers behind the one-line fleet strip in the job panel. Every block is optional so a missing source
 * (no fleet configured, no speech-to-text key, orchestrator without admin rights) just leaves its part out.
 */
export type FleetPool = { name: string; instances: number; max: number };

export type FleetStripData = {
  /** An fffleet orchestrator is configured (FFFLEET_URL). `offline` = it did not answer. */
  fleet: null | { state: "ok" | "offline"; workers?: number; slotsUsed?: number; slotsTotal?: number; queued?: number; draining?: number; pools?: FleetPool[] };
  /** No fleet: the worker processes of this app (live worker leases) and the job lanes they run. */
  local: null | { workers: number; lanes: number };
  /** The app's own MediaJobs (publications are not counted). */
  app: { running: number; queued: number };
  /** Speech-to-text service queue from its /status; null when unavailable. */
  stt: null | { queued: number; running: number };
};

/** The strip as parts; the panel joins them with a middle dot. */
export function fleetStripParts(data: FleetStripData, t: Translate): string[] {
  const parts: string[] = [];
  const { fleet, local } = data;
  if (fleet?.state === "offline") parts.push(t("fleetStrip.offline"));
  else if (fleet) {
    if (fleet.workers !== undefined) parts.push(t("fleetStrip.workers", { count: fleet.workers }));
    if (fleet.slotsTotal !== undefined) parts.push(t("fleetStrip.slots", { used: fleet.slotsUsed ?? 0, total: fleet.slotsTotal }));
    if (fleet.queued !== undefined) parts.push(t("fleetStrip.queue", { count: fleet.queued }));
    if (fleet.draining) parts.push(t("fleetStrip.draining", { count: fleet.draining }));
    for (const pool of fleet.pools ?? []) parts.push(`${pool.name} ${pool.instances}/${pool.max}`);
  } else if (local) {
    parts.push(t("fleetStrip.local"));
    parts.push(t("fleetStrip.localWorkers", { count: local.workers }));
    parts.push(t("fleetStrip.lanes", { used: Math.min(data.app.running, local.lanes), total: local.lanes }));
  }
  parts.push(t("fleetStrip.app", { running: data.app.running, queued: data.app.queued }));
  if (data.stt) parts.push(data.stt.running > 0 ? t("fleetStrip.sttBusy", { running: data.stt.running, queued: data.stt.queued }) : t("fleetStrip.stt", { queued: data.stt.queued }));
  return parts;
}

export const formatFleetStrip = (data: FleetStripData, t: Translate): string => fleetStripParts(data, t).join(" · ");

/** Summarises the orchestrator's answers into the fleet block. `workers` and `pools` are the admin-only lists (null when refused). */
export function summariseFleet(
  capabilities: { workers?: number; slots?: Record<string, { total: number; used: number }>; queued?: number },
  workers: { workers?: Array<{ draining?: boolean; slots?: Record<string, number>; used?: Record<string, number> }> } | null,
  pools: { pools?: Array<{ name: string; instances: number; max: number }> } | null,
): NonNullable<FleetStripData["fleet"]> {
  const sum = (values: Array<{ total: number; used: number }>) => values.reduce((acc, v) => ({ total: acc.total + v.total, used: acc.used + v.used }), { total: 0, used: 0 });
  let slots = sum(Object.values(capabilities.slots ?? {}));
  let count = capabilities.workers;
  let draining: number | undefined;
  if (workers?.workers) {
    // Slots of a draining worker take no new work: they do not count as capacity.
    const list = workers.workers;
    count = list.length;
    draining = list.filter(w => w.draining).length;
    slots = sum(list.filter(w => !w.draining).map(w => ({ total: Object.values(w.slots ?? {}).reduce((a, b) => a + b, 0), used: Object.values(w.used ?? {}).reduce((a, b) => a + b, 0) })));
  }
  return {
    state: "ok",
    workers: count,
    slotsUsed: slots.used,
    slotsTotal: slots.total,
    queued: capabilities.queued,
    ...(draining ? { draining } : {}),
    ...(pools?.pools?.length ? { pools: pools.pools.map(p => ({ name: p.name, instances: p.instances, max: p.max })) } : {}),
  };
}
