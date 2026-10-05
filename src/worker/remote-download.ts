import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createFleet, createS3Client, type Fleet, type JobHandle, type S3Client } from "fffleet";
import downloadExecutor from "../../fleet/download-executor.mjs";
import { readRemoteConfig } from "@/worker/remote-ffmpeg";

/**
 * Runs the yt-dlp download of a DOWNLOAD job on an fffleet worker (DOWNLOAD_EXECUTOR=fffleet).
 *
 * The job type `download` is implemented by `fleet/download-executor.mjs`, which the fleet worker loads
 * (FFFLEET_EXECUTORS, see Dockerfile.fleet-worker). The video comes back through S3 and is copied to the local
 * output path, so the rest of the worker does not change. Without a reachable fleet the same executor runs in-process.
 *
 * Cookies: the worker passes a cookie file (a private temp copy of the cookies stored in Settings, else YTDLP_COOKIES_FILE; see
 * `withDownloadCookies`); a copy is staged in S3 for the job only. If the executor
 * returns an updated cookie file (yt-dlp rewrites it), it replaces the local file. Everything staged is deleted afterwards.
 */

export type RemoteDownloadRun = {
  jobId: string;
  url: string;
  outputPath: string;
  /** Local cookie file (see withDownloadCookies); staged for this job and updated in place if the executor returns a new one. */
  cookiesFile?: string;
  onProgress?: (percent: number) => void;
  labels?: Record<string, string>;
};

export type RemoteDownloader = {
  run(job: RemoteDownloadRun): Promise<{ cookiesUpdated: boolean }>;
  cancel(jobId: string): Promise<void>;
  close(): Promise<void>;
};

export function createRemoteDownloader({ fleet, s3, bucket, prefix, log = () => {} }: { fleet: Fleet; s3: S3Client; bucket: string; prefix: string; log?: (msg: string) => void }): RemoteDownloader {
  const handles = new Map<string, JobHandle>();
  return {
    async run(job) {
      const tag = randomBytes(3).toString("hex");
      const base = `${prefix}/tmp/${job.jobId}`;
      const keys = { cookies: `${base}/cookies.txt`, cookiesOut: `${base}/cookies-out.txt`, video: `${base}/video-${tag}.mp4` };
      const uri = (key: string) => `s3://${bucket}/${key}`;
      const staged: string[] = [];
      try {
        if (job.cookiesFile) {
          await s3.putFile(bucket, keys.cookies, job.cookiesFile);
          staged.push(keys.cookies);
          log("remote download: staged cookie file for this job");
        }
        const spec = {
          id: `${job.jobId}-${tag}`,
          kind: "batch" as const,
          type: "download",
          labels: { app: "saarnavideo", jobType: "DOWNLOAD", ...job.labels },
          inputs: job.cookiesFile ? [{ name: "cookies", uri: uri(keys.cookies) }] : [],
          outputs: [{ name: "video", uri: uri(keys.video) }, ...(job.cookiesFile ? [{ name: "cookies-out", uri: uri(keys.cookiesOut) }] : [])],
          download: { url: job.url },
        };
        staged.push(keys.video, keys.cookiesOut);
        const handle = await fleet.submit(spec);
        handles.set(job.jobId, handle);
        handle.on("progress", p => { if (p.pct !== null && p.pct !== undefined) job.onProgress?.(p.pct); });
        const final = await handle.done;
        if (final.state !== "succeeded") throw new Error(`Download failed on the fleet (${final.state}${final.error ? `, ${final.error.code}: ${final.error.message}` : ""})${final.stderrTail ? `: ${final.stderrTail.slice(-2000)}` : ""}`);

        await mkdir(path.dirname(job.outputPath), { recursive: true });
        await s3.getFile(bucket, keys.video, job.outputPath);

        let cookiesUpdated = false;
        if (job.cookiesFile && final.outputs?.some(o => o.name === "cookies-out")) {
          const tmp = `${job.cookiesFile}.${tag}.tmp`;
          await s3.getFile(bucket, keys.cookiesOut, tmp);
          const mode = await stat(job.cookiesFile).then(s => s.mode & 0o777, () => 0o600);
          await chmod(tmp, mode);
          await rename(tmp, job.cookiesFile);
          cookiesUpdated = true;
          log("remote download: cookie file updated by yt-dlp, written back");
        }
        return { cookiesUpdated };
      } finally {
        handles.delete(job.jobId);
        await Promise.all(staged.map(key => s3.deleteObject(bucket, key).catch(() => undefined)));
        if (job.cookiesFile) await rm(`${job.cookiesFile}.${tag}.tmp`, { force: true });
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

/** The downloader for the environment's settings (null = run yt-dlp locally, DOWNLOAD_EXECUTOR unset or "local"). */
export function createRemoteDownloaderFromEnv(env: Record<string, string | undefined> = process.env, log?: (msg: string) => void): RemoteDownloader | null {
  const config = readRemoteConfig(env, "DOWNLOAD_EXECUTOR");
  if (!config) return null;
  const fleet = createFleet({
    url: config.url,
    token: config.token,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: config.clientId ? "jobs" : undefined,
    // With no reachable fleet the download still runs on this machine, through the same executor and S3 staging.
    fallback: "local",
    local: { s3: config.s3, slots: { default: Number(env.MAX_CONCURRENT_JOBS ?? 2) }, kinds: ["batch"], executors: { download: downloadExecutor.run as never } },
  });
  return createRemoteDownloader({ fleet, s3: createS3Client(config.s3), bucket: config.bucket, prefix: config.prefix, log });
}
