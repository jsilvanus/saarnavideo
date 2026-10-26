import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFleet, createS3Client, s3ConfigFromEnv, type Fleet, type JobHandle, type JobSnapshot, type JobSpecInput, type S3Client, type S3Config } from "fffleet";

/**
 * Audio probing on an fffleet fleet (RENDER_EXECUTOR=fffleet or FFFLEET_URL set), so the app server needs no ffprobe or
 * ffmpeg. The probe is the fffleet job `type: 'ffprobe'` (one input, JSON returned inline). A WebM recording without a
 * header duration is stream-copied once (`ffmpeg -c copy` into Matroska, no decoding) and the copy is probed.
 *
 * Two modes:
 * - fleet: the uploaded temporary file is staged in S3 under `<prefix>/tmp/probe-<uuid>/` (deleted after the probe, also
 *   on timeout and failure), and the job reads it through an s3: URI;
 * - in-process: without a fleet URL, or without a staging bucket, the same jobs run in an in-process fffleet runner on the
 *   app server with file: URIs (needs ffprobe/ffmpeg there; a missing binary is FfprobeUnavailableError).
 *
 * The whole probe answers within PROBE_TIMEOUT_MS. A fleet that cannot be reached falls back to the in-process runner
 * (fffleet's `fallback: 'local'`), like the render and download executors.
 */

/** The probe waits this long at most; the upload request waits for it. */
export const PROBE_TIMEOUT_MS = 60_000;

/** How long a submit may take before the fleet is treated as unreachable (and the in-process runner takes over). */
const FLEET_REQUEST_TIMEOUT_MS = 10_000;

/** The probe result: the duration of the audio stream in milliseconds. */
export type AudioProbe = { durationMs: number };

/**
 * ffprobe is not available (no binary on the app server, a worker without the probe capability, a fleet that cannot run
 * the job or does not answer in time): a server-side problem, answered with 503, never a verdict on the file.
 */
export class FfprobeUnavailableError extends Error {
  constructor(message = "ffprobe is not available on the app server") {
    super(message);
    this.name = "FfprobeUnavailableError";
  }
}

export type ProbeConfig = {
  url?: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  bucket?: string;
  prefix: string;
  s3: S3Config | null;
};

/** The fleet settings the probe reads (the same variables as the render executor). */
export function probeConfigFromEnv(env: Record<string, string | undefined> = process.env): ProbeConfig {
  return {
    url: env.FFFLEET_URL || undefined,
    token: env.FFFLEET_TOKEN || undefined,
    clientId: env.FFFLEET_CLIENT_ID || undefined,
    clientSecret: env.FFFLEET_CLIENT_SECRET || undefined,
    bucket: env.FFFLEET_S3_BUCKET || undefined,
    prefix: (env.FFFLEET_S3_PREFIX ?? "saarnavideo").replace(/^\/+|\/+$/g, ""),
    s3: s3ConfigFromEnv(env),
  };
}

/** True when audio probing goes through fffleet: RENDER_EXECUTOR=fffleet, or a fleet URL is set. */
export function usesFleetProbe(env: Record<string, string | undefined> = process.env): boolean {
  return env.RENDER_EXECUTOR === "fffleet" || Boolean(env.FFFLEET_URL);
}

export type ProbeOptions = {
  env?: Record<string, string | undefined>;
  /** A fleet to use instead of one built from the environment (tests). It is not closed by the probe. */
  fleet?: Fleet;
  /** Staging client and bucket (with `fleet`, tests). Without both the job reads the local file. */
  s3?: S3Client;
  bucket?: string;
  prefix?: string;
  /** Overall time limit (tests shorten it). */
  timeoutMs?: number;
  log?: (message: string) => void;
};

type FfprobeJson = { streams?: Array<{ codec_type?: string }>; format?: { duration?: string } };

/**
 * Removal steps for staged objects and scratch directories. `close` runs every step again each time (the steps are
 * idempotent), so an upload still running when the probe gave up is removed by the later close; a step registered
 * after close runs at once.
 */
class CleanupScope {
  private steps: Array<() => Promise<unknown>> = [];
  private closed = false;
  add(step: () => Promise<unknown>): void {
    if (this.closed) void step().catch(() => undefined);
    else this.steps.push(step);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const step of [...this.steps].reverse()) await step().catch(() => undefined);
  }
}

/** Result of probing one URI: the audio facts, or `unreadable` when ffprobe/ffmpeg rejected the file itself. */
type Probed = { hasAudio: boolean; durationSeconds?: number } | "unreadable";

/**
 * Probes the local temporary file `localPath` through fffleet and returns its audio duration, or null when the file is not
 * readable audio (no audio stream, or ffprobe/ffmpeg refused it). Throws FfprobeUnavailableError when the probe itself
 * cannot run or does not finish within the time limit.
 */
