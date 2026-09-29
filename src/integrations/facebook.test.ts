import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeGraphConfigure, fakeGraphReset, fakeGraphState, startFakeGraphServer, type FakeGraphServer } from "../../e2e/fake-graph-server";
import { FacebookApiError, describeGraphError, getFacebookPageName, readFacebookConfig, toFacebookLocale, uploadVideoToFacebook, waitForFacebookVideo, type FacebookConfig } from "./facebook";
import { publishVideoToFacebook } from "@/worker/facebook-publish";

describe("readFacebookConfig", () => {
  it("needs both the page id and the token", () => {
    expect(readFacebookConfig({})).toBeNull();
    expect(readFacebookConfig({ FACEBOOK_PAGE_ID: "1" })).toBeNull();
    expect(readFacebookConfig({ FACEBOOK_PAGE_ACCESS_TOKEN: "t" })).toBeNull();
  });
  it("applies defaults and overrides", () => {
    const config = readFacebookConfig({ FACEBOOK_PAGE_ID: " 42 ", FACEBOOK_PAGE_ACCESS_TOKEN: "t" })!;
    expect(config).toMatchObject({ pageId: "42", accessToken: "t", baseUrl: "https://graph.facebook.com", videoBaseUrl: "https://graph-video.facebook.com" });
    expect(config.version).toMatch(/^v\d+\.\d+$/);
    const custom = readFacebookConfig({ FACEBOOK_PAGE_ID: "42", FACEBOOK_PAGE_ACCESS_TOKEN: "t", FACEBOOK_GRAPH_VERSION: "v99.0", FACEBOOK_GRAPH_BASE_URL: "http://localhost:1/" })!;
    expect(custom).toMatchObject({ version: "v99.0", baseUrl: "http://localhost:1", videoBaseUrl: "http://localhost:1" });
  });
  it("rejects a page id that is not a plain id", () => {
    expect(() => readFacebookConfig({ FACEBOOK_PAGE_ID: "1/../x", FACEBOOK_PAGE_ACCESS_TOKEN: "t" })).toThrow(/Page ID/);
  });
});

describe("describeGraphError", () => {
  const err = (code: number, message = "m", error_subcode?: number) => ({ error: { code, message, error_subcode, fbtrace_id: "T1" } });
  it("explains expired and invalid tokens", () => {
    expect(describeGraphError(400, err(190, "x", 463)).message).toMatch(/expired.*FACEBOOK_PAGE_ACCESS_TOKEN.*\[trace T1\]/);
    expect(describeGraphError(400, err(190, "bad token")).message).toMatch(/invalid or was revoked/);
  });
  it("explains permission, rate limit and parameter errors, and falls back to the raw message", () => {
    expect(describeGraphError(403, err(200, "no perm")).message).toMatch(/permission is missing.*pages_manage_posts/);
    expect(describeGraphError(400, err(4)).message).toMatch(/rate limit/);
    expect(describeGraphError(400, err(100, "bad file_size")).message).toMatch(/parameter.*bad file_size/);
    expect(describeGraphError(500, err(2, "boom")).message).toMatch(/code 2, HTTP 500\): boom/);
    expect(describeGraphError(502, "<html>").message).toBe("Facebook request failed (HTTP 502)");
  });
});

describe("toFacebookLocale", () => {
  it("maps languages to language_COUNTRY", () => {
    expect(toFacebookLocale("fi")).toBe("fi_FI");
    expect(toFacebookLocale("sv-SE")).toBe("sv_SE");
    expect(toFacebookLocale("en-gb")).toBe("en_GB");
    expect(toFacebookLocale("xx")).toBeUndefined();
    expect(toFacebookLocale(null)).toBeUndefined();
  });
});

