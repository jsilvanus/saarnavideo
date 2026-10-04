/** Formats seconds as m:ss, or h:mm:ss from one hour upwards. */
export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Human-readable name for a source: its file name, YouTube URL, or id. */
export function sourceLabel(source: { id: string; originalName?: string | null; youtubeUrl?: string | null }) {
  return source.originalName || source.youtubeUrl || source.id;
}

/** Parses "h:mm:ss", "m:ss" or plain seconds ("75", "12.5") into seconds; undefined when empty or not a time. */
export function parseClock(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return undefined;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some(n => n >= 60) || numbers.slice(0, -1).some(n => !Number.isInteger(n))) return undefined;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}
