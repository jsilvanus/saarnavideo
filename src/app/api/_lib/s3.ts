import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize S3 client from environment
export function getS3Client() {
  if (!process.env.MEDIA_S3_BUCKET) {
    throw new Error("MEDIA_S3_BUCKET not configured");
  }
  return new S3Client({
    region: "us-east-1", // Auto-configured for S3-compatible endpoints
    endpoint: process.env.MEDIA_S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

/**
 * Generate a presigned PUT URL for direct S3 upload.
 * The client can upload directly to S3 without going through the Node.js server.
 * 
 * For the frontend/browser, we need to use a publicly-accessible S3 URL (e.g., localhost:9000),
 * not the internal Docker container URL.
 */
export async function generatePresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  let url = await getSignedUrl(client, command, { expiresIn });
  
  // Replace internal Docker S3 URL with public S3 URL for frontend access
  // Internal: http://s3:9000 or http://BUCKET.s3:9000 (inside Docker network)
  // Public: http://localhost:9000 (accessible from browser on host)
  if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
    // Replace the hostname part, handling both:
    // - http://s3:9000 (path-style)
    // - http://bucket.s3:9000 (virtual-hosted-style)
    const internalEndpoint = process.env.MEDIA_S3_ENDPOINT;
    try {
      const internalUrl = new URL(internalEndpoint);
      const publicUrl = new URL(process.env.MEDIA_S3_ENDPOINT_PUBLIC);
      // Replace hostname (e.g., "s3", "bucket.s3" → "localhost")
      url = url.replace(internalUrl.hostname, publicUrl.hostname);
      // Also update port if it changed
      if (internalUrl.port !== publicUrl.port) {
        url = url.replace(`:${internalUrl.port}`, `:${publicUrl.port}`);
      }
    } catch (err) {
      // If URL parsing fails, log and continue with original URL
      console.error("Failed to replace S3 endpoint:", err);
    }
  }
  
  return url;
}

/**
 * Generate S3 key path for a source file within a project.
 */
export function generateS3SourceKey(projectId: string, sourceId: string, fileName: string): string {
  const prefix = process.env.MEDIA_S3_PREFIX || "media";
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/projects/${projectId}/sources/${sourceId}/${sanitizedFileName}`;
}
