import type { JobQueueInfo } from "@/integrations/auditorStt/client";

/** Wall-clock `HH:MM` of `at` in the worker's time zone (set `TZ` on the worker to show local time). */
export function clockTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/**
 * The text a queued auditor job gets as the MediaJob message, for example `STT: position 2, starts about 14:35`.
 * Only the position is shown when the service has no estimate; an estimate that is a lower bound (live captions
 * are running) says so. Null when the service sent no queue block (older service).
 */
export function sttQueueMessage(queue: JobQueueInfo | null | undefined, now: Date = new Date()): string | null {
  if (!queue || !Number.isFinite(queue.position)) return null;
  const parts = [`STT: position ${queue.position}`];
  const wait = queue.estimated_start_seconds;
  if (wait !== null && wait !== undefined && Number.isFinite(wait)) {
    const at = clockTime(new Date(now.getTime() + wait * 1000));
    parts.push(wait < 30 ? "starts soon" : `starts about ${at}${queue.estimate_is_minimum ? " or later (live captions running)" : ""}`);
  } else if (queue.estimate_is_minimum) {
    parts.push("live captions running");
  }
  return parts.join(", ");
}
