import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeChapters } from "./lcyt-feed";

const run = promisify(execFile);
let dir: string;

beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "chapters-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe("probeChapters (real ffmpeg)", () => {
  it("reads the chapters written into an mp4, as yt-dlp --embed-chapters does", async () => {
    const meta = path.join(dir, "meta.txt");
    await writeFile(meta, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Alku\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Saarna\n");
    const file = path.join(dir, "with.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3:r=10", "-i", meta, "-map_metadata", "1", "-map_chapters", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    expect(await probeChapters(file)).toEqual([{ startSeconds: 0, endSeconds: 1.5, title: "Alku" }, { startSeconds: 1.5, endSeconds: 3, title: "Saarna" }]);
  });

  it("is empty for a file without chapters or one that is not a video", async () => {
    const file = path.join(dir, "plain.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1:r=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    expect(await probeChapters(file)).toEqual([]);
    expect(await probeChapters(path.join(dir, "missing.mp4"))).toEqual([]);
  });
});