describe("uploader against the fake Graph server", () => {
  let fake: FakeGraphServer;
  let dir: string;
  let config: FacebookConfig;
  let video: string;
  let videoBytes: Buffer;
  const fast = { retryDelayMs: 1, pollIntervalMs: 5, timeoutMs: 2000 };

  beforeAll(async () => {
    fake = await startFakeGraphServer({ chunkSize: 1000 });
    dir = await mkdtemp(path.join(tmpdir(), "fb-test-"));
    video = path.join(dir, "video.mp4");
    videoBytes = randomBytes(3500);
    await writeFile(video, videoBytes);
    config = readFacebookConfig({ FACEBOOK_PAGE_ID: "1234567890", FACEBOOK_PAGE_ACCESS_TOKEN: "fake-page-token", FACEBOOK_GRAPH_BASE_URL: fake.url })!;
  });
  afterAll(async () => { await fake.close(); await rm(dir, { recursive: true, force: true }); });
  beforeEach(async () => { await fakeGraphReset(fake.url); await fakeGraphConfigure(fake.url, { chunkSize: 1000 }); });

  it("reads the page name", async () => {
    expect(await getFacebookPageName(config)).toBe("Testiseurakunta");
  });

  it("uploads in server-dictated chunks with exact byte accounting", async () => {
    const result = await uploadVideoToFacebook(config, { filePath: video, title: "Saarna", description: "Kuvaus", published: false }, fast);
    expect(result).toMatchObject({ chunks: 4, bytes: 3500 });
    const state = await fakeGraphState(fake.url);
    const session = state.sessions[0];
    expect(session.chunks).toEqual([{ startOffset: 0, size: 1000 }, { startOffset: 1000, size: 1000 }, { startOffset: 2000, size: 1000 }, { startOffset: 3000, size: 500 }]);
    expect(session.received).toBe(3500);
    expect(session.sha256).toBe(createHash("sha256").update(videoBytes).digest("hex"));
    expect(session.finished).toEqual({ title: "Saarna", description: "Kuvaus", published: "false" });
    expect(result.videoId).toBe(session.videoId);
  });

  it("retries a transient 500 on a chunk without resending earlier chunks", async () => {
    await fakeGraphConfigure(fake.url, { failTransfers: 2 });
    const result = await uploadVideoToFacebook(config, { filePath: video, title: "t", published: true }, fast);
    expect(result.chunks).toBe(4);
    const state = await fakeGraphState(fake.url);
    expect(state.sessions[0].received).toBe(3500);
    expect(state.requests.filter((request) => request === "POST /1234567890/videos")).toHaveLength(1 + 4 + 2 + 1);
  });

  it("gives up after the retries and reports the failure", async () => {
    await fakeGraphConfigure(fake.url, { failTransfers: 99 });
    await expect(uploadVideoToFacebook(config, { filePath: video, title: "t", published: true }, { ...fast, retries: 1 })).rejects.toThrow(/code 2/);
  });

  it("turns an expired token into a readable error that does not contain the token", async () => {
    const bad = { ...config, accessToken: "secret-old-token" };
    const error = await uploadVideoToFacebook(bad, { filePath: video, title: "t", published: true }, fast).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FacebookApiError);
    expect((error as Error).message).toMatch(/expired.*code 190/);
    expect((error as Error).message).not.toContain("secret-old-token");
    expect((error as FacebookApiError).code).toBe(190);
  });

  it("polls until ready, and fails on processing errors and on timeout", async () => {
    await fakeGraphConfigure(fake.url, { processingPolls: 3 });
    const { videoId } = await uploadVideoToFacebook(config, { filePath: video, title: "t", published: true }, fast);
    await waitForFacebookVideo(config, videoId, fast);
    expect((await fakeGraphState(fake.url)).sessions[0].statusPolls).toBe(4);

    await fakeGraphReset(fake.url); await fakeGraphConfigure(fake.url, { finalStatus: "error", processingPolls: 0 });
    const errored = await uploadVideoToFacebook(config, { filePath: video, title: "t", published: true }, fast);
    await expect(waitForFacebookVideo(config, errored.videoId, fast)).rejects.toThrow(/could not process the video: Unsupported codec/);

    await fakeGraphReset(fake.url); await fakeGraphConfigure(fake.url, { processingPolls: 100000 });
    const slow = await uploadVideoToFacebook(config, { filePath: video, title: "t", published: true }, fast);
    await expect(waitForFacebookVideo(config, slow.videoId, { ...fast, timeoutMs: 50 })).rejects.toThrow(/still processing/);
  });

  describe("publishVideoToFacebook", () => {
    const logs: Array<{ level: string; message: string }> = [];
    const deps = () => ({ config, client: fast, log: (level: "INFO" | "WARN", message: string) => { logs.push({ level, message }); } });
    let thumb: string, srt: string;
    beforeAll(async () => {
      thumb = path.join(dir, "thumb.jpg"); srt = path.join(dir, "out.srt");
      await writeFile(thumb, randomBytes(300));
      await writeFile(srt, "1\n00:00:01,000 --> 00:00:02,000\nHei\n");
    });
    beforeEach(() => { logs.length = 0; });

    it("uploads, waits, then adds the thumbnail and a locale-named SRT", async () => {
      const result = await publishVideoToFacebook({ filePath: video, thumbnailPath: thumb, title: "T", published: true, sidecar: { storagePath: srt, language: "fi" } }, deps());
      expect(result).toMatchObject({ chunks: 4, bytes: 3500, thumbnail: true, captions: true });
      const state = await fakeGraphState(fake.url);
      expect(state.thumbnails).toEqual([{ videoId: result.videoId, size: 300, isPreferred: "true" }]);
      expect(state.captions).toEqual([{ videoId: result.videoId, filename: "video.fi_FI.srt", defaultLocale: "fi_FI", content: "1\n00:00:01,000 --> 00:00:02,000\nHei\n" }]);
      expect(logs.filter((entry) => entry.level === "WARN")).toEqual([]);
    });

    it("fails soft when thumbnail and captions are rejected", async () => {
      await fakeGraphConfigure(fake.url, { failCaptions: true, failThumbnails: true });
      const result = await publishVideoToFacebook({ filePath: video, thumbnailPath: thumb, title: "T", published: false, sidecar: { storagePath: srt, language: "fi" } }, deps());
      expect(result).toMatchObject({ thumbnail: false, captions: false });
      expect(logs.filter((entry) => entry.level === "WARN")).toHaveLength(2);
    });

    it("skips captions for an unknown language and works without extras", async () => {
      const result = await publishVideoToFacebook({ filePath: video, title: "T", published: true, sidecar: { storagePath: srt, language: "und" } }, deps());
      expect(result).toMatchObject({ thumbnail: false, captions: false });
      expect(logs.some((entry) => entry.level === "WARN" && /language is unknown/.test(entry.message))).toBe(true);
      expect((await fakeGraphState(fake.url)).captions).toEqual([]);
    });

    it("propagates upload and processing failures", async () => {
      await fakeGraphConfigure(fake.url, { finalStatus: "error", processingPolls: 0 });
      await expect(publishVideoToFacebook({ filePath: video, title: "T", published: true, sidecar: null }, deps())).rejects.toThrow(/could not process/);
    });
  });
});
