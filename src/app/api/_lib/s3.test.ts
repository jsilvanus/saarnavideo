import { describe, it, expect, vi, afterEach } from "vitest";
import { generatePresignedUploadUrl, generateMultipartPartUrl } from "./s3";

/**
 * Presigned URLs must be signed for the host the browser uses (MEDIA_S3_ENDPOINT_PUBLIC).
 * Rewriting the host after signing makes SigV4 fail with 403.
 */
describe("presigned S3 URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubS3Env(publicEndpoint?: string) {
    vi.stubEnv("MEDIA_S3_BUCKET", "saarnavideo-media");
    vi.stubEnv("MEDIA_S3_ENDPOINT", "http://s3:9000");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("MEDIA_S3_ENDPOINT_PUBLIC", publicEndpoint ?? "");
  }

  it("signs single PUT URLs for the public endpoint", async () => {
    stubS3Env("http://localhost:9000");
    const url = new URL(await generatePresignedUploadUrl("saarnavideo-media", "media/a.mp4", "video/mp4"));
    expect(url.host).toBe("localhost:9000");
    expect(url.pathname).toBe("/saarnavideo-media/media/a.mp4");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("signs multipart part URLs for the public endpoint", async () => {
    stubS3Env("http://localhost:9000");
    const url = new URL(await generateMultipartPartUrl("saarnavideo-media", "media/a.mp4", "upload-1", 2));
    expect(url.host).toBe("localhost:9000");
    expect(url.searchParams.get("partNumber")).toBe("2");
    expect(url.searchParams.get("uploadId")).toBe("upload-1");
  });

  it("falls back to the internal endpoint when no public endpoint is set", async () => {
    stubS3Env(undefined);
    const url = new URL(await generatePresignedUploadUrl("saarnavideo-media", "media/a.mp4", "video/mp4"));
    expect(url.host).toBe("s3:9000");
  });
});
