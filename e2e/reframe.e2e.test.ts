import { describe, expect, it } from "vitest";
import { api, createProject, type Item, isBlack, isGreen, isRed, probe, regionColor, render, setComposition, uploadSource, whiteShare, frameRgb } from "./helpers";

// split.mp4 is 640x360: left half red, right half green. Output 1080x1920: the frame's left half is x 0..539, right half 540..1079.
const VERTICAL = { width: 1080, height: 1920 };
const LEFT = { x: 60, y: 300, w: 400, h: 1300 };
const RIGHT = { x: 620, y: 300, w: 400, h: 1300 };
const TOP_BAR = { x: 0, y: 20, w: 1080, h: 200 };

const clip = (sourceId: string, extra: Record<string, unknown> = {}): Item => ({ type: "source-clip", sourceId, startSeconds: 0, endSeconds: 5, ...extra });

async function vertical(items: (sourceId: string) => Array<Record<string, unknown>>, extra: { template?: Record<string, unknown>; sections?: unknown[] } = {}, seconds = 5) {
  const project = await createProject("Reframe");
  const split = await uploadSource(project.id, "split.mp4");
  await setComposition(project.id, items(split.id) as never, seconds, { ...extra, template: { ...VERTICAL, ...extra.template } });
  return { project, split, ...(await render(project.id)) };
}

