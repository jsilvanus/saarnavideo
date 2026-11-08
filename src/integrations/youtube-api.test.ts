import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeYouTubeServer, type FakeYouTubeServer } from "../../e2e/fake-youtube-server";
import { buildVideoResource } from "@/domain/youtube-publish";
import { chunkBytesFromEnv, createYouTubeClient, youtubeError } from "@/integrations/youtube-api";

const CHUNK = 256 * 1024;
let fake: FakeYouTubeServer;
let token = "";
let tokenCalls: boolean[] = [];

/** Gets a token from the fake the way the app does (authorization code, then refresh on demand). */
async function tokenFromFake(forceRefresh = false): Promise<string> {
  tokenCalls.push(forceRefresh);
  if (!token || forceRefresh) {
    const grant: Record<string, string> = token ? { grant_type: "refresh_token", refresh_token: "fake-refresh-token" } : { grant_type: "authorization_code", code: "good-code" };
    const response = await fetch(`${fake.url}/token`, { method: "POST", body: new URLSearchParams({ ...grant, client_secret: "s" }) });
    token = ((await response.json()) as { access_token: string }).access_token;
  }
  return token;
}

const client = (extra: Partial<Parameters<typeof createYouTubeClient>[0]> = {}) => createYouTubeClient({ token: tokenFromFake, baseUrl: fake.url, retryDelayMs: 1, chunkBytes: CHUNK, ...extra });
const resource = buildVideoResource({ title: "Messu {{pyhapaiva}}", preacher: "Testi Saarnaaja", variables: [{ key: "pyhapaiva", value: "1. adventtisunnuntai" }] }, "UNLISTED", { tags: ["messu", "adventti"], language: "fi" });

async function videoFile(bytes: number) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "yt-api-")), "v.mp4");
  const content = randomBytes(bytes);
  await writeFile(file, content);
  return { file, sha256: createHash("sha256").update(content).digest("hex") };
}

beforeAll(async () => { fake = await startFakeYouTubeServer(); });
afterAll(async () => { await fake.close(); });
beforeEach(async () => { await fetch(`${fake.url}/__admin/reset`, { method: "POST" }); token = ""; tokenCalls = []; });

