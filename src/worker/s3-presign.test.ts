import { describe, expect, it } from "vitest";
import { presignGetUrl } from "@/worker/s3-presign";

const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };

describe("presignGetUrl", () => {
  it("matches the example in the AWS documentation (virtual-hosted style)", () => {
    const url = presignGetUrl({ ...creds, region: "us-east-1", endpoint: "https://s3.amazonaws.com", pathStyle: false }, "examplebucket", "test.txt", { expiresSeconds: 86400, now: new Date("2013-05-24T00:00:00Z") });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("uses path style with a custom endpoint and signs a session token", () => {
    const url = new URL(presignGetUrl({ ...creds, region: "eu-north-1", endpoint: "http://minio.local:9000", sessionToken: "tok/en" }, "media", "saarnavideo/tmp/job 1/a.wav", { now: new Date("2026-10-05T12:00:00Z") }));
    expect(url.origin).toBe("http://minio.local:9000");
    expect(url.pathname).toBe("/media/saarnavideo/tmp/job%201/a.wav");
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("tok/en");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20261005/eu-north-1/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
