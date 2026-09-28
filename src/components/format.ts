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
