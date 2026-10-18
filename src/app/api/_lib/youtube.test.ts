import { describe, expect, it, vi } from "vitest";
import { fetchYouTubeTitle } from "./youtube";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchYouTubeTitle", () => {
  it("reads the title from the oEmbed document and asks for the video URL encoded", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ title: "  Sunnuntain jumalanpalvelus  " }));
    const title = await fetchYouTubeTitle("https://youtu.be/abc", { fetch: fetchMock as unknown as typeof fetch });
    expect(title).toBe("Sunnuntain jumalanpalvelus");
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabc");
    expect(init.signal).toBeDefined();
  });

  it("returns undefined for an error status, a missing or blank title, or a network failure", async () => {
    expect(await fetchYouTubeTitle("https://youtu.be/a", { fetch: (async () => jsonResponse({}, 401)) as unknown as typeof fetch })).toBeUndefined();
    expect(await fetchYouTubeTitle("https://youtu.be/a", { fetch: (async () => jsonResponse({ title: "   " })) as unknown as typeof fetch })).toBeUndefined();
    expect(await fetchYouTubeTitle("https://youtu.be/a", { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch })).toBeUndefined();
  });

  it("gives up after the timeout", async () => {
    const hanging = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
    });
    const started = Date.now();
    const title = await fetchYouTubeTitle("https://youtu.be/a", { fetch: hanging as unknown as typeof fetch, timeoutMs: 20 });
    expect(title).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
