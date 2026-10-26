import type { LcytManifest } from "@/domain/lcyt-manifest";

/** A manifest as LCYT serves it (refs resolved to https links). Synthetic: no real service, names or recordings. */
export function sampleManifest(overrides: Record<string, unknown> = {}, base = "https://lcyt.example/api/v1/handoff/g1/files"): Record<string, unknown> {
  return {
    version: 1,
    origin: { system: "lcyt", instance: "https://lcyt.example", broadcastId: 7, videoId: 11, groupId: "g1" },
    title: "Test broadcast",
    startedAt: "2026-10-11T08:00:12.480Z",
    endedAt: "2026-10-11T09:12:03.100Z",
    timeAlignment: "recorded",
    feeds: [
      { role: "clean", width: 320, height: 180, fps: 25, hasAlpha: false, parts: [{ ref: `${base}/clean-1.mp4?token=t`, startMs: 0, durationMs: 4000 }] },
      { role: "program", width: 320, height: 180, fps: 25, hasAlpha: false, parts: [{ ref: `${base}/program-1.mp4?token=t`, startMs: 1500, durationMs: 4000 }] },
      { role: "dsk", width: 320, height: 180, fps: 25, hasAlpha: false, key: { enabled: true, color: "#00B140", similarity: 0.3, blend: 0.1 }, parts: [{ ref: `${base}/dsk-1.mp4?token=t`, startMs: 1500, durationMs: 4000 }] },
    ],
    captions: [{ language: "fi", format: "vtt", ref: `${base}/captions.fi.vtt?token=t`, alignedTo: "clean" }],
    dskEvents: { ref: `${base}/dsk-events.json?token=t`, count: 2 },
    markers: [],
    variables: { title: "Test broadcast", date: "2026-10-11" },
    ...overrides,
  };
}

export type { LcytManifest };
