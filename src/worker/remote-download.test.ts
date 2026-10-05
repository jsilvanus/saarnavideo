import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFleet, type S3Client } from "fffleet";
import downloadExecutor from "../../fleet/download-executor.mjs";
import { installFakeYtDlp } from "../../fleet/fake-ytdlp.test-helper.mjs";
import { createRemoteDownloader, createRemoteDownloaderFromEnv } from "@/worker/remote-download";

function diskS3(dir: string): S3Client {
  const file = (bucket: string, key: string) => path.join(dir, bucket, key);
  return {
    async getFile(bucket, key, to) { await mkdir(path.dirname(to), { recursive: true }); await copyFile(file(bucket, key), to); },
    async head(bucket, key) { const s = await stat(file(bucket, key)); return { size: s.size, etag: `"${s.size}-${s.mtimeMs}"` }; },
    async putFile(bucket, key, from) { await mkdir(path.dirname(file(bucket, key)), { recursive: true }); await copyFile(from, file(bucket, key)); return (await stat(from)).size; },
    async putDirectory() { return 0; },
    async deleteObject(bucket, key) { await rm(file(bucket, key), { force: true }); },
    async createBucket() {},
  };
}
async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await listAll(p)); else out.push(p); }
  return out;
}

describe("DOWNLOAD_EXECUTOR", () => {
  it("is off by default and demands S3 settings when on", () => {
    expect(createRemoteDownloaderFromEnv({})).toBeNull();
    expect(createRemoteDownloaderFromEnv({ DOWNLOAD_EXECUTOR: "local" })).toBeNull();
    expect(() => createRemoteDownloaderFromEnv({ DOWNLOAD_EXECUTOR: "fffleet" })).toThrow(/DOWNLOAD_EXECUTOR=fffleet needs FFFLEET_S3_BUCKET/);
  });
});

describe("createRemoteDownloader (in-process fleet, disk bucket, fake yt-dlp)", () => {
  let dir: string; let bucket: string; let origPath: string | undefined; let fleet: ReturnType<typeof createFleet>; let downloader: ReturnType<typeof createRemoteDownloader>;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "remote-dl-"));
    origPath = process.env.PATH;
    process.env.PATH = `${await installFakeYtDlp(dir)}${path.delimiter}${origPath}`;
    bucket = path.join(dir, "bucket");
    const s3 = diskS3(bucket);
    fleet = createFleet({ fallback: "local", local: { s3, workRoot: path.join(dir, "work"), kinds: ["batch"], executors: { download: downloadExecutor.run as never } } });
    downloader = createRemoteDownloader({ fleet, s3, bucket: "bkt", prefix: "app" });
  });
  afterAll(async () => { process.env.PATH = origPath; await downloader.close(); await rm(dir, { recursive: true, force: true }); });
  beforeEach(() => { delete process.env.FAKE_YTDLP_MODE; delete process.env.FAKE_YTDLP_TOUCH_COOKIES; });

  it("copies the video to the output path, reports progress and leaves nothing in the bucket", async () => {
    const out = path.join(dir, "media/sources/p/abc.mp4");
    const seen: number[] = [];
    const r = await downloader.run({ jobId: "job1", url: "https://youtu.be/abc", outputPath: out, onProgress: p => seen.push(p) });
    expect(r.cookiesUpdated).toBe(false);
    expect(await readFile(out, "utf8")).toContain("FAKE-MP4:https://youtu.be/abc");
    expect(seen.length).toBeGreaterThan(0);
    expect(await listAll(bucket)).toEqual([]);
  });

  it("stages the cookie file for the job, writes back only a changed file and cleans up", async () => {
    const cookies = path.join(dir, "cookies.txt");
    const original = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret-cookie-value-123\n";
    await writeFile(cookies, original, { mode: 0o600 });
    const out = path.join(dir, "media/c1.mp4");
    expect((await downloader.run({ jobId: "job2", url: "https://youtu.be/abc", outputPath: out, cookiesFile: cookies })).cookiesUpdated).toBe(false);
    expect(await readFile(cookies, "utf8")).toBe(original);
    process.env.FAKE_YTDLP_TOUCH_COOKIES = "1";
    expect((await downloader.run({ jobId: "job3", url: "https://youtu.be/abc", outputPath: out, cookiesFile: cookies })).cookiesUpdated).toBe(true);
    expect(await readFile(cookies, "utf8")).toContain("FRESH");
    expect((await stat(cookies)).mode & 0o777).toBe(0o600);
    expect(await listAll(bucket)).toEqual([]);
    expect((await readdir(dir)).filter(f => f.endsWith(".tmp"))).toEqual([]);
  });

  it("fails with a readable error that does not contain the cookies, and still cleans up", async () => {
    const cookies = path.join(dir, "cookies2.txt");
    await writeFile(cookies, ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret-cookie-value-123\n");
    process.env.FAKE_YTDLP_MODE = "fail";
    const err = await downloader.run({ jobId: "job4", url: "https://youtu.be/abc", outputPath: path.join(dir, "media/f.mp4"), cookiesFile: cookies }).then(() => new Error("did not fail"), e => e as Error);
    expect(err.message).toMatch(/Download failed on the fleet \(failed, YTDLP_EXIT: yt-dlp exited with code 3/);
    expect(err.message).not.toContain("secret-cookie-value-123");
    expect(await listAll(bucket)).toEqual([]);
  });

  it("cancel stops a running download", async () => {
    process.env.FAKE_YTDLP_MODE = "hang";
    const done = downloader.run({ jobId: "job5", url: "https://youtu.be/abc", outputPath: path.join(dir, "media/h.mp4") }).then(() => new Error("did not fail"), e => e as Error);
    await new Promise(r => setTimeout(r, 500));
    await downloader.cancel("job5");
    expect((await done).message).toMatch(/cancelled/i);
  });
});
