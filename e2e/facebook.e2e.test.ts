import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { fakeGraphConfigure, fakeGraphReset, fakeGraphState } from "./fake-graph-server";
import { api, baseUrl, createProject, download, mediaRoot, publish, renderPublishableProject as renderedProject, setComposition, uploadSource, waitForJob, waitForPublication } from "./helpers";

const fakeUrl = inject("facebookUrl");
describe("Facebook publishing (fake Graph API)", () => {
  beforeEach(async () => { await fakeGraphReset(fakeUrl); });

  it("reports the configured Page without exposing the token", async () => {
    const response = await fetch(`${baseUrl}/api/integrations/facebook/status`);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, pageId: "1234567890", pageName: "Testiseurakunta" });
    expect(text).not.toContain("fake-page-token");
  });

  it("uploads chunk by chunk, sets thumbnail and captions, and completes with the video id", async () => {
    await fakeGraphConfigure(fakeUrl, { processingPolls: 2 });
    const { project, video, srt, outputs } = await renderedProject("Facebook julkaisu");
    expect(outputs.some((output) => output.type === "THUMBNAIL")).toBe(true);
    const file = `${mediaRoot}/facebook-${video.id}.mp4`;
    await download(video.id, file);
    const bytes = await readFile(file);

    const queued = await publish(project.id, { platform: "FACEBOOK", privacy: "PUBLIC" });
    expect(queued).toMatchObject({ provider: "FACEBOOK", status: "QUEUED", privacy: "PUBLIC" });
    const done = await waitForPublication(project.id, queued.id);
    expect(done).toMatchObject({ status: "COMPLETED", error: null });

    const state = await fakeGraphState(fakeUrl);
    expect(state.sessions).toHaveLength(1);
    const session = state.sessions[0];
    expect(done.externalId).toBe(session.videoId);
    expect(session.fileSize).toBe(bytes.length);
    expect(session.received).toBe(bytes.length);
    expect(session.chunks).toHaveLength(Math.ceil(bytes.length / (32 * 1024)));
    expect(session.chunks.length).toBeGreaterThan(1);
    expect(session.chunks.reduce((sum, chunk) => sum + chunk.size, 0)).toBe(bytes.length);
    expect(session.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(session.finished).toEqual({ title: "Facebook julkaisu", description: "", published: "true" });
    expect(session.statusPolls).toBeGreaterThanOrEqual(3);

    expect(state.thumbnails).toHaveLength(1);
    expect(state.thumbnails[0]).toMatchObject({ videoId: session.videoId, isPreferred: "true" });
    expect(state.thumbnails[0].size).toBeGreaterThan(100);
    const srtText = await (await fetch(`${baseUrl}/api/outputs/${srt.id}`)).text();
    expect(state.captions).toEqual([{ videoId: session.videoId, filename: "video.fi_FI.srt", defaultLocale: "fi_FI", content: srtText }]);
    expect(srtText).toContain("Hyvää huomenta");
    // The token never reaches request lines and is not stored on the publication.
    expect(JSON.stringify(done)).not.toContain("fake-page-token");
  });

  it("uploads an unpublished video for PRIVATE and stays COMPLETED when captions and thumbnail are rejected", async () => {
    await fakeGraphConfigure(fakeUrl, { failCaptions: true, failThumbnails: true });
    const { project } = await renderedProject("Facebook luonnos");
    const done = await waitForPublication(project.id, (await publish(project.id, { platform: "FACEBOOK", privacy: "PRIVATE" })).id);
    expect(done.status).toBe("COMPLETED");
    const state = await fakeGraphState(fakeUrl);
    expect(state.sessions[0].finished?.published).toBe("false");
    expect(state.captions).toEqual([]);
    expect(state.thumbnails).toEqual([]);
  });

  it("ends FAILED with a readable error when the token is expired", async () => {
    const { project } = await renderedProject("Facebook virhe");
    await fakeGraphConfigure(fakeUrl, { expectedToken: "rotated-token" });
    const failed = await waitForPublication(project.id, (await publish(project.id, { platform: "FACEBOOK", privacy: "PUBLIC" })).id);
    expect(failed.status).toBe("FAILED");
    expect(failed.externalId).toBeNull();
    expect(failed.error).toMatch(/access token has expired \(code 190\).*FACEBOOK_PAGE_ACCESS_TOKEN/);
    expect(failed.error).not.toContain("fake-page-token");
    expect((await fakeGraphState(fakeUrl)).sessions).toEqual([]);
  });

  it("ends FAILED when Facebook cannot process the video", async () => {
    await fakeGraphConfigure(fakeUrl, { finalStatus: "error", processingPolls: 0 });
    const { project } = await renderedProject("Facebook prosessointi");
    const failed = await waitForPublication(project.id, (await publish(project.id, { platform: "FACEBOOK", privacy: "PUBLIC" })).id);
    expect(failed).toMatchObject({ status: "FAILED" });
    expect(failed.error).toMatch(/could not process the video: Unsupported codec/);
  });

  it("validates the request and keeps the YouTube path unchanged", async () => {
    const project = await createProject("Publish validation");
    await publish(project.id, { platform: "FACEBOOK", privacy: "UNLISTED" }, 400);
    await publish(project.id, { platform: "MYSPACE" }, 400);
    // No rendered video yet.
    await publish(project.id, { platform: "FACEBOOK", privacy: "PUBLIC" }, 404);
    // Default platform is YouTube, which still needs a connected account (none in the e2e database).
    const youtube = await api<{ error: string }>(`/api/projects/${project.id}/publish`, { method: "POST", json: { privacy: "PRIVATE" } }, 409);
    expect(youtube.error).toMatch(/Connect a YouTube account/);
    expect((await fakeGraphState(fakeUrl)).sessions).toEqual([]);
  });
});
