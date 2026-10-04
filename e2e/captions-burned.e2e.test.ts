import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { api, createProject, download, frameRgb, importVtt, mediaRoot, probe, uploadSource, waitForJob } from "./helpers";

const execFileAsync = promisify(execFile);
const W = 1920;
const H = 1080;

// Green source cues are on the output timeline as they are; red clip starts at 5 s, so its cues shift by +5 s.
const GREEN_VTT = [
  "WEBVTT", "",
  "00:00:01.000 --> 00:00:02.000", "Hyvää huomenta", "",
  "00:00:02.500 --> 00:00:03.400", "AOA", "",
  "00:00:03.600 --> 00:00:04.500", "ÄÖÅ äöå", "",
].join("\n");
const LONG = "Kaikkivaltias Jumala, taivaallinen Isä, me kiitämme sinua tästä päivästä ja kaikesta hyvästä, jonka olemme saaneet vastaanottaa. Auta meitä kulkemaan valossasi ja rakastamaan lähimmäisiämme niin kuin sinä olet meitä rakastanut.";
const RED_VTT = `WEBVTT\n\n00:00:01.000 --> 00:00:04.500\n${LONG}\n`;

const captionLayer = (box: { x: number; y: number; width: number; height: number }, style: Record<string, string | number>) => ({ id: "cap", type: "caption", rotation: 0, text: "Esimerkkiteksti", ...box, style });
const styleBottom = { id: "style-bottom", name: "Alhaalla", width: W, height: H, backgroundColor: "transparent", layers: [captionLayer({ x: 160, y: 820, width: 1600, height: 200 }, { "font-family": "DejaVu Sans", "font-size": "56px", "font-weight": "700", color: "#ffffff", "text-align": "center", "vertical-align": "bottom", background: "rgba(0,0,0,0.6)", padding: "12px", "max-lines": 2 })] };
const styleTop = { id: "style-top", name: "Ylhäällä", width: W, height: H, backgroundColor: "transparent", layers: [captionLayer({ x: 100, y: 100, width: 1000, height: 300 }, { "font-size": "48px", "font-weight": "700", color: "#ffffff", "text-align": "left", "vertical-align": "top", "-webkit-text-stroke": "3px #000000", padding: "12px", "max-lines": 3 })] };
const plainGraphic = { id: "plain", name: "Tavallinen", width: W, height: H, backgroundColor: "#111", layers: [{ id: "t", type: "text", x: 0, y: 0, width: 100, height: 100, rotation: 0, text: "Hei", style: {} }] };

async function burnedProject(title: string) {
  const project = await createProject(title);
  const green = await uploadSource(project.id, "green.mp4");
  const red = await uploadSource(project.id, "red.mp4");
  await importVtt(green.id, GREEN_VTT);
  await importVtt(red.id, RED_VTT);
  const definition = {
    version: 1, semanticSegments: [], sections: [], graphics: [styleBottom, styleTop, plainGraphic],
    template: { key: "basic", width: W, height: H, fps: 30, backgroundColor: "black", textColor: "white" },
    composition: { sourceStartSeconds: 0, sourceEndSeconds: 10, items: [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "source-clip", sourceId: red.id, startSeconds: 0, endSeconds: 5 },
    ] },
  };
  await api(`/api/projects/${project.id}`, { method: "PATCH", json: { definition } });
  return project;
}

type OutputRow = { id: string; jobId: string; type: string; preview: boolean };
async function generate(projectId: string, body: Record<string, unknown>) {
  const job = await api<{ id: string }>(`/api/projects/${projectId}/generate`, { method: "POST", json: body });
  const done = await waitForJob(projectId, job.id);
  if (done.status !== "COMPLETED") throw new Error(`Render ${done.status}: ${done.error}`);
  const project = await api<{ outputs: OutputRow[] }>(`/api/projects/${projectId}`);
  const outputs = project.outputs.filter((output) => output.jobId === job.id);
  const video = outputs.find((output) => output.type === "VIDEO");
  if (!video) throw new Error(`No VIDEO output for job ${job.id}: ${JSON.stringify(project.outputs)}`);
  const filePath = `${mediaRoot}/burned-${video.id}.mp4`;
  await download(video.id, filePath);
  return { filePath, outputs };
}

