import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFleet, type Fleet, type JobSnapshot, type S3Client } from "fffleet";
import { FfprobeUnavailableError, probeViaFleet, usesFleetProbe } from "@/integrations/fleet-probe";
import { probeAudioFile } from "@/integrations/audio-assets";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

/** A disk-backed stand-in for the S3 client (same approach as remote-download.test.ts). */
function diskS3(dir: string): S3Client {
  const file = (bucket: string, key: string) => path.join(dir, bucket, key);
  return {
    async getFile(bucket, key, to) { await mkdir(path.dirname(to), { recursive: true }); await copyFile(file(bucket, key), to); },
    async head(bucket, key) { const s = await stat(file(bucket, key)); return { size: s.size, etag: null }; },
    async putFile(bucket, key, from) { await mkdir(path.dirname(file(bucket, key)), { recursive: true }); await copyFile(from, file(bucket, key)); return (await stat(from)).size; },
    async putDirectory() { return 0; },
    async deleteObject(bucket, key) { await rm(file(bucket, key), { force: true }); },
    async createBucket() {},
  };
}

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listAll(p)); else out.push(p);
  }
  return out;
}

/** A fake fleet whose submit answers with the given snapshot (or never answers, or refuses the submit). */
function fakeFleet(answer: JobSnapshot | "hang" | Error | ((spec: unknown) => JobSnapshot)) {
  const submitted: any[] = [];
  const cancelled: string[] = [];
  const fleet = {
    mode: "remote",
    async submit(spec: any) {
      submitted.push(spec);
      if (answer instanceof Error) throw answer;
      const done = answer === "hang"
        ? new Promise<JobSnapshot>(() => undefined)
        : Promise.resolve(typeof answer === "function" ? answer(spec) : answer);
      return { id: spec.id ?? "job", done, cancel: async () => { cancelled.push(spec.id ?? "job"); }, on() { return this; } };
    },
    async capabilities() { return {}; },
    async close() {},
  } as unknown as Fleet;
  return { fleet, submitted, cancelled };
}

function snapshot(state: JobSnapshot["state"], extra: Partial<JobSnapshot> = {}): JobSnapshot {
  return { id: "j", kind: "batch", type: "ffprobe", class: "default", owner: "", priority: 0, labels: {}, state, workerId: null, createdAt: "", startedAt: null, finishedAt: null, progress: null, exitCode: null, error: null, outputs: [], stderrTail: null, seq: 1, ...extra } as JobSnapshot;
}

const probeOk = (data: unknown) => snapshot("succeeded", { outputs: [{ name: "probe", uri: "inline:", bytes: 1, data }] });

