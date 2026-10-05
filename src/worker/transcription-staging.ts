import { randomBytes } from "node:crypto";
import { createS3Client, s3ConfigFromEnv, type S3Config } from "fffleet";
import { presignGetUrl } from "@/worker/s3-presign";

/**
 * AUDITOR_STT_FETCH=s3: instead of uploading the audio to the transcription service, stage it in S3 for the job and
 * hand the service a presigned URL (`source_url`), which it downloads itself. The service must list the bucket's host in
 * AUDITOR_STT_SOURCE_URL_HOSTS. The service has its own copy once the submit call returns, so the staged object is
 * deleted right then. Uses the same bucket and credentials as render staging (FFFLEET_S3_BUCKET, AWS_*, FFFLEET_S3_ENDPOINT).
 */
export type TranscriptionStaging = {
  /** Stages `filePath` and returns a URL the service can fetch; call `release` once the service has accepted (or refused) it. */
  stage(filePath: string, jobId: string): Promise<{ url: string; release: () => Promise<void> }>;
};

const URL_LIFETIME_SECONDS = 3600;

export function createTranscriptionStaging(env: Record<string, string | undefined> = process.env, deps: { s3?: Pick<ReturnType<typeof createS3Client>, "putFile" | "deleteObject">; config?: S3Config } = {}): TranscriptionStaging | null {
  if ((env.AUDITOR_STT_FETCH ?? "upload") !== "s3") return null;
  const config = deps.config ?? s3ConfigFromEnv(env);
  const bucket = env.FFFLEET_S3_BUCKET;
  if (!config || !bucket) throw new Error("AUDITOR_STT_FETCH=s3 needs FFFLEET_S3_BUCKET and S3 credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, optionally FFFLEET_S3_ENDPOINT)");
  const prefix = (env.FFFLEET_S3_PREFIX ?? "saarnavideo").replace(/^\/+|\/+$/g, "");
  const s3 = deps.s3 ?? createS3Client(config);
  return {
    async stage(filePath, jobId) {
      const extension = filePath.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
      const key = `${prefix}/tmp/${jobId}/transcribe-${randomBytes(3).toString("hex")}${extension}`;
      await s3.putFile(bucket, key, filePath);
      return { url: presignGetUrl(config, bucket, key, { expiresSeconds: URL_LIFETIME_SECONDS }), release: () => s3.deleteObject(bucket, key).catch(() => undefined) };
    },
  };
}