describe("output size and reframing", () => {
  it("renders 1080x1920 from a landscape source, centre-cropping by default", async () => {
    const { filePath } = await vertical((id) => [clip(id)]);
    const info = await probe(filePath);
    expect(info.video).toMatchObject({ width: 1080, height: 1920 });
    // The centre 9:16 column of the source straddles the red/green boundary: the frame is half red, half green, with no bars.
    expect(isRed(await regionColor(filePath, 2, LEFT))).toBe(true);
    expect(isGreen(await regionColor(filePath, 2, RIGHT))).toBe(true);
    expect(isRed(await regionColor(filePath, 2, TOP_BAR))).toBe(false);
    expect(isBlack(await regionColor(filePath, 2, TOP_BAR))).toBe(false);
  });

  it("crops the chosen rectangle of the source", async () => {
    const width = 202.5 / 640;
    const redOnly = await vertical((id) => [clip(id, { reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.05, y: 0, w: width, h: 1 } } })]);
    expect(isRed(await regionColor(redOnly.filePath, 2, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
    const greenOnly = await vertical((id) => [clip(id, { reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.6, y: 0, w: width, h: 1 } } })]);
    expect(isGreen(await regionColor(greenOnly.filePath, 2, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
  });

  it("zooms into a corner with a smaller crop", async () => {
    // Top-left quarter of the picture is all red; scaled up to cover the frame it fills it completely.
    const { filePath } = await vertical((id) => [clip(id, { reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0, y: 0, w: 0.15, h: 0.5 } } })]);
    expect(isRed(await regionColor(filePath, 2, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
  });

  it("fits the whole picture with plain bars in the template colour", async () => {
    const { filePath } = await vertical((id) => [clip(id, { reframe: { mode: "fit", fitBackground: "color" } })], { template: { backgroundColor: "black" } });
    expect(isBlack(await regionColor(filePath, 2, TOP_BAR))).toBe(true);
    expect(isBlack(await regionColor(filePath, 2, { x: 0, y: 1700, w: 1080, h: 200 }))).toBe(true);
    // The whole picture is visible: red left, green right, in the middle band.
    expect(isRed(await regionColor(filePath, 2, { x: 20, y: 800, w: 480, h: 300 }))).toBe(true);
    expect(isGreen(await regionColor(filePath, 2, { x: 580, y: 800, w: 480, h: 300 }))).toBe(true);
  });

  it("fits the whole picture with blurred bars", async () => {
    const { filePath } = await vertical((id) => [clip(id, { reframe: { mode: "fit", fitBackground: "blur" } })]);
    expect(isBlack(await regionColor(filePath, 2, TOP_BAR))).toBe(false);
    const bar = await regionColor(filePath, 2, TOP_BAR);
    // A blurred, enlarged copy of the picture: contains both the red and the green half.
    expect(bar.r).toBeGreaterThan(60);
    expect(bar.g).toBeGreaterThan(30);
    expect(isRed(await regionColor(filePath, 2, { x: 20, y: 800, w: 480, h: 300 }))).toBe(true);
    expect(isGreen(await regionColor(filePath, 2, { x: 580, y: 800, w: 480, h: 300 }))).toBe(true);
  });

  it("uses the reframe of a section for its clips and lets a clip override it", async () => {
    const project = await createProject("Section reframe");
    const split = await uploadSource(project.id, "split.mp4");
    const sections = [{ id: "sec1", label: "Sermon", scope: "SOURCE", origin: "MANUAL", sourceId: split.id, startSeconds: 0, endSeconds: 5, reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.05, y: 0, w: 202.5 / 640, h: 1 } } }];
    await setComposition(project.id, [clip(split.id)], 5, { template: VERTICAL, sections });
    const fromSection = await render(project.id);
    expect(isRed(await regionColor(fromSection.filePath, 2, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);

    await setComposition(project.id, [clip(split.id, { reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.6, y: 0, w: 202.5 / 640, h: 1 } } })], 5, { template: VERTICAL, sections });
    const overridden = await render(project.id);
    expect(isGreen(await regionColor(overridden.filePath, 2, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
  });

  it("changes the crop from one section to the next within one video", async () => {
    const { filePath } = await vertical((id) => [
      clip(id, { endSeconds: 3, reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.05, y: 0, w: 202.5 / 640, h: 1 } } }),
      clip(id, { startSeconds: 1, endSeconds: 4, reframe: { mode: "custom", fitBackground: "blur", crop: { x: 0.6, y: 0, w: 202.5 / 640, h: 1 } } }),
    ], {}, 6);
    expect((await probe(filePath)).duration).toBeGreaterThan(5.8);
    expect(isRed(await regionColor(filePath, 1.5, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
    expect(isGreen(await regionColor(filePath, 4.5, { x: 0, y: 0, w: 1080, h: 1920 }))).toBe(true);
  });

  it("renders other sizes exactly: 720p, square and 4:5", async () => {
    for (const [width, height] of [[1280, 720], [1080, 1080], [1080, 1350]] as const) {
      const { filePath } = await vertical((id) => [clip(id)], { template: { width, height } });
      expect((await probe(filePath)).video, `${width}x${height}`).toMatchObject({ width, height });
    }
  });

  it("scales a text overlay to the output size", async () => {
    // A 120 px title authored on the 1920 canvas becomes 60 px at 960x540 and stays inside the frame, centred.
    const project = await createProject("Small overlay");
    const green = await uploadSource(project.id, "green.mp4");
    await setComposition(project.id, [clip(green.id), { type: "overlay", kind: "text", startSeconds: 0, endSeconds: 5, data: { text: "SaarnaVideo", fontSize: "120", color: "white" } }], 5, { template: { width: 960, height: 540 } });
    const { filePath } = await render(project.id);
    expect((await probe(filePath)).video).toMatchObject({ width: 960, height: 540 });
    const text = await frameRgb(filePath, 2, { x: 0, y: 200, w: 960, h: 140 });
    expect(whiteShare(text)).toBeGreaterThan(0.01);
    // Text height: the white pixels stay within a ~90 px band around the centre (a 120 px font would need ~160).
    expect(whiteShare(await frameRgb(filePath, 2, { x: 0, y: 0, w: 960, h: 190 }))).toBe(0);
  });

  it("keeps the aspect ratio in the fast preview", async () => {
    const project = await createProject("Vertical preview");
    const split = await uploadSource(project.id, "split.mp4");
    await setComposition(project.id, [clip(split.id)], 5, { template: VERTICAL });
    const { filePath } = await render(project.id, "PREVIEW");
    const info = await probe(filePath);
    expect(info.video?.width).toBe(640);
    expect(info.video?.height).toBeGreaterThan(1100);
    expect(info.video!.height! / info.video!.width!).toBeCloseTo(16 / 9, 1);
  });
});

describe("size and reframe validation, duration notifier", () => {
  it("rejects an odd output size when saving and when generating", async () => {
    const project = await createProject("Odd size");
    const definition = { version: 1, semanticSegments: [], sections: [], graphics: [], template: { key: "basic", width: 1081, height: 1920, fps: 30 }, composition: { sourceStartSeconds: 0, sourceEndSeconds: 5, items: [] } };
    const response = await api<{ error: string }>(`/api/projects/${project.id}`, { method: "PATCH", json: { definition } }, 400);
    expect(response.error).toContain("width");
  });

  it("rejects a custom reframe without a crop", async () => {
    const project = await createProject("Bad reframe");
    const definition = { version: 1, semanticSegments: [], sections: [], graphics: [], template: { key: "basic", width: 1080, height: 1920, fps: 30 }, composition: { sourceStartSeconds: 0, sourceEndSeconds: 5, items: [{ type: "source-clip", sourceId: "x", startSeconds: 0, endSeconds: 5, reframe: { mode: "custom" } }] } };
    const response = await api<{ error: string }>(`/api/projects/${project.id}`, { method: "PATCH", json: { definition } }, 400);
    expect(response.error).toContain("Clip 1 reframe");
  });

  it("warns, without blocking, when a Reel is longer than the platform allows", async () => {
    const project = await createProject("Long reel");
    await setComposition(project.id, [{ type: "slate", mode: "standalone", durationSeconds: 95, data: { title: "Long" } }], 95, { template: { ...VERTICAL, presetKey: "instagram-reels", targetSeconds: 60 } });
    const queued = await api<{ id: string; durationWarnings: Array<{ code: string; message: string }> }>(`/api/projects/${project.id}/generate`, { method: "POST", json: { preview: true } });
    const codes = queued.durationWarnings.map((warning) => warning.code);
    expect(codes).toContain("over-platform-limit");
    expect(codes).toContain("off-target");
    expect(queued.durationWarnings.find((warning) => warning.code === "over-platform-limit")!.message).toContain("Instagram Reels");
    // The warning does not block: the job was queued. Not waiting for 95 s of video.
    expect(queued.id).toBeTruthy();
    await api(`/api/projects/${project.id}/jobs/${queued.id}/cancel`, { method: "POST" }).catch(() => undefined);
  });
});