describe("usesFleetProbe", () => {
  it("is on for RENDER_EXECUTOR=fffleet or a fleet URL, off otherwise", () => {
    expect(usesFleetProbe({})).toBe(false);
    expect(usesFleetProbe({ RENDER_EXECUTOR: "local" })).toBe(false);
    expect(usesFleetProbe({ RENDER_EXECUTOR: "fffleet" })).toBe(true);
    expect(usesFleetProbe({ FFFLEET_URL: "http://fleet:5000" })).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)("probeViaFleet with real files (in-process runner)", () => {
  let dir: string;
  let wav: string;
  let webmNoDuration: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fleet-probe-"));
    wav = path.join(dir, "tone.wav");
    webmNoDuration = path.join(dir, "recording.webm");
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", wav, "-y"]);
    // A stream written to a pipe has no duration in its header, like a MediaRecorder recording.
    const piped = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-c:a", "libopus", "-f", "webm", "pipe:1"], { maxBuffer: 16 * 1024 * 1024 });
    await writeFile(webmNoDuration, piped.stdout);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads the duration of a WAV file", async () => {
    const probe = await probeViaFleet(wav, { env: {} });
    expect(probe?.durationMs).toBeGreaterThan(1400);
    expect(probe?.durationMs).toBeLessThan(1600);
  });

  it("measures a WebM without header duration through a stream copy", async () => {
    const probe = await probeViaFleet(webmNoDuration, { env: {} });
    expect(probe?.durationMs).toBeGreaterThan(1300);
    expect(probe?.durationMs).toBeLessThan(1700);
  });

  it("returns null for a file that is not audio", async () => {
    const text = path.join(dir, "notes.txt");
    await writeFile(text, "this is not media at all\n");
    expect(await probeViaFleet(text, { env: {} })).toBeNull();
  });

  it("stages through S3 and leaves nothing behind in the bucket", async () => {
    const bucketDir = path.join(dir, "bucket");
    const s3 = diskS3(bucketDir);
    const fleet = createFleet({ fallback: "local", local: { s3, workRoot: path.join(dir, "work"), kinds: ["batch"] } });
    try {
      expect((await probeViaFleet(wav, { fleet, s3, bucket: "bkt", prefix: "app" }))?.durationMs).toBeGreaterThan(1400);
      expect((await probeViaFleet(webmNoDuration, { fleet, s3, bucket: "bkt", prefix: "app" }))?.durationMs).toBeGreaterThan(1300);
      expect(await listAll(bucketDir)).toEqual([]);
    } finally {
      await fleet.close();
    }
  });
});

describe("probeViaFleet error mapping and cleanup (fakes)", () => {
  let dir: string;
  let file: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fleet-probe-fake-"));
    file = path.join(dir, "take.mp3");
    await writeFile(file, "bytes");
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  function fakeS3() {
    const objects = new Map<string, string>();
    const deleted: string[] = [];
    const s3 = {
      async putFile(bucket: string, key: string) { objects.set(`${bucket}/${key}`, "x"); return 5; },
      async deleteObject(bucket: string, key: string) { deleted.push(`${bucket}/${key}`); objects.delete(`${bucket}/${key}`); },
      async getFile() {}, async head() { return { size: 0, etag: null }; }, async putDirectory() { return 0; }, async createBucket() {},
    } as unknown as S3Client;
    return { s3, objects, deleted };
  }

  it("reads the duration from the fleet's inline ffprobe result and deletes the staged object", async () => {
    const { s3, objects, deleted } = fakeS3();
    const { fleet, submitted } = fakeFleet(probeOk({ streams: [{ codec_type: "audio" }], format: { duration: "2.5" } }));
    expect(await probeViaFleet(file, { fleet, s3, bucket: "bkt", prefix: "app" })).toEqual({ durationMs: 2500 });
    expect(submitted[0].type).toBe("ffprobe");
    expect(submitted[0].inputs[0].uri).toMatch(/^s3:\/\/bkt\/app\/tmp\/probe-[0-9a-f-]+\/in\.mp3$/);
    expect(deleted).toEqual([submitted[0].inputs[0].uri.replace("s3://", "")]);
    expect(objects.size).toBe(0);
  });

  it("deletes the staged object when the upload fails", async () => {
    const deleted: string[] = [];
    const s3 = { async putFile() { throw new Error("connection reset"); }, async deleteObject(b: string, k: string) { deleted.push(`${b}/${k}`); } } as unknown as S3Client;
    const { fleet } = fakeFleet(probeOk({}));
    await expect(probeViaFleet(file, { fleet, s3, bucket: "bkt", prefix: "app" })).rejects.toThrow(/could not run: connection reset/);
    expect(deleted).toHaveLength(1);
  });

  it("answers null (not a server error) when the file itself is refused", async () => {
    const { s3, deleted } = fakeS3();
    const refused = snapshot("failed", { error: { code: "FFPROBE_EXIT", message: "ffprobe exited with code 1" } });
    expect(await probeViaFleet(file, { fleet: fakeFleet(refused).fleet, s3, bucket: "bkt", prefix: "app" })).toBeNull();
    expect(deleted).toHaveLength(1);
  });

  it("answers null for a file without an audio stream", async () => {
    const { fleet } = fakeFleet(probeOk({ streams: [{ codec_type: "video" }], format: { duration: "9" } }));
    expect(await probeViaFleet(file, { fleet })).toBeNull();
  });

  it("maps a failed fleet job (S3 input could not be read) to FfprobeUnavailableError", async () => {
    const { s3, deleted } = fakeS3();
    const broken = snapshot("failed", { error: { code: "INPUT_FAILED", message: "could not fetch input \"in\": HTTP 503" } });
    const error = await probeViaFleet(file, { fleet: fakeFleet(broken).fleet, s3, bucket: "bkt", prefix: "app" }).catch(e => e);
    expect(error).toBeInstanceOf(FfprobeUnavailableError);
    expect(error.message).toMatch(/INPUT_FAILED/);
    expect(deleted).toHaveLength(1);
  });

  it("maps a worker without ffprobe (SPAWN_FAILED) to the readable 503 message", async () => {
    const spawn = snapshot("failed", { error: { code: "SPAWN_FAILED", message: "could not start ffprobe" } });
    const error = await probeViaFleet(file, { fleet: fakeFleet(spawn).fleet }).catch(e => e);
    expect(error).toBeInstanceOf(FfprobeUnavailableError);
    expect(error.message).toBe("ffprobe is not available on the app server");
  });

  it("maps a submit that the fleet refuses to FfprobeUnavailableError", async () => {
    const error = await probeViaFleet(file, { fleet: fakeFleet(new Error("fleet unreachable")).fleet }).catch(e => e);
    expect(error).toBeInstanceOf(FfprobeUnavailableError);
    expect(error.message).toMatch(/not accepted: fleet unreachable/);
  });

  it("times out after the limit: cancels the job, deletes the staged object and rejects with a 503 error", async () => {
    const { s3, deleted } = fakeS3();
    const hung = fakeFleet("hang");
    const started = Date.now();
    const error = await probeViaFleet(file, { fleet: hung.fleet, s3, bucket: "bkt", prefix: "app", timeoutMs: 300 }).catch(e => e);
    expect(error).toBeInstanceOf(FfprobeUnavailableError);
    expect(error.message).toMatch(/did not finish within 300 ms/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(hung.cancelled).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });

  it("probeAudioFile uses the fleet when FFFLEET_URL is set", async () => {
    vi.stubEnv("FFFLEET_URL", "http://127.0.0.1:9");
    vi.stubEnv("RENDER_EXECUTOR", "local");
    try {
      // Without a staging bucket the fleet path runs in-process; a missing ffprobe there is still the 503 error.
      vi.stubEnv("PATH", "/nonexistent-bin-dir-for-test");
      const error = await probeAudioFile(file).catch(e => e);
      expect(error).toBeInstanceOf(FfprobeUnavailableError);
      expect(error.message).toBe("ffprobe is not available on the app server");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("an in-process probe without ffprobe on the host is FfprobeUnavailableError", async () => {
    vi.stubEnv("PATH", "/nonexistent-bin-dir-for-test");
    try {
      const error = await probeViaFleet(file, { env: {} }).catch(e => e);
      expect(error).toBeInstanceOf(FfprobeUnavailableError);
      expect(error.message).toBe("ffprobe is not available on the app server");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
