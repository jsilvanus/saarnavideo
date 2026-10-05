import { Readable } from "node:stream";
import type { ByteRange, ObjectClient, PutMeta } from "./types";

export type S3Settings = { endpoint?: string; region?: string; forcePathStyle?: boolean; credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } };

/** ObjectClient on the AWS SDK (works with any S3-compatible store). The SDK is imported lazily so local installs never load it. */
export async function createAwsObjectClient(settings: S3Settings = {}): Promise<ObjectClient> {
  const { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { Upload } = await import("@aws-sdk/lib-storage");
  const client = new S3Client({
    region: settings.region ?? "us-east-1",
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    forcePathStyle: settings.forcePathStyle ?? Boolean(settings.endpoint),
    ...(settings.credentials ? { credentials: settings.credentials } : {}),
    // S3-compatible stores (Hetzner, MinIO, ...) often reject the SDK's default trailing-checksum uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async head(bucket, key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as Error).name === "NotFound") return null;
        throw error;
      }
    },
    async get(bucket, key, range?: ByteRange) {
      const result = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end ?? ""}` } : {}),
      }));
      if (!result.Body) throw new Error(`Empty S3 response for s3://${bucket}/${key}`);
      return result.Body as Readable;
    },
    async put(bucket, key, body: Readable | Buffer, meta: PutMeta) {
      await new Upload({ client, params: { Bucket: bucket, Key: key, Body: body, ...(meta.mimeType ? { ContentType: meta.mimeType } : {}) } }).done();
    },
    async delete(bucket, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
