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
  // The AWS SDK generates URLs in virtual-hosted-style: http://BUCKET.ENDPOINT:PORT/KEY
  // We need to convert these to use the public endpoint so the browser can access them.
  // Example: http://saarnavideo-media.s3:9000/... → http://localhost:9000/...
  if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
    try {
      const internalUrl = new URL(process.env.MEDIA_S3_ENDPOINT);
      const publicUrl = new URL(process.env.MEDIA_S3_ENDPOINT_PUBLIC);
      
      // For virtual-hosted-style URLs, the hostname is "bucket.endpoint"
      // We need to find and replace the endpoint part with the public endpoint
      // Build the hostname pattern to search for: "endpoint:port"
      let endpointPattern = internalUrl.hostname;
      if (internalUrl.port) {
        endpointPattern += `:${internalUrl.port}`;
      }
      
      // Build the replacement: "publicEndpoint:port"
      let endpointReplacement = publicUrl.hostname;
      if (publicUrl.port) {
        endpointReplacement += `:${publicUrl.port}`;
      }
      
      // Replace the endpoint pattern with the public endpoint
      // This handles virtual-hosted URLs like: bucket.endpoint:port → bucket.publicEndpoint:port
      url = url.replace(endpointPattern, endpointReplacement);
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