/** Near-white pixels are caption text; the green (0,128,0) and red (255,0,0) sources and the dark box never reach that. */
type Box = { left: number; top: number; right: number; bottom: number; count: number };
function whiteBox(pixels: Buffer, width: number, height: number): Box | null {
  let box: Box | null = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) {
        if (!box) box = { left: x, top: y, right: x, bottom: y, count: 0 };
        box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y); box.count++;
      }
    }
  }
  return box;
}
const frameBox = async (filePath: string, seconds: number, width = W, height = H) => whiteBox(await frameRgb(filePath, seconds), width, height);
/** Source green is (0,128,0); H.264 round-trips it within a level or two. */
const plainGreen = ({ r, g, b }: { r: number; g: number; b: number }) => r <= 3 && Math.abs(g - 128) <= 3 && b <= 3;
const pixelAt = (pixels: Buffer, x: number, y: number, width = W) => ({ r: pixels[(y * width + x) * 3], g: pixels[(y * width + x) * 3 + 1], b: pixels[(y * width + x) * 3 + 2] });

// Caption region of styleBottom: x 160..1760, y 820..1020.
const inBottomRegion = (box: Box) => box.left >= 160 && box.right <= 1760 && box.top >= 820 && box.bottom <= 1020;

describe("burned-in captions", () => {
  it("draws text only during the cues, inside the style's box, wrapped, with Finnish characters", async () => {
    const project = await burnedProject("Burned captions bottom");
    const { filePath, outputs } = await generate(project.id, { captions: { mode: "burn", styleGraphicId: "style-bottom" } });

    // Burn only: no soft track, no sidecars.
    expect(outputs.map((output) => output.type)).toEqual(["VIDEO"]);
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath]);
    expect(stdout).not.toContain("subtitle");
    const info = await probe(filePath);
    expect(info.video).toMatchObject({ width: W, height: H });

    // Outside every cue nothing near-white appears anywhere in the frame.
    for (const t of [0.4, 2.25, 3.5, 4.75, 5.5, 9.75]) expect(await frameBox(filePath, t), `t=${t}`).toBeNull();

    // Cue 1: text is inside the caption box, horizontally centred, one line, nowhere else in the frame.
    const hello = (await frameBox(filePath, 1.5))!;
    expect(hello.count).toBeGreaterThan(300);
    expect(inBottomRegion(hello)).toBe(true);
    expect(Math.abs((hello.left + hello.right) / 2 - 960)).toBeLessThan(40);
    expect(hello.bottom - hello.top).toBeLessThan(75); // one line

    // The translucent box: dark green inside the bar, untouched green above it.
    const frame = await frameRgb(filePath, 1.5);
    const inside = pixelAt(frame, 170, 950);
    expect(inside.g).toBeGreaterThan(20);
    expect(inside.g).toBeLessThan(80);
    expect(inside.r + inside.b).toBeLessThan(20);
    expect(pixelAt(frame, 170, 800)).satisfy(plainGreen);
    expect(pixelAt(frame, 100, 950)).satisfy(plainGreen); // left of the box

    // Finnish: capitals with diaeresis / ring reach higher than plain capitals, so the glyphs exist (not blank boxes or dropped).
    const plain = (await frameBox(filePath, 2.95))!;
    const finnish = (await frameBox(filePath, 4.05))!;
    expect(finnish.count).toBeGreaterThan(300);
    expect(inBottomRegion(finnish)).toBe(true);
    expect(finnish.bottom - finnish.top).toBeGreaterThan(plain.bottom - plain.top + 3);

    // Long red-clip cue (6.0-9.5 s): wrapped to the box width, paged two lines at a time, always inside the box.
    const page1 = (await frameBox(filePath, 6.4))!;
    expect(inBottomRegion(page1)).toBe(true);
    expect(page1.bottom - page1.top).toBeGreaterThan(100); // two lines
    expect(page1.right - page1.left).toBeLessThanOrEqual(1600 - 24);
    const page1Frame = await frameRgb(filePath, 6.4);
    const bar = (frameData: Buffer) => { let rows = 0; for (let y = 800; y < 1040; y++) if (pixelAt(frameData, 170, y).r < 200 && pixelAt(frameData, 170, y).r > 20) rows++; return rows; };
    expect(bar(page1Frame)).toBeGreaterThan(140); // ~154 px bar for two lines vs ~89 for one
    expect(bar(await frameRgb(filePath, 1.5))).toBeLessThan(110);
    for (const t of [7.6, 8.9]) {
      const later = (await frameBox(filePath, t))!;
      expect(inBottomRegion(later)).toBe(true);
    }
    // The text changes between pages.
    expect((await frameRgb(filePath, 7.6)).equals(page1Frame)).toBe(false);
  }, 240_000);

  it("moves the text with the style's box position and alignment", async () => {
    const project = await burnedProject("Burned captions top");
    const { filePath } = await generate(project.id, { captions: { mode: "burn", styleGraphicId: "style-top" } });
    // Box x 100..1100, y 100..400, top-left aligned, padding 12: nothing in the bottom half or right part.
    const hello = (await frameBox(filePath, 1.5))!;
    expect(hello.count).toBeGreaterThan(300);
    expect(hello.left).toBeGreaterThanOrEqual(100);
    expect(hello.left).toBeLessThan(140); // left aligned at x + padding
    expect(hello.right).toBeLessThanOrEqual(1100);
    expect(hello.top).toBeGreaterThanOrEqual(100);
    expect(hello.bottom).toBeLessThanOrEqual(400);
    const whole = (await frameBox(filePath, 6.4))!; // long cue: three lines max, all in the top box
    expect(whole.top).toBeGreaterThanOrEqual(100);
    expect(whole.bottom).toBeLessThanOrEqual(400);
    expect(whole.right).toBeLessThanOrEqual(1100);
    expect(whole.bottom - whole.top).toBeGreaterThan(120); // more than two lines of 48 px
    expect(await frameBox(filePath, 2.25)).toBeNull();
    // No background box: the frame outside the outlined glyphs stays plain green.
    const frame = await frameRgb(filePath, 1.5);
    expect(pixelAt(frame, 1000, 300)).satisfy(plainGreen);
  }, 240_000);

  it("uses the built-in default style and combines with soft captions in both mode", async () => {
    const project = await burnedProject("Burned captions both");
    const { filePath, outputs } = await generate(project.id, { captions: { mode: "both" } });
    expect(outputs.map((output) => output.type).sort()).toEqual(["CAPTIONS_SRT", "CAPTIONS_VTT", "VIDEO"]);
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "csv=p=0", filePath]);
    expect(stdout).toContain("mov_text");
    const hello = (await frameBox(filePath, 1.5))!;
    expect(hello.count).toBeGreaterThan(300);
    expect(inBottomRegion(hello)).toBe(true); // default style: bottom centre, same box as styleBottom
    expect(await frameBox(filePath, 2.25)).toBeNull();
  }, 240_000);

  it("keeps caption size proportional in fast previews (burned before the 640 px downscale)", async () => {
    const project = await burnedProject("Burned captions preview");
    const { filePath } = await generate(project.id, { preview: true, captions: { mode: "burn", styleGraphicId: "style-bottom" } });
    const info = await probe(filePath);
    expect(info.video).toMatchObject({ width: 640, height: 360 });
    const hello = (await frameBox(filePath, 1.5, 640, 360))!;
    expect(hello.count).toBeGreaterThan(30);
    // Full-size box y 820..1020 -> 273..340 at one third of the size; one line is ~20 px, not ~60.
    expect(hello.top).toBeGreaterThanOrEqual(273);
    expect(hello.bottom).toBeLessThanOrEqual(340);
    expect(hello.bottom - hello.top).toBeLessThan(30);
    expect(hello.bottom - hello.top).toBeGreaterThan(8);
    expect(await frameBox(filePath, 2.25, 640, 360)).toBeNull();
  }, 240_000);

  it("rejects an unknown or non-caption style graphic", async () => {
    const project = await burnedProject("Burned captions invalid style");
    const missing = await api<{ error: string }>(`/api/projects/${project.id}/generate`, { method: "POST", json: { captions: { mode: "burn", styleGraphicId: "nope" } } }, 400);
    expect(missing.error).toMatch(/not found/i);
    const plain = await api<{ error: string }>(`/api/projects/${project.id}/generate`, { method: "POST", json: { captions: { mode: "burn", styleGraphicId: "plain" } } }, 400);
    expect(plain.error).toMatch(/no caption layer/i);
  });
});
