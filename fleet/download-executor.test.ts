import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import executor, { readPayload, scrub, type DownloadRuntime } from "./download-executor.mjs";
import { installFakeYtDlp } from "./fake-ytdlp.test-helper.mjs";

const COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret-cookie-value-123\n";
let dir: string; let bucketDir: string; let origPath: string | undefined; let n = 0;

function diskS3(root: string) {
  const file = (b: string, k: string) => path.join(root, b, k);
  return {
    async getFile(b: string, k: string, to: string) { await mkdir(path.dirname(to), { recursive: true }); await copyFile(file(b, k), to); },
    async putFile(b: string, k: string, from: string) { await mkdir(path.dirname(file(b, k)), { recursive: true }); await copyFile(from, file(b, k)); return (await stat(from)).size; },
  };
}
function runtime(extra: Partial<DownloadRuntime> = {}) {
  const abort = new AbortController();
  const events: string[] = []; const pcts: (number | null)[] = [];
  const workDir = path.join(dir, `work${n++}`);
  const rt: DownloadRuntime = { workDir, signal: abort.signal, setState: s => { events.push(s); }, progress: p => { pcts.push(p.pct); }, s3: diskS3(bucketDir), ...extra };
  return { rt, abort, events, pcts, workDir };
}
const spec = (over: object = {}) => ({ id: "j1", download: { url: "https://www.youtube.com/watch?v=abc" }, inputs: [], outputs: [{ name: "video", uri: "s3://b/out/video.mp4" }], ...over });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dl-exec-"));
  bucketDir = path.join(dir, "bucket");
  origPath = process.env.PATH;
  process.env.PATH = `${await installFakeYtDlp(dir)}${path.delimiter}${origPath}`;
});
afterAll(async () => { process.env.PATH = origPath; await rm(dir, { recursive: true, force: true }); });
beforeEach(() => { for (const k of ["FAKE_YTDLP_MODE", "FAKE_YTDLP_LOG", "FAKE_YTDLP_PID", "FAKE_YTDLP_TOUCH_COOKIES"]) delete process.env[k]; });

