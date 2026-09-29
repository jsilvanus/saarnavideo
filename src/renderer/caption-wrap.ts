import type { CaptionSegment } from "@/lib/captions";

/**
 * Word-wrapping of caption cues for burned-in captions.
 *
 * Text width is *estimated*, not measured (the worker has no font metrics
 * library): every character is assumed to be `fontSize * factor` wide, with
 * factor 0.55 for regular and 0.6 for bold text. That matches DejaVu Sans,
 * the bundled fallback font, which is on the wide side of common sans fonts,
 * so lines come out slightly short rather than too long. The ASS file also
 * uses libass smart wrapping as a safety net, so an under-estimate can add a
 * line but never lets text run out of the frame.
 */
export const AVG_GLYPH_FACTOR = 0.55;
export const AVG_GLYPH_FACTOR_BOLD = 0.6;
export const LINE_HEIGHT_FACTOR = 1.2;

export type WrapMetrics = { fontSize: number; bold?: boolean };

export function estimateTextWidth(text: string, { fontSize, bold }: WrapMetrics): number {
  return Array.from(text).length * fontSize * (bold ? AVG_GLYPH_FACTOR_BOLD : AVG_GLYPH_FACTOR);
}

/** How many characters fit on one line of `maxWidth` pixels (at least 1). */
export function charBudget(maxWidth: number, metrics: WrapMetrics): number {
  return Math.max(1, Math.floor(maxWidth / estimateTextWidth("x", metrics)));
}

/** Greedy word wrap by character budget; words longer than a line are broken hard. Whitespace (incl. newlines) collapses. */
export function wrapText(text: string, maxWidth: number, metrics: WrapMetrics): string[] {
  const budget = charBudget(maxWidth, metrics);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const flush = () => { if (line) lines.push(line); line = ""; };
  for (const word of words) {
    let rest = Array.from(word);
    while (rest.length > budget) {
      flush();
      lines.push(rest.slice(0, budget).join(""));
      rest = rest.slice(budget);
    }
    const piece = rest.join("");
    if (!piece) continue;
    if (!line) line = piece;
    else if (Array.from(line).length + 1 + rest.length <= budget) line += ` ${piece}`;
    else { flush(); line = piece; }
  }
  flush();
  return lines;
}

/** Lines that fit the caption box: `maxLines`, further limited by the box height. */
export function effectiveMaxLines(maxLines: number, boxHeight: number, padding: number, fontSize: number): number {
  const byHeight = Math.floor((boxHeight - 2 * padding) / (fontSize * LINE_HEIGHT_FACTOR));
  return Math.max(1, Math.min(maxLines, byHeight));
}

export type WrappedCue = CaptionSegment & { lines: string[] };

/**
 * Wraps a cue to the box and, when it needs more than `maxLines` lines, splits
 * it into consecutive pages of at most `maxLines` lines. The cue's time span is
 * divided between the pages in proportion to their character count, so the
 * pages tile the original span exactly (no gaps, no overlap).
 */
export function layoutCue(cue: CaptionSegment, maxWidth: number, maxLines: number, metrics: WrapMetrics): WrappedCue[] {
  const lines = wrapText(cue.text, maxWidth, metrics);
  if (!lines.length) return [];
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += maxLines) pages.push(lines.slice(i, i + maxLines));
  if (pages.length === 1) return [{ ...cue, lines: pages[0] }];
  const weights = pages.map((page) => page.join(" ").length);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const span = cue.endSeconds - cue.startSeconds;
  let cursor = cue.startSeconds;
  let consumed = 0;
  return pages.map((page, index) => {
    consumed += weights[index];
    const end = index === pages.length - 1 ? cue.endSeconds : cue.startSeconds + (span * consumed) / total;
    const result = { startSeconds: cursor, endSeconds: end, text: page.join(" "), lines: page };
    cursor = end;
    return result;
  });
}

/** Wraps and pages every cue of a track. */
export function layoutCues(cues: readonly CaptionSegment[], maxWidth: number, maxLines: number, metrics: WrapMetrics): WrappedCue[] {
  return cues.flatMap((cue) => layoutCue(cue, maxWidth, maxLines, metrics));
}