describe("resumable video upload", () => {
  it("uploads in 256 KiB-aligned chunks and sends the metadata", async () => {
    const { file, sha256 } = await videoFile(CHUNK * 2 + 1234);
    const sessions: string[] = []; const progress: number[] = [];
    const result = await client().uploadVideo({ filePath: file, resource, notifySubscribers: false, onSession: (url) => { sessions.push(url); }, onProgress: (sent) => { progress.push(sent); } });
    expect(result.resumed).toBe(false);
    expect(fake.state.videos).toEqual([expect.objectContaining({ id: result.videoId, sha256, chunks: 3, title: "Messu 1. adventtisunnuntai", description: "Saarnaaja: Testi Saarnaaja", privacyStatus: "unlisted", tags: ["messu", "adventti"], categoryId: "29", defaultLanguage: "fi", madeForKids: false, notifySubscribers: false })]);
    expect(sessions).toHaveLength(1);
    expect(progress).toEqual([CHUNK, CHUNK * 2, CHUNK * 2 + 1234]);
  });

  it("retries a chunk the server refused and asks where to continue", async () => {
    const { file, sha256 } = await videoFile(CHUNK * 3);
    fake.state.config.failChunks = 2;
    const result = await client().uploadVideo({ filePath: file, resource });
    expect(fake.state.videos).toEqual([expect.objectContaining({ id: result.videoId, sha256 })]);
    expect(fake.state.requests.filter((r) => r === "POST /upload/youtube/v3/videos")).toHaveLength(1);
  });

  it("finds a finished upload whose last answer was lost instead of uploading again", async () => {
    const { file, sha256 } = await videoFile(CHUNK + 10);
    fake.state.config.loseChunkAnswers = 2; // both chunks arrive, both answers are lost
    const result = await client().uploadVideo({ filePath: file, resource });
    expect(fake.state.videos).toEqual([expect.objectContaining({ id: result.videoId, sha256, chunks: 2 })]);
  });

  it("continues an interrupted session from where YouTube stopped (worker restart)", async () => {
    const { file, sha256 } = await videoFile(CHUNK * 3);
    let stored = "";
    // First attempt dies after the first chunk: every following chunk fails and retries are exhausted.
    const first = client({ maxRetries: 0 });
    fake.state.config.failChunks = 0;
    let sent = 0;
    await expect(first.uploadVideo({ filePath: file, resource, onSession: (url) => { stored = url; }, onProgress: (n) => { sent = n; if (n === CHUNK) fake.state.config.failChunks = 5; } })).rejects.toThrow(/YouTube video upload failed \(503\): Backend Error/);
    expect(sent).toBe(CHUNK);
    fake.state.config.failChunks = 0;
    const second = await client().uploadVideo({ filePath: file, resource, sessionUrl: stored });
    expect(second.resumed).toBe(true);
    expect(fake.state.videos).toEqual([expect.objectContaining({ id: second.videoId, sha256 })]);
    expect(fake.state.requests.filter((r) => r === "POST /upload/youtube/v3/videos")).toHaveLength(1);
    // Resuming a finished session returns the same video without sending anything.
    const third = await client().uploadVideo({ filePath: file, resource, sessionUrl: stored });
    expect(third).toEqual({ videoId: second.videoId, resumed: true });
    expect(fake.state.videos).toHaveLength(1);
  });

  it("starts a new session when the stored one is unknown", async () => {
    const { file } = await videoFile(100);
    const result = await client().uploadVideo({ filePath: file, resource, sessionUrl: `${fake.url}/upload-session/gone` });
    expect(result.resumed).toBe(false);
    expect(fake.state.videos).toHaveLength(1);
  });

  it("refreshes a token the API refuses once (401) and goes on", async () => {
    const { file } = await videoFile(CHUNK + 1);
    await tokenFromFake();
    fake.state.config.revokeAccessToken = true;
    await client().uploadVideo({ filePath: file, resource });
    expect(fake.state.videos).toHaveLength(1);
    expect(tokenCalls).toContain(true);
  });

  it("fails with Google's reason and a hint", async () => {
    const { file } = await videoFile(10);
    fake.state.config.failVideoInit = 403;
    await expect(client().uploadVideo({ filePath: file, resource })).rejects.toThrow(/YouTube upload initialization failed \(403\): Quota exceeded/);
  });
});

describe("playlists and thumbnails", () => {
  it("lists the channel's playlists and adds a video to one", async () => {
    expect(await client().listPlaylists()).toEqual([{ id: "PLfakeServices", title: "Jumalanpalvelukset", privacyStatus: "public", itemCount: 0 }, { id: "PLfakeSermons", title: "Saarnat", privacyStatus: "unlisted", itemCount: 0 }]);
    await client().addToPlaylist("vid1", "PLfakeSermons");
    expect(fake.state.playlistItems).toEqual([{ playlistId: "PLfakeSermons", videoId: "vid1" }]);
    await expect(client().addToPlaylist("vid1", "PLmissing")).rejects.toThrow(/playlistNotFound.*another channel/);
  });

  it("refuses a thumbnail over 2 MB before calling the API", async () => {
    const big = path.join(await mkdtemp(path.join(tmpdir(), "yt-th-")), "t.jpg");
    await writeFile(big, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(client().setThumbnail("vid1", big)).rejects.toThrow(/2 MB/);
    expect(fake.state.requests).not.toContain("POST /upload/youtube/v3/thumbnails/set");
  });
});

describe("helpers", () => {
  it("rounds the chunk size to 256 KiB", () => {
    expect(chunkBytesFromEnv(undefined)).toBe(8 * 1024 * 1024);
    expect(chunkBytesFromEnv("1000")).toBe(CHUNK);
    expect(chunkBytesFromEnv(String(CHUNK * 3 + 5))).toBe(CHUNK * 3);
  });
  it("reads Google error bodies", async () => {
    const quota = await youtubeError(new Response(JSON.stringify({ error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }), "X");
    expect(quota.message).toBe("X failed (403): quotaExceeded: The request cannot be completed because you have exceeded your quota. (the project's daily YouTube API quota is used up; it resets at midnight Pacific time)");
    expect(quota.reason).toBe("quotaExceeded");
    expect((await youtubeError(new Response("plain", { status: 500 }), "Y")).message).toBe("Y failed (500): plain");
  });
});
