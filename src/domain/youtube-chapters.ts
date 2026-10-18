import { z } from "zod";
import { addSourceSection } from "@/domain/templates";
import type { ProjectDefinition } from "@/domain/project";

/** One chapter of a YouTube video, in seconds of the video. */
export const chapterSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  title: z.string().min(1),
});
export type Chapter = z.infer<typeof chapterSchema>;

/** Chapters shorter than this are dropped: a sequence must be at least this long (MIN_SEQUENCE_SECONDS in sequence-timeline.ts). */
const MIN_CHAPTER_SECONDS = 0.5;

/**
 * Chapters from `ffprobe -show_chapters -of json`. yt-dlp's `--embed-chapters` writes the video's chapters into the
 * mp4; a video without chapters has none. Untitled or empty chapters are skipped, the list is ordered by start time.
 */
export function chaptersFromFfprobe(json: unknown): Chapter[] {
  const raw = (json as { chapters?: Array<{ start_time?: string | number; end_time?: string | number; tags?: { title?: string } }> } | null)?.chapters;
  if (!Array.isArray(raw)) return [];
  const chapters: Chapter[] = [];
  for (const item of raw) {
    const start = Number(item.start_time);
    const end = Number(item.end_time);
    const title = item.tags?.title?.trim();
    if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_CHAPTER_SECONDS) continue;
    chapters.push({ startSeconds: Math.round(start * 10) / 10, endSeconds: Math.round(end * 10) / 10, title });
  }
  return chapters.sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Reads the stored column back (it is Json); anything that is not a valid chapter list is "no chapters". */
export function readChapters(value: unknown): Chapter[] {
  const parsed = z.array(chapterSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** True when the source already has sections (sequences), placed or not: using the chapters would replace them. */
export function hasSourceSections(definition: Pick<ProjectDefinition, "sections">, sourceId: string): boolean {
  return (definition.sections ?? []).some(section => section.scope === "SOURCE" && section.sourceId === sourceId);
}

/**
 * Removes every source section of the source (with its subsections), the segments and clips cut from them, and the
 * overlays anchored to them. Clips of other sources, slates and mixes stay.
 */
export function removeSourceSections(definition: ProjectDefinition, sourceId: string): ProjectDefinition {
  const removed = new Set((definition.sections ?? []).filter(section => section.scope === "SOURCE" && section.sourceId === sourceId).map(section => section.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const section of definition.sections ?? []) if (section.parentId && removed.has(section.parentId) && !removed.has(section.id)) { removed.add(section.id); grew = true; }
  }
  const sameRange = (a: { startSeconds?: number; endSeconds?: number }, b: { startSeconds?: number; endSeconds?: number }) => a.startSeconds === b.startSeconds && a.endSeconds === b.endSeconds;
  const removedSections = (definition.sections ?? []).filter(section => removed.has(section.id));
  const removedSegments = definition.semanticSegments.filter(segment => removed.has(segment.id) || (segment.sourceId === sourceId && removedSections.some(section => sameRange(section, segment))));
  const segmentIds = new Set(removedSegments.map(segment => segment.id));
  const isCutFromRemoved = (item: ProjectDefinition["composition"]["items"][number]) =>
    item.type === "source-clip" && item.sourceId === sourceId && [...removedSections, ...removedSegments].some(range => range.startSeconds !== undefined && sameRange(range, item));
  return {
    ...definition,
    sections: (definition.sections ?? []).filter(section => !removed.has(section.id)),
    semanticSegments: definition.semanticSegments.filter(segment => !segmentIds.has(segment.id)),
    composition: {
      ...definition.composition,
      items: definition.composition.items.filter(item => !isCutFromRemoved(item) && !(item.type === "overlay" && item.sectionId !== undefined && removed.has(item.sectionId))),
    },
  };
}

/**
 * Replaces the source's sections with one section per chapter (each with its segment and clip, as the structure step adds
 * them). `makeId` gives the new section ids; the chapters are clipped to the video's length when it is known.
 */
export function replaceWithChapters(definition: ProjectDefinition, sourceId: string, chapters: readonly Chapter[], makeId: () => string, durationSeconds?: number): ProjectDefinition {
  let next = removeSourceSections(definition, sourceId);
  for (const chapter of chapters) {
    const end = durationSeconds !== undefined ? Math.min(chapter.endSeconds, durationSeconds) : chapter.endSeconds;
    if (end - chapter.startSeconds < MIN_CHAPTER_SECONDS) continue;
    next = addSourceSection(next, { id: makeId(), label: chapter.title, sourceId, startSeconds: chapter.startSeconds, endSeconds: end });
  }
  return next;
}
