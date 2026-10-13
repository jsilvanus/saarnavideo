import { z } from "zod";

/**
 * Handoff manifest v1 from LCYT (the contract is owned by live-captions-yt, `docs/plans/plan_saarnavideo_handoff.md`,
 * `packages/lcyt-backend/src/handoff/manifest.js`). This is a copy: unknown fields are dropped, so LCYT can add fields
 * without breaking the import. All times are milliseconds on the clean feed's timeline (t = 0 is its first frame).
 */
export const MANIFEST_VERSION = 1;

const httpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), "Must be an http(s) URL");
const ms = z.number().finite().nonnegative();

export const feedRoleSchema = z.enum(["clean", "program", "dsk"]);
export type ManifestRole = z.infer<typeof feedRoleSchema>;

export const feedPartSchema = z.object({
  /** Download link (LCYT resolves its relative file names to signed https links when it serves the manifest). */
  ref: httpUrl,
  /** Where this part starts on the clean feed's timeline. */
  startMs: ms,
  /** Where this part starts inside the feed's own recording (only meaningful to LCYT). */
  playlistStartMs: ms.optional(),
  durationMs: ms,
});

export const keyParamsSchema = z.object({
  enabled: z.boolean().optional(),
  color: z.string().max(40).optional(),
  similarity: z.number().min(0).max(1).optional(),
  blend: z.number().min(0).max(1).optional(),
});

export const manifestFeedSchema = z
  .object({
    role: feedRoleSchema,
    /** `program` equals `clean` when no DSK composite ran: no second file. */
    aliasOf: feedRoleSchema.nullish(),
    parts: z.array(feedPartSchema).optional(),
    durationMs: ms.optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    hasAlpha: z.boolean().optional(),
    key: keyParamsSchema.nullish(),
  })
  .refine((feed) => feed.aliasOf != null || (feed.parts?.length ?? 0) > 0, "A feed needs parts or aliasOf");

export const manifestCaptionSchema = z.object({
  language: z.string().min(1).max(35),
  format: z.string().optional(),
  ref: httpUrl,
  origin: z.string().optional(),
  alignedTo: z.string().optional(),
});

export const manifestMarkerSchema = z.object({ atMs: ms, kind: z.string().max(40).default("cue"), label: z.string().max(200).default("") });

export const lcytManifestSchema = z
  .object({
    version: z.literal(MANIFEST_VERSION),
    origin: z.object({
      system: z.literal("lcyt"),
      instance: z.string().nullish(),
      broadcastId: z.union([z.string(), z.number()]).nullish(),
      videoId: z.union([z.string(), z.number()]).nullish(),
      groupId: z.union([z.string(), z.number()]).nullish(),
    }),
    title: z.string().max(300),
    startedAt: z.string().nullish(),
    endedAt: z.string().nullish(),
    timeAlignment: z.string().optional(),
    feeds: z.array(manifestFeedSchema).min(1),
    captions: z.array(manifestCaptionSchema).default([]),
    dskEvents: z.object({ ref: httpUrl, count: z.number().optional() }).nullish(),
    markers: z.array(manifestMarkerSchema).default([]),
    variables: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  })
  .superRefine((manifest, ctx) => {
    const roles = new Set<string>();
    manifest.feeds.forEach((feed, index) => {
      if (roles.has(feed.role)) ctx.addIssue({ code: "custom", path: ["feeds", index, "role"], message: `Duplicate feed role ${feed.role}` });
      roles.add(feed.role);
    });
    if (!roles.has("clean")) ctx.addIssue({ code: "custom", path: ["feeds"], message: "A clean feed is required" });
    manifest.feeds.forEach((feed, index) => {
      if (feed.aliasOf && !roles.has(feed.aliasOf)) ctx.addIssue({ code: "custom", path: ["feeds", index, "aliasOf"], message: `aliasOf ${feed.aliasOf} is not in the manifest` });
    });
  });

export type LcytManifest = z.infer<typeof lcytManifestSchema>;
export type ManifestFeed = z.infer<typeof manifestFeedSchema>;
export type FeedPart = z.infer<typeof feedPartSchema>;

/** Identity of the broadcast in LCYT: the feed group when LCYT sends one, else the clean video. */
export function manifestExternalId(manifest: LcytManifest): string {
  const { groupId, videoId, broadcastId } = manifest.origin;
  const id = groupId ?? videoId ?? broadcastId;
  if (id === null || id === undefined || String(id) === "") throw new Error("The manifest has no origin.groupId or origin.videoId to identify the broadcast");
  return String(id);
}

/** Feeds that have a file of their own (an alias is the same picture as the feed it points to). */
export function fileFeeds(manifest: LcytManifest): ManifestFeed[] {
  return manifest.feeds.filter((feed) => !feed.aliasOf && (feed.parts?.length ?? 0) > 0);
}

/** Where the feed starts on the clean timeline: its first part. */
export function feedOffsetMs(feed: ManifestFeed): number {
  return Math.round(Math.min(...(feed.parts ?? [{ startMs: 0 }]).map((part) => part.startMs)));
}

/** End of the feed's last part relative to its own first part: the length of the single file the parts are joined into. */
export function feedSpanMs(feed: ManifestFeed): number {
  const start = feedOffsetMs(feed);
  return Math.round(Math.max(...(feed.parts ?? []).map((part) => part.startMs + part.durationMs)) - start);
}

/**
 * Variables for `definition.variables`: valid names only (project variable rules), values trimmed to the limit.
 * Skipped names are returned so the import can tell the user.
 */
export function manifestVariables(manifest: LcytManifest, isValidKey: (key: string) => boolean): { variables: Array<{ key: string; value: string }>; skipped: string[] } {
  const variables: Array<{ key: string; value: string }> = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(manifest.variables)) {
    if (!isValidKey(key)) { skipped.push(key); continue; }
    variables.push({ key, value: String(value).slice(0, 500) });
  }
  return { variables: variables.slice(0, 100), skipped };
}
