/**
 * Shared VTT/SRT parsing and formatting for the transcription editor.
 * Format is specified in docs/transcription-editor-contract.md ("VTT format
 * (import + export)" / "SRT format (export only)"). Used by the upload-import
 * route and both export routes so all three agree on exactly one
 * implementation of the timestamp math.
 */

export type CaptionSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatTimestamp(totalSeconds: number, separator: "." | ","): string {
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
  const ms = totalMs % 1000;
  const totalWholeSeconds = Math.floor(totalMs / 1000);
  const seconds = totalWholeSeconds % 60;
  const totalMinutes = Math.floor(totalWholeSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(ms, 3)}`;
}

/** `WEBVTT\n\n` followed by cue blocks separated by a blank line, no cue identifiers. */
export function formatVtt(segments: CaptionSegment[]): string {
  if (!segments.length) return "WEBVTT\n\n";
  const blocks = segments.map(
    (segment) => `${formatTimestamp(segment.startSeconds, ".")} --> ${formatTimestamp(segment.endSeconds, ".")}\n${segment.text}`,
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/** Sequential 1-based cue numbers, comma decimal separator, no header. */
export function formatSrt(segments: CaptionSegment[]): string {
  if (!segments.length) return "";
  const blocks = segments.map(
    (segment, index) => `${index + 1}\n${formatTimestamp(segment.startSeconds, ",")} --> ${formatTimestamp(segment.endSeconds, ",")}\n${segment.text}`,
  );
  return `${blocks.join("\n\n")}\n`;
}

// Accepts HH:MM:SS.mmm or MM:SS.mmm (no hours), per the contract's parser note.
const TIMESTAMP_RE = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/;

function parseTimestamp(raw: string): number {
  const match = TIMESTAMP_RE.exec(raw.trim());
  if (!match) throw new Error(`Invalid VTT/SRT timestamp: "${raw}"`);
  const [, hoursPart, minutesPart, secondsPart, msPart] = match;
  const hours = hoursPart ? Number(hoursPart) : 0;
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  const ms = Number(msPart);
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Parses a WebVTT file's cues. An optional cue identifier line preceding the
 * timestamp line is ignored. Multi-line cue text is joined with "\n". Cue
 * settings after the timestamps (e.g. "align:start line:0%") are ignored.
 */
export function parseVtt(content: string): CaptionSegment[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const segments: CaptionSegment[] = [];
  let i = 0;

  if (lines[0]?.trim().toUpperCase().startsWith("WEBVTT")) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "") i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("NOTE")) {
      i++;
      continue;
    }
    let timestampLine = line;
    if (!timestampLine.includes("-->")) {
      // Cue identifier line - ignore it and look at the next line for the timestamps.
      i++;
      if (i >= lines.length) break;
      timestampLine = lines[i].trim();
    }
    const arrowMatch = /^(\S+)\s*-->\s*(\S+)/.exec(timestampLine);
    if (!arrowMatch) {
      i++;
      continue;
    }
    const startSeconds = parseTimestamp(arrowMatch[1]);
    const endSeconds = parseTimestamp(arrowMatch[2]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }
    segments.push({ startSeconds, endSeconds, text: textLines.join("\n") });
  }

  return segments;
}
