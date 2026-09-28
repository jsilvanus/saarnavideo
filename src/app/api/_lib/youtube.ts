// Kept local (rather than @/integrations/youtube's youtubeVideoIdFromUrl) because
// that helper differs on malformed input: it swallows URL parse errors, rejects
// hosts like "notyoutube.com" and trims extra youtu.be path segments.
export function extractYouTubeId(urlString: string): string | null {
  const url = new URL(urlString);
  if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
  if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] ?? null;
    if (url.pathname.startsWith("/live/")) return url.pathname.split("/")[2] ?? null;
  }
  return null;
}
