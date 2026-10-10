import { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize S3 client from environment
export function getS3Client(endpointOverride?: string) {
  const bucket = process.env.MEDIA_S3_BUCKET;
  const endpoint = endpointOverride ?? process.env.MEDIA_S3_ENDPOINT;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket) {
    throw new Error("MEDIA_S3_BUCKET not configured");
  }
  if (!endpoint) {
    throw new Error("MEDIA_S3_ENDPOINT not configured");
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not configured");
  }

  // Parse the endpoint URL to ensure it's valid
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch (err) {
    throw new Error(`Invalid MEDIA_S3_ENDPOINT URL: ${endpoint}`);
  }

  console.log(`[S3Client] Initializing with endpoint=${endpointUrl.toString()}, bucket=${bucket}, forcePathStyle=true`);

  return new S3Client({
    region: "us-east-1",
    endpoint: endpointUrl.toString(),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // Force path-style URLs for S3-compatible services (required for non-AWS S3)
    // This tells the SDK to use /bucket/key instead of bucket.s3.endpoint/key
    forcePathStyle: true,
    // Newer SDKs add a CRC32 checksum to presigned URLs, computed over an empty body. The browser's
    // real bytes then mismatch and S3 returns 403. Only add checksums when a request requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Generate a presigned PUT URL for direct S3 upload.
 * The client can upload directly to S3 without going through the Node.js server.
 * 
 * The URL is signed for the browser-reachable endpoint (MEDIA_S3_ENDPOINT_PUBLIC), not the internal
 * Docker one. SigV4 covers the Host header, so rewriting the host after signing makes S3 reject the
 * request with 403 and the browser sees a connection reset.
 */
export async function generatePresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getPublicS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

/** Client used only for presigning (no network calls), bound to the endpoint the browser uses. */
function getPublicS3Client() {
  return getS3Client(process.env.MEDIA_S3_ENDPOINT_PUBLIC || undefined);
}

export async function createMultipartUploadSession(
  bucket: string,
  key: string,
  contentType: string,
) {
  const client = getS3Client();
  const multipart = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  }));

  const uploadId = multipart.UploadId;
  if (!uploadId) throw new Error("S3 multipart upload did not return an UploadId");
  return { uploadId };
}

export async function generateMultipartPartUrl(
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number = 3600,
): Promise<string> {
  const client = getPublicS3Client();
  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function completeMultipartUpload(
  bucket: string,
  key: string,
  uploadId: string,
  parts: Array<{ ETag: string; PartNumber: number }>,
) {
  const client = getS3Client();
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  }));
}

export async function abortMultipartUpload(bucket: string, key: string, uploadId: string) {
  const client = getS3Client();
  await client.send(new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
  }));
}

/**
 * Generate S3 key path for a source file within a project.
 */
export function generateS3SourceKey(projectId: string, sourceId: string, fileName: string): string {
  const prefix = process.env.MEDIA_S3_PREFIX || "media";
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/projects/${projectId}/sources/${sourceId}/${sanitizedFileName}`;
}
