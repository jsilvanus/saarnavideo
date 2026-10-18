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

/**
 * Title of a YouTube video from its public oEmbed document. Undefined when the lookup fails, times out (5 s by default)
 * or the video has no title: the caller then stores no name and the URL stands in for it.
 */
export async function fetchYouTubeTitle(videoUrl: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<string | undefined> {
  const doFetch = options.fetch ?? fetch;
  try {
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`;
    const response = await doFetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 5000) });
    if (!response.ok) return undefined;
    const data = await response.json() as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title.trim() : undefined;
  } catch {
    return undefined;
  }
}
