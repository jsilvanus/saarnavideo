/**
 * Plain-text transcript (no timings) built from transcript segments, for accessibility use.
 *
 * Range rule: a segment belongs to the range [start, end) when its START lies inside it. A segment that began before
 * `start` and runs into the range is left out, a segment that starts inside and runs past `end` is kept whole. This
 * keeps every sentence complete and makes adjacent ranges (0-60, 60-120) partition the transcript without repeats.
 *
 * The text is kept faithful: whitespace is normalised and nothing else is changed (no punctuation is added or
 * corrected). Paragraph breaks come from pauses and, for very long runs of speech, from sentence ends.
 */

export type TranscriptSegmentLike = { startSeconds: number; endSeconds: number; text: string; speaker?: string | null };

export type TranscriptTextOptions = {
  /** A pause longer than this starts a new paragraph. Default 2 s. */
  paragraphGapSeconds?: number;
  /** Once a paragraph has this many characters, the next sentence end closes it. Default 600. */
  maxParagraphChars?: number;
};

export const DEFAULT_PARAGRAPH_GAP_SECONDS = 2;
export const DEFAULT_MAX_PARAGRAPH_CHARS = 600;

/** Segments whose start lies in [start, end); both bounds are optional. Sorted by start time. */
export function selectSegmentsInRange<T extends TranscriptSegmentLike>(segments: readonly T[], start?: number, end?: number): T[] {
  return segments
    .filter((segment) => (start === undefined || segment.startSeconds >= start) && (end === undefined || segment.startSeconds < end))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
}

/** Collapses every run of whitespace (including line breaks inside a caption) into one space. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

const SENTENCE_END = /[.!?…][)"'”’»\]]*$/;

/** Paragraphs of the transcript, in order. Speaker labels appear only when the segments carry them ("Name: text"). */
export function buildTranscriptParagraphs(segments: readonly TranscriptSegmentLike[], options: TranscriptTextOptions = {}): string[] {
  const gap = options.paragraphGapSeconds ?? DEFAULT_PARAGRAPH_GAP_SECONDS;
  const maxChars = options.maxParagraphChars ?? DEFAULT_MAX_PARAGRAPH_CHARS;
  const ordered = [...segments].sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  const paragraphs: string[] = [];
  let current = "";
  let previous: TranscriptSegmentLike | undefined;
  let previousSpeaker: string | undefined;
  let latestEnd = -Infinity;
  for (const segment of ordered) {
    const text = normalizeWhitespace(segment.text);
    if (!text) continue;
    const speaker = segment.speaker?.trim() || undefined;
    const speakerChanged = speaker !== undefined && speaker !== previousSpeaker;
    const paused = previous !== undefined && segment.startSeconds - latestEnd > gap;
    const tooLong = current.length >= maxChars && SENTENCE_END.test(current);
    if (current && (speakerChanged || paused || tooLong)) { paragraphs.push(current); current = ""; }
    current = current ? `${current} ${text}` : speakerChanged ? `${speaker}: ${text}` : text;
    if (speaker !== undefined) previousSpeaker = speaker;
    latestEnd = Math.max(latestEnd, segment.endSeconds);
    previous = segment;
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

/** The transcript as plain text: paragraphs separated by a blank line, an optional title line first, ending in a newline. Empty input gives "". */
export function buildTranscriptText(segments: readonly TranscriptSegmentLike[], options: TranscriptTextOptions & { title?: string } = {}): string {
  const paragraphs = buildTranscriptParagraphs(segments, options);
  const title = options.title ? normalizeWhitespace(options.title) : "";
  const blocks = title && paragraphs.length ? [title, ...paragraphs] : paragraphs;
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A value usable in `lang=""`; "und" (undetermined) when the language is unknown or not a tag (for example "auto"). */
export function htmlLanguage(language: string | null | undefined): string {
  const trimmed = language?.trim();
  return trimmed && LANGUAGE_TAG.test(trimmed) && trimmed.toLowerCase() !== "auto" ? trimmed : "und";
}

/** A minimal, self-contained accessible HTML document: lang attribute, a title, an h1 when a title is given, one <p> per paragraph. */
export function buildTranscriptHtml(segments: readonly TranscriptSegmentLike[], options: TranscriptTextOptions & { title?: string; language?: string | null } = {}): string {
  const paragraphs = buildTranscriptParagraphs(segments, options);
  const title = options.title ? normalizeWhitespace(options.title) : "";
  const documentTitle = escapeHtml(title || "Transcript");
  const body = [
    ...(title ? [`<h1>${escapeHtml(title)}</h1>`] : []),
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
  ].join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(htmlLanguage(options.language))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${documentTitle}</title>
<style>body{max-width:42rem;margin:2rem auto;padding:0 1rem;font:1.125rem/1.6 system-ui,sans-serif;color:#111;background:#fff}p{margin:0 0 1.25em}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
