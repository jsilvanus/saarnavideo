import { z } from "zod";
import { applyVariables, type ProjectVariable } from "@/domain/variables";

/**
 * Per-publication YouTube settings (stored in `Publication.options`). Everything is optional: an empty object publishes
 * with the project's title and a description built from the project, like before.
 * Limits are YouTube's: title 100 characters, description 5000 bytes, tags 500 characters in total; `<` and `>` are refused by
 * the API in titles and descriptions, so they are removed.
 */
export const youtubePublishOptionsSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(60).optional(),
  /** YouTube video category id ("29" = Nonprofits & Activism, "22" = People & Blogs). Default: YOUTUBE_CATEGORY_ID or 29. */
  categoryId: z.string().regex(/^\d{1,3}$/).optional(),
  /** BCP-47 language of the title/description and of the spoken audio, e.g. "fi". */
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).optional(),
  /** Playlist the video is added to after the upload (playlistItems.insert). */
  playlistId: z.string().regex(/^[A-Za-z0-9_-]{2,64}$/).optional(),
  /** Scheduled release (ISO 8601). The video is uploaded private and YouTube makes it public at this time. */
  publishAt: z.string().datetime({ offset: true }).optional(),
  madeForKids: z.boolean().optional(),
  notifySubscribers: z.boolean().optional(),
}).strict();

export type YouTubePublishOptions = z.infer<typeof youtubePublishOptionsSchema>;

export const DEFAULT_CATEGORY_ID = "29";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX_CHARS = 500;

/** Checks the options of a publish request. Returns an error text (English, API-facing) or null. */
export function checkYouTubeOptions(options: YouTubePublishOptions, privacy: string, now = new Date()): string | null {
  if (options.publishAt) {
    const at = new Date(options.publishAt);
    if (at.getTime() < now.getTime() + 60_000) return "publishAt must be in the future";
    if (privacy !== "PRIVATE") return "A scheduled video is uploaded private and made public by YouTube at publishAt: use privacy PRIVATE";
  }
  return null;
}

const stripAngles = (text: string) => text.replace(/[<>]/g, "");

function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  for (const char of text) { if (Buffer.byteLength(out + char, "utf8") > maxBytes - 3) break; out += char; }
  return `${out.trimEnd()}...`;
}

/** Tags as YouTube counts them: a tag with a space is quoted, and tags are separated by commas. Extra tags are dropped. */
export function limitTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of tags) {
    const tag = stripAngles(raw).replace(/,/g, " ").trim();
    if (!tag || out.includes(tag)) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > TAGS_MAX_CHARS) break;
    out.push(tag); used += cost;
  }
  return out;
}

export type ProjectInfo = { title: string; preacher?: string | null; gospelRef?: string | null; variables?: readonly ProjectVariable[] };

/** Description used when the publication does not give one (church content, Finnish by design). */
export function defaultDescription(project: ProjectInfo): string {
  return [project.preacher ? `Saarnaaja: ${project.preacher}` : "", project.gospelRef ? `Evankeliumi: ${project.gospelRef}` : ""].filter(Boolean).join("\n");
}

export type YouTubeVideoResource = {
  snippet: { title: string; description: string; tags?: string[]; categoryId: string; defaultLanguage?: string; defaultAudioLanguage?: string };
  status: { privacyStatus: "private" | "unlisted" | "public"; publishAt?: string; selfDeclaredMadeForKids: boolean; embeddable: boolean };
};

/** The videos.insert body: project variables (`{{name}}`) are filled in, then YouTube's limits applied. */
export function buildVideoResource(project: ProjectInfo, privacy: string, options: YouTubePublishOptions = {}, defaultCategoryId = DEFAULT_CATEGORY_ID): YouTubeVideoResource {
  const fill = (text: string) => applyVariables(text, project.variables);
  const title = stripAngles(fill(options.title || project.title)).replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).trim() || "Video";
  const description = truncateBytes(stripAngles(fill(options.description ?? defaultDescription(project))), DESCRIPTION_MAX_BYTES);
  const tags = options.tags?.length ? limitTags(options.tags.map(fill)) : [];
  const scheduled = Boolean(options.publishAt);
  return {
    snippet: { title, description, ...(tags.length ? { tags } : {}), categoryId: options.categoryId ?? defaultCategoryId, ...(options.language ? { defaultLanguage: options.language, defaultAudioLanguage: options.language } : {}) },
    status: { privacyStatus: scheduled ? "private" : (privacy.toLowerCase() as "private" | "unlisted" | "public"), ...(scheduled ? { publishAt: new Date(options.publishAt!).toISOString() } : {}), selfDeclaredMadeForKids: options.madeForKids ?? false, embeddable: true },
  };
}