describe("download executor", () => {
  it("is a download-type executor", () => { expect(executor.type).toBe("download"); expect(typeof executor.run).toBe("function"); });

  it("downloads to the video output and reports progress", async () => {
    const { rt, pcts, events } = runtime();
    const result = await executor.run(spec(), rt);
    expect(result.outputs.map(o => o.name)).toEqual(["video"]);
    expect(await readFile(path.join(bucketDir, "b/out/video.mp4"), "utf8")).toContain("FAKE-MP4:https://www.youtube.com/watch?v=abc");
    expect(pcts).toEqual([10, 55.5, 100]);
    expect(events).toContain("uploading");
  });

  it("copies the cookie file into the work dir and passes the copy, not the original", async () => {
    await mkdir(path.join(bucketDir, "b/in"), { recursive: true });
    await writeFile(path.join(bucketDir, "b/in/cookies.txt"), COOKIES);
    process.env.FAKE_YTDLP_LOG = path.join(dir, "args.log");
    const { rt, workDir } = runtime();
    await executor.run(spec({ inputs: [{ name: "cookies", uri: "s3://b/in/cookies.txt" }] }), rt);
    const args = JSON.parse((await readFile(process.env.FAKE_YTDLP_LOG, "utf8")).trim().split("\n").at(-1)!) as string[];
    const used = args[args.indexOf("--cookies") + 1];
    expect(used.startsWith(workDir)).toBe(true);
    expect(await readFile(path.join(bucketDir, "b/in/cookies.txt"), "utf8")).toBe(COOKIES);
  });

  it("returns updated cookies in cookies-out only when yt-dlp changed them", async () => {
    await mkdir(path.join(bucketDir, "b/in"), { recursive: true });
    await writeFile(path.join(bucketDir, "b/in/cookies.txt"), COOKIES);
    const s = spec({ inputs: [{ name: "cookies", uri: "s3://b/in/cookies.txt" }], outputs: [{ name: "video", uri: "s3://b/out/v2.mp4" }, { name: "cookies-out", uri: "s3://b/out/cookies-out.txt" }] });
    const unchanged = await executor.run(s, runtime().rt);
    expect(unchanged.outputs.map(o => o.name)).toEqual(["video"]);
    expect(existsSync(path.join(bucketDir, "b/out/cookies-out.txt"))).toBe(false);
    process.env.FAKE_YTDLP_TOUCH_COOKIES = "1";
    const changed = await executor.run(s, runtime().rt);
    expect(changed.outputs.map(o => o.name)).toEqual(["video", "cookies-out"]);
    expect(await readFile(path.join(bucketDir, "b/out/cookies-out.txt"), "utf8")).toContain("FRESH");
  });

  it("never puts cookie contents or the cookie path into the error, and returns no stderr tail", async () => {
    await mkdir(path.join(bucketDir, "b/in"), { recursive: true });
    await writeFile(path.join(bucketDir, "b/in/cookies.txt"), COOKIES);
    process.env.FAKE_YTDLP_MODE = "fail";
    const { rt, workDir } = runtime();
    const err = await executor.run(spec({ inputs: [{ name: "cookies", uri: "s3://b/in/cookies.txt" }] }), rt).catch(e => e as Error & { code?: string });
    expect(err).toBeInstanceOf(Error);
    const text = `${(err as Error).message} ${JSON.stringify(err)}`;
    expect(text).toMatch(/exited with code 3/);
    expect(text).toMatch(/Sign in to confirm/);
    expect(text).not.toContain("secret-cookie-value-123");
    expect(text).not.toContain(workDir);
    expect((err as { code?: string }).code).toBe("YTDLP_EXIT");
  });

  it("gives a readable error on a non-zero exit without cookies", async () => {
    process.env.FAKE_YTDLP_MODE = "fail";
    await expect(executor.run(spec(), runtime().rt)).rejects.toThrow(/yt-dlp exited with code 3: ERROR: Sign in/);
  });

  it("kills yt-dlp when the signal aborts", async () => {
    process.env.FAKE_YTDLP_MODE = "hang";
    process.env.FAKE_YTDLP_PID = path.join(dir, "hang.pid");
    const { rt, abort } = runtime();
    const reason = new Error("cancelled");
    const done = executor.run(spec(), rt).catch(e => e);
    for (let i = 0; i < 100 && !existsSync(process.env.FAKE_YTDLP_PID); i++) await new Promise(r => setTimeout(r, 50));
    const pid = Number(await readFile(process.env.FAKE_YTDLP_PID, "utf8"));
    abort.abort(reason);
    expect(await done).toBe(reason);
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) { try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 50)); } catch { alive = false; } }
    expect(alive).toBe(false);
  });

  it("explains a missing yt-dlp binary", async () => {
    const saved = process.env.YTDLP_PATH; process.env.YTDLP_PATH = path.join(dir, "nope");
    try { await expect(executor.run(spec(), runtime().rt)).rejects.toThrow(/yt-dlp is not installed/); } finally { if (saved === undefined) delete process.env.YTDLP_PATH; else process.env.YTDLP_PATH = saved; }
  });
});

describe("payload validation and scrubbing", () => {
  it("requires an http(s) url and rejects dangerous yt-dlp options", () => {
    expect(() => readPayload({ download: { url: "file:///etc/passwd" } })).toThrow(/http/);
    expect(() => readPayload({})).toThrow(/required/);
    expect(() => readPayload({ download: { url: "https://x.test/v", extraArgs: ["--exec", "rm -rf /"] } })).toThrow(/not allowed/);
    expect(() => readPayload({ download: { url: "https://x.test/v", extraArgs: ["--cookies=/etc/x"] } })).toThrow(/not allowed/);
    expect(readPayload({ download: { url: "https://x.test/v", extraArgs: ["--limit-rate", "5M"], format: "b" } })).toEqual({ url: "https://x.test/v", format: "b", extraArgs: ["--limit-rate", "5M"] });
  });
  it("scrub removes the path, secrets and cookie-shaped lines", () => {
    const out = scrub("see /w/cookies.txt token abcdef123\n.a.com\tTRUE\t/\tTRUE\t0\tN\tV\nplain", { cookiePath: "/w/cookies.txt", secrets: ["abcdef123"] });
    expect(out).toBe("see <cookies> token [redacted]\nplain");
  });
});
