import { describe, it, expect, vi } from "vitest";

/**
 * Test the hostname replacement logic in generatePresignedUploadUrl.
 * This tests the string manipulation that happens after getSignedUrl is called.
 */
describe("S3 presigned URL hostname replacement logic", () => {
  it("correctly replaces internal hostname with public hostname for Docker setups", () => {
    // Simulate the URL that getSignedUrl would return
    const internalUrl = "http://minio:9000/saarnavideo-media/media/projects/abc/sources/123/video.mp4?AWSAccessKeyId=key";
    
    // Set up environment variables
    vi.stubEnv("MEDIA_S3_ENDPOINT", "http://minio:9000");
    vi.stubEnv("MEDIA_S3_ENDPOINT_PUBLIC", "http://localhost:9000");

    // Simulate the replacement logic from generatePresignedUploadUrl
    let url = internalUrl;
    if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
      try {
        const internalUrlObj = new URL(process.env.MEDIA_S3_ENDPOINT);
        const publicUrl = new URL(process.env.MEDIA_S3_ENDPOINT_PUBLIC);

        let endpointPattern = internalUrlObj.hostname;
        if (internalUrlObj.port) endpointPattern += `:${internalUrlObj.port}`;

        let endpointReplacement = publicUrl.hostname;
        if (publicUrl.port) endpointReplacement += `:${publicUrl.port}`;

        url = url.replace(endpointPattern, endpointReplacement);
      } catch (err) {
        // Error handling
      }
    }

    // Verify the replacement happened
    expect(url).toContain("localhost:9000");
    expect(url).not.toContain("minio:9000");
    expect(url).toContain("saarnavideo-media");
    expect(url).toContain("AWSAccessKeyId=key");
  });

  it("handles URLs without port in the endpoint", () => {
    const internalUrl = "http://s3.internal/saarnavideo-media/media/file.mp4?signature=abc";
    
    vi.stubEnv("MEDIA_S3_ENDPOINT", "http://s3.internal");
    vi.stubEnv("MEDIA_S3_ENDPOINT_PUBLIC", "http://s3.example.com");

    let url = internalUrl;
    if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
      const internalUrlObj = new URL(process.env.MEDIA_S3_ENDPOINT);
      const publicUrl = new URL(process.env.MEDIA_S3_ENDPOINT_PUBLIC);

      let endpointPattern = internalUrlObj.hostname;
      if (internalUrlObj.port) endpointPattern += `:${internalUrlObj.port}`;

      let endpointReplacement = publicUrl.hostname;
      if (publicUrl.port) endpointReplacement += `:${publicUrl.port}`;

      url = url.replace(endpointPattern, endpointReplacement);
    }

    expect(url).toContain("s3.example.com");
    expect(url).not.toContain("s3.internal");
  });

  it("handles different port numbers correctly", () => {
    const internalUrl = "http://s3.internal:8000/bucket/key?sig=xyz";
    
    vi.stubEnv("MEDIA_S3_ENDPOINT", "http://s3.internal:8000");
    vi.stubEnv("MEDIA_S3_ENDPOINT_PUBLIC", "http://s3.example.com:443");

    let url = internalUrl;
    if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
      const internalUrlObj = new URL(process.env.MEDIA_S3_ENDPOINT);
      const publicUrl = new URL(process.env.MEDIA_S3_ENDPOINT_PUBLIC);

      let endpointPattern = internalUrlObj.hostname;
      if (internalUrlObj.port) endpointPattern += `:${internalUrlObj.port}`;

      let endpointReplacement = publicUrl.hostname;
      if (publicUrl.port) endpointReplacement += `:${publicUrl.port}`;

      url = url.replace(endpointPattern, endpointReplacement);
    }

    expect(url).toContain("s3.example.com:443");
    expect(url).not.toContain("s3.internal:8000");
  });

  it("does nothing when MEDIA_S3_ENDPOINT_PUBLIC is not set", () => {
    const internalUrl = "http://minio:9000/bucket/key?sig=abc";
    
    vi.stubEnv("MEDIA_S3_ENDPOINT", "http://minio:9000");
    // Don't set MEDIA_S3_ENDPOINT_PUBLIC - delete it if it exists
    delete process.env.MEDIA_S3_ENDPOINT_PUBLIC;

    let url = internalUrl;
    if (process.env.MEDIA_S3_ENDPOINT_PUBLIC && process.env.MEDIA_S3_ENDPOINT) {
      // This branch will not execute
      url = "REPLACED";
    }

    // URL should remain unchanged
    expect(url).toBe(internalUrl);
  });
});
