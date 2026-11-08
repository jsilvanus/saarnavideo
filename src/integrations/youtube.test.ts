import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadCaptionToYouTube } from "@/integrations/youtube";

afterEach(() => vi.unstubAllGlobals());

async function captionFile() {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "yt-cap-")), "c.srt");
  await writeFile(file, "1\n00:00:01,000 --> 00:00:02,000\nHei\n");
  return file;
}

describe("uploadCaptionToYouTube", () => {
  it("initiates a resumable captions.insert upload and PUTs the file", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1 ? new Response("", { status: 200, headers: { location: "https://upload.example/session" } }) : new Response(JSON.stringify({ id: "cap123" }), { status: 200 });
    }));
    const result = await uploadCaptionToYouTube({ accessToken: "tok", videoId: "vid1", filePath: await captionFile(), language: "fi", name: "suomi" });
    expect(result).toEqual({ captionId: "cap123" });
    expect(calls[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=resumable");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ snippet: { videoId: "vid1", language: "fi", name: "suomi", isDraft: false } });
    expect(calls[1].url).toBe("https://upload.example/session");
    expect(calls[1].init.method).toBe("PUT");
    expect(Buffer.from(calls[1].init.body as Buffer).toString()).toContain("Hei");
  });

  it("throws with the API error when initialization is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("insufficientPermissions", { status: 403 })));
    await expect(uploadCaptionToYouTube({ accessToken: "tok", videoId: "v", filePath: await captionFile(), language: "fi", name: "suomi" })).rejects.toThrow(/403.*insufficientPermissions/);
  });
});
