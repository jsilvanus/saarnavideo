import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { fakeYouTubeConfigure, fakeYouTubeReset, fakeYouTubeState } from "./fake-youtube-server";
import { api, baseUrl, download, mediaRoot, publish, renderPublishableProject, waitForPublication } from "./helpers";

const fakeUrl = inject("youtubeUrl");

type Status = { connected: boolean; scope: string | null };
const status = () => api<Status>("/api/integrations/youtube/status");

/** Runs the OAuth round trip the browser would: connect (get the state cookie), then the callback with a code. */
async function connect(code = "good-code") {
  const start = await fetch(`${baseUrl}/api/integrations/youtube/connect`, { redirect: "manual" });
  const state = /youtube_oauth_state=([^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const callback = await fetch(`${baseUrl}/api/integrations/youtube/callback?code=${code}&state=${state}`, { redirect: "manual", headers: { cookie: `youtube_oauth_state=${state}` } });
  return { start, state, callback };
}

const disconnect = () => api("/api/integrations/youtube/disconnect", { method: "POST" });

describe("YouTube publishing (fake Google endpoints)", () => {
  beforeEach(async () => {
    await fakeYouTubeReset(fakeUrl);
    await disconnect();
  });
  // Other e2e files (the Facebook validation test) expect that no YouTube account is connected.
  afterAll(async () => {
    await disconnect();
  });

  it("refuses to publish before an account is connected", async () => {
    const { project } = await renderPublishableProject("YouTube ei yhteyttä");
    expect((await status()).connected).toBe(false);
    expect((await publish(project.id, { platform: "YOUTUBE" }, 409) as unknown as { error: string }).error).toMatch(/Connect a YouTube account/);
  });

  it("connects through the OAuth redirect and stores the account without exposing tokens", async () => {
    const { start, callback } = await connect();
    expect(start.status).toBe(307);
    const location = new URL(start.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("e2e-client");
    expect(location.searchParams.get("scope")).toContain("youtube.upload");
    expect(location.searchParams.get("scope")).toContain("youtube.force-ssl");
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(callback.status).toBe(307);
    expect(callback.headers.get("location")).toContain("youtube=connected");

    const response = await fetch(`${baseUrl}/api/integrations/youtube/status`);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ connected: true });
    expect(JSON.parse(text).scope).toContain("youtube.force-ssl");
    expect(text).not.toContain("fake-access");
    expect(text).not.toContain("fake-refresh");
    expect((await fakeYouTubeState(fakeUrl)).tokenRequests).toEqual([{ grant: "authorization_code", hasClientSecret: true }]);

    await disconnect();
    expect((await status()).connected).toBe(false);
  });

  it("rejects a callback with a wrong state or a code Google refuses", async () => {
    const start = await fetch(`${baseUrl}/api/integrations/youtube/connect`, { redirect: "manual" });
    const state = /youtube_oauth_state=([^;]+)/.exec(start.headers.get("set-cookie") ?? "")![1];
    const forged = await fetch(`${baseUrl}/api/integrations/youtube/callback?code=good-code&state=other`, { headers: { cookie: `youtube_oauth_state=${state}` } });
    expect(forged.status).toBe(400);
    const missingCookie = await fetch(`${baseUrl}/api/integrations/youtube/callback?code=good-code&state=${state}`);
    expect(missingCookie.status).toBe(400);
    const refused = await connect("bad-code");
    expect(refused.callback.status).toBe(500);
    expect((await status()).connected).toBe(false);
  });

  it("uploads the video privately with its thumbnail and caption track", async () => {
    await connect();
    const { project, video, srt, outputs } = await renderPublishableProject("YouTube julkaisu");
    expect(outputs.some((output) => output.type === "THUMBNAIL")).toBe(true);
    const queued = await publish(project.id, { platform: "YOUTUBE", privacy: "PRIVATE" });
    expect(queued).toMatchObject({ provider: "YOUTUBE", privacy: "PRIVATE", status: "QUEUED" });
    const done = await waitForPublication(project.id, queued.id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null });
    // The light endpoint the publish panel polls lists the same publication.
    const listed = await api<{ publications: Array<{ id: string; status: string; externalId: string | null }> }>(`/api/projects/${project.id}/publications`);
    expect(listed.publications).toEqual([expect.objectContaining({ id: queued.id, status: "COMPLETED", externalId: done.externalId })]);
    await api("/api/projects/missing/publications", {}, 404);

    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.videos).toHaveLength(1);
    expect(done.externalId).toBe(fake.videos[0].id);
    expect(fake.videos[0]).toMatchObject({ title: "YouTube julkaisu", privacyStatus: "private", contentType: "video/mp4" });
    const file = `${mediaRoot}/youtube-${video.id}.mp4`;
    await download(video.id, file);
    expect(fake.videos[0].sha256).toBe(createHash("sha256").update(await readFile(file)).digest("hex"));
    expect(fake.thumbnails).toEqual([expect.objectContaining({ videoId: done.externalId })]);
    expect(fake.thumbnails[0].size).toBeGreaterThan(1000);
    // The caption track is the SRT rendered with the video, uploaded after it, in the track's language.
    const srtFile = `${mediaRoot}/youtube-${srt.id}.srt`;
    await download(srt.id, srtFile);
    expect(fake.captions).toEqual([{ videoId: done.externalId, language: "fi", name: "suomi", content: await readFile(srtFile, "utf8") }]);
    expect(fake.unauthorized).toBe(0);
    expect(fake.requests.indexOf("POST /upload/youtube/v3/captions")).toBeGreaterThan(fake.requests.indexOf("POST /upload/youtube/v3/thumbnails/set"));
  });

  it("maps the chosen visibility to the YouTube privacy status", async () => {
    await connect();
    const { project } = await renderPublishableProject("YouTube näkyvyys");
    for (const privacy of ["UNLISTED", "PUBLIC"] as const) {
      expect((await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE", privacy })).id)).status).toBe("COMPLETED");
    }
    expect((await fakeYouTubeState(fakeUrl)).videos.map((item) => item.privacyStatus)).toEqual(["unlisted", "public"]);
  });

  it("refreshes an access token that has no expiry before uploading", async () => {
    await fakeYouTubeConfigure(fakeUrl, { expiresIn: 0 });
    await connect();
    const { project } = await renderPublishableProject("YouTube token");
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE" })).id);
    expect(done.status).toBe("COMPLETED");
    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.tokenRequests.map((request) => request.grant)).toContain("refresh_token");
    expect(fake.videos).toHaveLength(1);
    expect(fake.unauthorized).toBe(0);
  });

  it("fails the publication with Google's reason when the upload cannot start", async () => {
    await connect();
    await fakeYouTubeConfigure(fakeUrl, { failVideoInit: 403 });
    const { project } = await renderPublishableProject("YouTube kiintiö");
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE" })).id);
    expect(done.status).toBe("FAILED");
    expect(done.error).toContain("YouTube upload initialization failed (403)");
    expect(done.externalId).toBeNull();
    expect((await fakeYouTubeState(fakeUrl)).videos).toHaveLength(0);
  });

  it("completes when only the thumbnail or the caption upload fails, because the video is already on YouTube", async () => {
    await connect();
    await fakeYouTubeConfigure(fakeUrl, { failThumbnails: true, failCaptions: true });
    const { project } = await renderPublishableProject("YouTube osittainen");
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE" })).id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null });
    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.videos).toHaveLength(1);
    expect(done.externalId).toBe(fake.videos[0].id);
    expect(fake.thumbnails).toHaveLength(0);
    expect(fake.captions).toHaveLength(0);
    expect(done.warning).toMatch(/thumbnail upload failed \(403\)/);
    expect(done.warning).toMatch(/caption upload initialization failed \(403\)/);
    // A retry would upload the video a second time, so the failed side uploads must not have been retried.
    expect(fake.requests.filter((request) => request === "POST /upload/youtube/v3/videos")).toHaveLength(1);
  });

  it("publishes with the chosen title, description, tags, schedule and playlist", async () => {
    await connect();
    const playlists = await api<{ playlists: Array<{ id: string; title: string }> }>("/api/integrations/youtube/playlists");
    expect(playlists.playlists.map((item) => item.title)).toEqual(["Jumalanpalvelukset", "Saarnat"]);
    const { project } = await renderPublishableProject("YouTube tiedot");
    const publishAt = new Date(Date.now() + 86_400_000).toISOString();
    // A scheduled release must be uploaded private.
    await publish(project.id, { platform: "YOUTUBE", privacy: "PUBLIC", youtube: { publishAt } }, 400);
    await publish(project.id, { platform: "YOUTUBE", privacy: "PRIVATE", youtube: { publishAt: "2020-01-01T00:00:00Z" } }, 400);
    await publish(project.id, { platform: "FACEBOOK", youtube: { title: "x" } }, 400);
    const queued = await publish(project.id, { platform: "YOUTUBE", privacy: "PRIVATE", youtube: { title: "Sunnuntain messu", description: "Kuvaus <b>tässä</b>", tags: ["messu", "Riihimäki"], playlistId: playlists.playlists[1].id, publishAt, language: "fi", notifySubscribers: false } });
    expect(JSON.stringify(queued)).not.toContain("uploadUrl");
    const done = await waitForPublication(project.id, queued.id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null, warning: null, progress: 100 });
    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.videos).toEqual([expect.objectContaining({ id: done.externalId, title: "Sunnuntain messu", description: "Kuvaus btässä/b", tags: ["messu", "Riihimäki"], privacyStatus: "private", publishAt: new Date(publishAt).toISOString(), defaultLanguage: "fi", madeForKids: false, notifySubscribers: false })]);
    expect(fake.playlistItems).toEqual([{ playlistId: "PLfakeSermons", videoId: done.externalId }]);
  });

  it("survives refused chunks and a lost final answer without uploading twice", async () => {
    await connect();
    const { project, video } = await renderPublishableProject("YouTube katkos");
    await fakeYouTubeConfigure(fakeUrl, { failChunks: 2, loseChunkAnswers: 1 });
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE" })).id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null });
    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.videos).toHaveLength(1);
    expect(fake.requests.filter((request) => request === "POST /upload/youtube/v3/videos")).toHaveLength(1);
    const file = `${mediaRoot}/youtube-chunks-${video.id}.mp4`;
    await download(video.id, file);
    expect(fake.videos[0].sha256).toBe(createHash("sha256").update(await readFile(file)).digest("hex"));
  });

  it("refreshes a revoked access token and reports a missing playlist as a warning", async () => {
    await connect();
    const { project } = await renderPublishableProject("YouTube soittolista puuttuu");
    await fakeYouTubeConfigure(fakeUrl, { revokeAccessToken: true });
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "YOUTUBE", youtube: { playlistId: "PLgone" } })).id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null });
    expect(done.warning).toMatch(/playlistNotFound/);
    const fake = await fakeYouTubeState(fakeUrl);
    expect(fake.videos).toHaveLength(1);
    expect(fake.tokenRequests.map((request) => request.grant)).toContain("refresh_token");
  });
});
