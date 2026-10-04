import { createHash, randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createFleet, createS3Client, s3ConfigFromEnv, type Fleet, type JobHandle, type S3Client } from "fffleet";

/**
 * Runs the worker's ffmpeg commands on an fffleet fleet (RENDER_EXECUTOR=fffleet) instead of a local process.
 *
 * The render plans keep using local paths. This module stages every file a plan reads in S3, rewrites the
 * paths into fffleet placeholders, submits one batch job, and copies the output back to the local path the
 * plan wrote to, so the rest of the worker (Output rows, downloads, publishing) does not change.
 */

export type RemoteConfig = {
  url?: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  bucket: string;
  prefix: string;
  s3: NonNullable<ReturnType<typeof s3ConfigFromEnv>>;
};

/** Settings from the environment, or null when RENDER_EXECUTOR is not "fffleet". Throws when it is but the settings are incomplete. */
export function readRemoteConfig(env: Record<string, string | undefined> = process.env): RemoteConfig | null {
  if ((env.RENDER_EXECUTOR ?? "local") !== "fffleet") return null;
  const s3 = s3ConfigFromEnv(env);
  const bucket = env.FFFLEET_S3_BUCKET;
  if (!s3 || !bucket) throw new Error("RENDER_EXECUTOR=fffleet needs FFFLEET_S3_BUCKET and S3 credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, optionally FFFLEET_S3_ENDPOINT)");
  return {
    url: env.FFFLEET_URL || undefined,
    token: env.FFFLEET_TOKEN || undefined,
    clientId: env.FFFLEET_CLIENT_ID || undefined,
    clientSecret: env.FFFLEET_CLIENT_SECRET || undefined,
    bucket,
    prefix: (env.FFFLEET_S3_PREFIX ?? "saarnavideo").replace(/^\/+|\/+$/g, ""),
    s3,
  };
}

export type TranslateInput = {
  args: string[];
  /** Local files the plan reads (anything not mentioned in `args` is ignored). */
  files: string[];
  /** A font file and the directory the plan passes to libass (`fontsdir`); the directory becomes `{{inputdir:font}}`. */
  fonts?: { file: string; dir: string };
  /** The local file the plan writes, if any. */
  outputPath?: string;
  /** Anything under this directory left in the arguments after translation is a bug and fails the job. */
  mediaRoot: string;
};

export type Translated = { args: string[]; inputs: { name: string; path: string }[]; output: boolean };

/** Rewrites local paths in ffmpeg arguments (also inside filter graphs) into `{{input:..}}`, `{{inputdir:font}}` and `{{output:out}}`. */
export function translateFfmpegArgs({ args, files, fonts, outputPath, mediaRoot }: TranslateInput): Translated {
  let out = [...args];
  const inputs: { name: string; path: string }[] = [];
  const used = (p: string) => out.some(a => a.includes(p));
  for (const file of new Set(files)) if (used(file)) inputs.push({ name: `in${inputs.length}`, path: file });
  // Longest first, so a file is never half-replaced by a shorter path that prefixes it.
  for (const input of [...inputs].sort((a, b) => b.path.length - a.path.length)) out = out.map(a => a.split(input.path).join(`{{input:${input.name}}}`));
  if (fonts) {
    inputs.push({ name: "font", path: fonts.file });
    out = out.map(a => a.split(fonts.dir).join("{{inputdir:font}}"));
  }
  let output = false;
  if (outputPath) {
    if (used(outputPath)) output = true;
    out = out.map(a => a.split(outputPath).join("{{output:out}}"));
  }
  const leftover = out.find(a => a.includes(mediaRoot));
  if (leftover) throw new Error(`The render plan refers to a local file that was not staged for the fleet: ${leftover.slice(0, 300)}`);
  // The fleet adds -hide_banner and -y itself.
  const cleaned = out.filter((a, i) => !(i < 2 && (a === "-hide_banner" || a === "-y")));
  // loudnorm prints its measurement at info level, and the fleet's default is "warning".
  if (cleaned.some(a => a.includes("print_format=json"))) cleaned.unshift("-loglevel", "info");
  return { args: cleaned, inputs, output };
}

/** Capabilities a worker needs for these arguments. */
export function deriveRequires(args: string[]): string[] {
  const text = args.join(" ");
  const requires = new Set<string>();
  if (/(^|[\s;,\[\]])ass=/.test(text)) requires.add("filter:ass");
  if (/drawtext=/.test(text)) requires.add("filter:drawtext");
  if (/loudnorm=/.test(text)) requires.add("filter:loudnorm");
  if (/libmp3lame/.test(text)) requires.add("encoder:libmp3lame");
  if (/libx264/.test(text)) requires.add("encoder:libx264");
  return [...requires].sort();
}

const EPHEMERAL = new Set([".ass", ".srt", ".vtt"]);

export type RemoteRun = {
  jobId: string;
  args: string[];
  totalMs: number;
  files: string[];
  fonts?: { file: string; dir: string };
  outputPath?: string;
  mediaRoot: string;
  priority?: number;
  labels?: Record<string, string>;
  onProgress?: (p: { currentMs: number; speed?: string }) => void;
};

