import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { api, averageColor, createProject, download, frameRgb, isBlack, isBlue, isGreen, isRed, mediaRoot, probe, render, setComposition, uploadAsset, uploadSource, waitForJob, whiteShare } from "./helpers";

const CENTER = { x: 460, y: 440, w: 1000, h: 200 };
const exists = (filePath: string) => access(filePath).then(() => true, () => false);

describe("rendering through the real API and worker", () => {
  it("joins a 5 s green clip and a 5 s red clip with a text overlay across the cut", async () => {
    const project = await createProject("Green + red");
    const green = await uploadSource(project.id, "green.mp4");
    const red = await uploadSource(project.id, "red.mp4");
    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "source-clip", sourceId: red.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "text", startSeconds: 2, endSeconds: 8, data: { text: "SaarnaVideo", fontSize: "120", color: "white" } },
    ]);

    const { filePath } = await render(project.id);

    const info = await probe(filePath);
    expect(info.duration).toBeGreaterThan(9.8);
    expect(info.duration).toBeLessThan(10.3);
    expect(info.video).toMatchObject({ codec_name: "h264", width: 1920, height: 1080 });
    expect(info.audio).toMatchObject({ codec_name: "aac" });

    // Before the overlay: plain green.
    expect(isGreen(averageColor(await frameRgb(filePath, 1)))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 1, CENTER))).toBe(0);
    // Overlay on the green clip.
    const greenWithText = await frameRgb(filePath, 3);
    expect(isGreen(averageColor(await frameRgb(filePath, 3, { x: 0, y: 0, w: 300, h: 300 })))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 3, CENTER))).toBeGreaterThan(0.02);
    expect(greenWithText.length).toBe(1920 * 1080 * 3);
    // Overlay continues across the cut onto the red clip.
    expect(isRed(averageColor(await frameRgb(filePath, 7, { x: 0, y: 0, w: 300, h: 300 })))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 7, CENTER))).toBeGreaterThan(0.02);
    // After the overlay: plain red.
    expect(isRed(averageColor(await frameRgb(filePath, 9)))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 9, CENTER))).toBe(0);
  });

  it("creates a thumbnail after a full render", async () => {
    const project = await createProject("Thumbnail");
    const green = await uploadSource(project.id, "green.mp4");
    await setComposition(project.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 }], 5);
    const { jobId } = await render(project.id);

    const { jobs } = await api<{ jobs: Array<{ id: string; type: string }> }>(`/api/projects/${project.id}`);
    const thumbnailJob = jobs.find((job) => job.type === "THUMBNAIL");
    expect(thumbnailJob).toBeDefined();
    expect((await waitForJob(project.id, thumbnailJob!.id)).status).toBe("COMPLETED");

    const detail = await api<{ outputs: Array<{ id: string; type: string; jobId: string }> }>(`/api/projects/${project.id}`);
    const thumbnail = detail.outputs.find((output) => output.type === "THUMBNAIL");
    expect(thumbnail?.jobId).not.toBe(jobId);
    const thumbnailPath = `${mediaRoot}/download-${thumbnail!.id}.jpg`;
    await download(thumbnail!.id, thumbnailPath);
    expect(isGreen(averageColor(await frameRgb(thumbnailPath, 0)))).toBe(true);
  });

  it("crossfades between clips, shortening the timeline by the transition", async () => {
    const project = await createProject("Crossfade");
    const green = await uploadSource(project.id, "green.mp4");
    const red = await uploadSource(project.id, "red.mp4");
    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "source-clip", sourceId: red.id, startSeconds: 0, endSeconds: 5, transitionIn: { type: "crossfade", durationSeconds: 2 } },
    ]);

    const { filePath } = await render(project.id);

    const info = await probe(filePath);
    expect(info.duration).toBeGreaterThan(7.8);
    expect(info.duration).toBeLessThan(8.3);
    expect(isGreen(averageColor(await frameRgb(filePath, 1.5)))).toBe(true);
    const middle = averageColor(await frameRgb(filePath, 4));
    expect(middle.r).toBeGreaterThan(60);
    expect(middle.g).toBeGreaterThan(30);
    expect(isRed(averageColor(await frameRgb(filePath, 7)))).toBe(true);
  });

  it("renders a standalone title slate before a clip, trimming the clip to its range", async () => {
    const project = await createProject("Slate");
    const green = await uploadSource(project.id, "green.mp4");
    await setComposition(project.id, [
      { type: "slate", mode: "standalone", durationSeconds: 3, data: { title: "Opening" } },
      { type: "source-clip", sourceId: green.id, startSeconds: 1, endSeconds: 4 },
    ]);

    const { filePath } = await render(project.id);

    const info = await probe(filePath);
    expect(info.duration).toBeGreaterThan(5.8);
    expect(info.duration).toBeLessThan(6.3);
    expect(isBlack(averageColor(await frameRgb(filePath, 1, { x: 0, y: 0, w: 300, h: 300 })))).toBe(true);
    expect(whiteShare(await frameRgb(filePath, 1, CENTER))).toBeGreaterThan(0.01);
    expect(isGreen(averageColor(await frameRgb(filePath, 4.5)))).toBe(true);
  });

  it("composites an uploaded image asset as an overlay", async () => {
    const project = await createProject("Image overlay");
    const green = await uploadSource(project.id, "green.mp4");
    await uploadAsset(project.id, "logo.png", "logo");
    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "image", imageAsset: "logo", x: 100, y: 100, startSeconds: 0, endSeconds: 5 },
    ], 5);

    const { filePath } = await render(project.id);

    const overlayColor = averageColor(await frameRgb(filePath, 2, { x: 150, y: 150, w: 100, h: 100 }));
    expect(isBlue(overlayColor), `overlay region colour ${JSON.stringify(overlayColor)}`).toBe(true);
    const backgroundColor = averageColor(await frameRgb(filePath, 2, { x: 600, y: 600, w: 300, h: 300 }));
    expect(isGreen(backgroundColor), `background region colour ${JSON.stringify(backgroundColor)}`).toBe(true);
  });

  it("renders a small preview", async () => {
    const project = await createProject("Preview");
    const green = await uploadSource(project.id, "green.mp4");
    await setComposition(project.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 }], 5);

    const { filePath } = await render(project.id, "PREVIEW");

    const info = await probe(filePath);
    expect(info.video).toMatchObject({ width: 640, height: 360 });
    expect(isGreen(averageColor(await frameRgb(filePath, 2)))).toBe(true);
  });

  it("fails the job with a useful error when the composition references a missing source", async () => {
    const project = await createProject("Broken");
    await setComposition(project.id, [{ type: "source-clip", sourceId: "does-not-exist", startSeconds: 0, endSeconds: 5 }], 5);

    const job = await api<{ id: string }>(`/api/projects/${project.id}/generate`, { method: "POST", json: {} });
    const done = await waitForJob(project.id, job.id);

    expect(done.status).toBe("FAILED");
    expect(done.error).toContain("does-not-exist");
  });
});

describe("project lifecycle", () => {
  it("keeps a source file while a duplicate uses it and removes it with the last project", async () => {
    const project = await createProject("Original");
    const green = await uploadSource(project.id, "green.mp4");
    const original = await api<{ sources: Array<{ id: string; storagePath: string }> }>(`/api/projects/${project.id}`);
    const storagePath = original.sources.find((source) => source.id === green.id)!.storagePath;
    const copy = await api<{ id: string }>(`/api/projects/${project.id}/duplicate`, { method: "POST" });

    await api(`/api/projects/${project.id}`, { method: "DELETE" }, 204);
    expect(await exists(storagePath)).toBe(true);
    await api(`/api/sources/${green.id}`, {}, 404);

    await api(`/api/projects/${copy.id}`, { method: "DELETE" }, 204);
    expect(await exists(storagePath)).toBe(false);
  });
});