export async function probeViaFleet(localPath: string, options: ProbeOptions = {}): Promise<AudioProbe | null> {
  const env = options.env ?? process.env;
  const config = probeConfigFromEnv(env);
  const bucket = options.bucket ?? config.bucket;
  const s3 = options.s3 ?? (config.s3 && bucket ? createS3Client(config.s3) : undefined);
  const staged = Boolean(s3 && bucket);
  const prefix = options.prefix ?? config.prefix;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const log = options.log ?? (() => undefined);
  const jobPrefix = `${prefix}/tmp/probe-${randomUUID()}`;

  const ownsFleet = !options.fleet;
  const fleet = options.fleet ?? createFleet({
    // Only a staged probe can use a remote fleet (the fleet cannot read this machine's files).
    url: staged ? config.url : undefined,
    token: config.token,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.clientId ? "jobs" : undefined,
    fallback: "local",
    requestTimeoutMs: FLEET_REQUEST_TIMEOUT_MS,
    local: { s3: staged ? (options.s3 ?? config.s3 ?? undefined) : undefined, kinds: ["batch"], slots: { default: 2 } },
  });

  const scope = new CleanupScope();
  const handles = new Set<JobHandle>();

  /** Runs one job to its end; the probe's own deadline cancels the handles still running. */
  async function run(spec: Omit<JobSpecInput, "kind">): Promise<JobSnapshot> {
    const handle = await fleet.submit({ ...spec, kind: "batch", timeoutMs }).catch(error => {
      throw new FfprobeUnavailableError(`the audio analysis job was not accepted: ${(error as Error).message}`);
    });
    handles.add(handle);
    try {
      return await handle.done;
    } finally {
      handles.delete(handle);
    }
  }

  /** A URI the job can read the local file from: an s3: object in fleet mode, the file itself in-process. */
  async function input(file: string, label: string): Promise<string> {
    if (!staged || !s3 || !bucket) return pathToFileURL(file).href;
    const key = `${jobPrefix}/${label}${path.extname(file)}`;
    // Registered before the upload, so a failed or partial upload is removed as well.
    scope.add(() => s3.deleteObject(bucket, key).catch(error => log(`audio probe: could not delete staged ${key}: ${(error as Error).message}`)));
    await s3.putFile(bucket, key, file);
    return `s3://${bucket}/${key}`;
  }

  /** A URI for a job output (a stream copy); in-process it is a scratch directory next to the upload. Removed when the probe ends. */
  async function output(label: string, extension: string): Promise<string> {
    if (staged && s3 && bucket) {
      const key = `${jobPrefix}/${label}${extension}`;
      scope.add(() => s3.deleteObject(bucket, key).catch(error => log(`audio probe: could not delete staged ${key}: ${(error as Error).message}`)));
      return `s3://${bucket}/${key}`;
    }
    const dir = await mkdtemp(path.join(path.dirname(localPath), "probe-"));
    scope.add(() => rm(dir, { recursive: true, force: true }));
    return pathToFileURL(path.join(dir, `${label}${extension}`)).href;
  }

  /** Classifies a job that did not succeed: the file is at fault (`unreadable`), or the probe is unavailable (throws). */
  function failed(final: JobSnapshot, tool: "ffprobe" | "ffmpeg"): "unreadable" {
    const code = final.error?.code;
    if (code === "FFPROBE_EXIT" || code === "FFMPEG_EXIT" || code === "OUTPUT_MISSING") return "unreadable";
    if (code === "SPAWN_FAILED" && tool === "ffprobe") throw new FfprobeUnavailableError();
    const detail = final.error ? `${final.error.code}: ${final.error.message}` : final.state;
    throw new FfprobeUnavailableError(`the ${tool} job did not finish (${detail})`);
  }

  async function probeUri(uri: string): Promise<Probed> {
    const final = await run({ inputs: [{ name: "in", uri }], outputs: [], ffprobe: { show: ["format", "streams"] }, type: "ffprobe" });
    if (final.state !== "succeeded") return failed(final, "ffprobe");
    const data = final.outputs?.find(o => o.name === "probe")?.data as FfprobeJson | undefined;
    if (!data || typeof data !== "object") throw new FfprobeUnavailableError("ffprobe returned no result");
    const duration = Number(data.format?.duration);
    return { hasAudio: (data.streams ?? []).some(stream => stream.codec_type === "audio"), durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined };
  }

  async function work(): Promise<AudioProbe | null> {
    const source = await input(localPath, "in");
    const first = await probeUri(source);
    if (first === "unreadable" || !first.hasAudio) return null;
    if (first.durationSeconds !== undefined) return { durationMs: Math.round(first.durationSeconds * 1000) };

    // No duration in the header (MediaRecorder WebM): the audio is copied, not decoded, and the copy is measured.
    const copy = await output("copy", ".mka");
    const remux = await run({
      inputs: [{ name: "in", uri: source }],
      outputs: [{ name: "out", uri: copy }],
      ffmpeg: { args: ["-i", "{{input:in}}", "-map", "0:a:0", "-c", "copy", "-f", "matroska", "{{output:out}}"], durationMs: null },
    });
    if (remux.state !== "succeeded") {
      failed(remux, "ffmpeg");
      return null;
    }
    const measured = await probeUri(copy);
    if (measured === "unreadable" || !measured.hasAudio || measured.durationSeconds === undefined) return null;
    return { durationMs: Math.round(measured.durationSeconds * 1000) };
  }

  const limit = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`;
  // The race below rejects at the deadline; the finally block then cancels the jobs still running.
  const timeoutError = new FfprobeUnavailableError(`the audio analysis did not finish within ${limit}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  let finished = false;
  const working = work()
    .catch(error => {
      if (error instanceof FfprobeUnavailableError) throw error;
      throw new FfprobeUnavailableError(`the audio analysis could not run: ${(error as Error).message}`);
    })
    .finally(() => { finished = true; });
  try {
    return await Promise.race([working, deadline]);
  } finally {
    clearTimeout(timer);
    for (const handle of handles) handle.cancel().catch(() => undefined);
    await scope.close();
    // An upload that was still running when the probe gave up is removed once it ends.
    if (!finished) working.finally(() => scope.close()).catch(() => undefined);
    if (ownsFleet) await fleet.close().catch(() => undefined);
  }
}