export type RemoteExecutor = {
  run(job: RemoteRun): Promise<{ stderr: string }>;
  /** Cancels the fleet job of a worker job, if one is running. */
  cancel(jobId: string): Promise<void>;
  close(): Promise<void>;
};

export function createRemoteExecutor({ fleet, s3, bucket, prefix, log = () => {} }: { fleet: Fleet; s3: S3Client; bucket: string; prefix: string; log?: (msg: string) => void }): RemoteExecutor {
  const handles = new Map<string, JobHandle>();
  const uploads = new Map<string, Promise<string>>();

  /** Uploads a file once (keyed by path, size and modification time) and returns its s3:// URI. */
  function stage(file: string, jobId: string): Promise<string> {
    const ephemeral = EPHEMERAL.has(path.extname(file).toLowerCase());
    return (async () => {
      const info = await stat(file);
      const key = ephemeral
        ? `${prefix}/tmp/${jobId}/${path.basename(file)}`
        : `${prefix}/in/${createHash("sha1").update(`${file}|${info.size}|${Math.round(info.mtimeMs)}`).digest("hex").slice(0, 20)}/${path.basename(file)}`;
      const uri = `s3://${bucket}/${key}`;
      if (!ephemeral) {
        const present = await s3.head(bucket, key).then(h => h.size === info.size, () => false);
        if (present) return uri;
      }
      log(`remote render: uploading ${path.basename(file)} (${info.size} bytes)`);
      await s3.putFile(bucket, key, file);
      return uri;
    })();
  }
  const stageOnce = (file: string, jobId: string) => {
    const id = `${file}|${jobId}`;
    let p = uploads.get(id);
    if (!p) {
      p = stage(file, jobId);
      uploads.set(id, p);
      p.finally(() => setTimeout(() => uploads.delete(id), 60_000).unref()).catch(() => {});
    }
    return p;
  };

  return {
    async run(job) {
      const t = translateFfmpegArgs(job);
      const uris = new Map<string, string>();
      for (const input of t.inputs) uris.set(input.name, await stageOnce(input.path, job.jobId));
      const outKey = `${prefix}/out/${job.jobId}-${randomBytes(3).toString("hex")}/${path.basename(job.outputPath ?? "out")}`;
      const spec = {
        id: `${job.jobId}-${randomBytes(3).toString("hex")}`,
        kind: "batch" as const,
        priority: job.priority ?? 0,
        requires: deriveRequires(t.args),
        labels: { app: "saarnavideo", ...job.labels },
        inputs: t.inputs.map(i => ({ name: i.name, uri: uris.get(i.name)! })),
        outputs: t.output ? [{ name: "out", uri: `s3://${bucket}/${outKey}` }] : [],
        ffmpeg: { args: t.args, durationMs: job.totalMs },
      };
      const handle = await fleet.submit(spec);
      handles.set(job.jobId, handle);
      handle.on("progress", p => { if (p.outTimeMs !== null) job.onProgress?.({ currentMs: p.outTimeMs, speed: p.speed ? `${p.speed}x` : undefined }); });
      try {
        const final = await handle.done;
        if (final.state !== "succeeded") {
          const tail = final.stderrTail ? `: ${final.stderrTail.slice(-2000)}` : "";
          throw new Error(`FFmpeg failed on the fleet (${final.state}${final.error ? `, ${final.error.code}: ${final.error.message}` : ""})${tail}`);
        }
        if (t.output && job.outputPath) {
          await mkdir(path.dirname(job.outputPath), { recursive: true });
          await s3.getFile(bucket, outKey, job.outputPath);
        }
        return { stderr: final.stderrTail ?? "" };
      } finally {
        handles.delete(job.jobId);
        const cleanup = [...(t.output ? [outKey] : []), ...t.inputs.filter(i => EPHEMERAL.has(path.extname(i.path).toLowerCase())).map(i => uris.get(i.name)!.replace(`s3://${bucket}/`, ""))];
        await Promise.all(cleanup.map(key => s3.deleteObject(bucket, key).catch(() => undefined)));
      }
    },
    async cancel(jobId) {
      await handles.get(jobId)?.cancel().catch(() => undefined);
    },
    async close() {
      await Promise.all([...handles.values()].map(h => h.cancel().catch(() => undefined)));
      await fleet.close();
    },
  };
}

/** The executor for the environment's settings (null = run ffmpeg locally). */
export function createRemoteExecutorFromEnv(env: Record<string, string | undefined> = process.env, log?: (msg: string) => void): RemoteExecutor | null {
  const config = readRemoteConfig(env);
  if (!config) return null;
  const fleet = createFleet({
    url: config.url,
    token: config.token,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.clientId ? "jobs" : undefined,
    // With no reachable fleet the job still runs on this machine, through the same S3 staging.
    fallback: "local",
    local: { s3: config.s3, slots: { default: Number(env.MAX_CONCURRENT_JOBS ?? 2) }, kinds: ["batch"], ffmpegPath: env.FFMPEG_PATH || "ffmpeg", cache: env.FFFLEET_CACHE_DIR ? { dir: env.FFFLEET_CACHE_DIR, maxBytes: env.FFFLEET_CACHE_MAX_SIZE } : null },
  });
  return createRemoteExecutor({ fleet, s3: createS3Client(config.s3), bucket: config.bucket, prefix: config.prefix, log });
}
