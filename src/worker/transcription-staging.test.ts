import { describe, expect, it, vi } from "vitest";
import { createTranscriptionStaging } from "@/worker/transcription-staging";

const config = { accessKeyId: "AK", secretAccessKey: "SK", region: "us-east-1", endpoint: "http://minio.local:9000" };

describe("createTranscriptionStaging", () => {
  it("is off unless AUDITOR_STT_FETCH=s3", () => {
    expect(createTranscriptionStaging({})).toBeNull();
    expect(createTranscriptionStaging({ AUDITOR_STT_FETCH: "upload" })).toBeNull();
  });

  it("refuses to start without a bucket or credentials", () => {
    expect(() => createTranscriptionStaging({ AUDITOR_STT_FETCH: "s3" })).toThrow(/FFFLEET_S3_BUCKET/);
    expect(() => createTranscriptionStaging({ AUDITOR_STT_FETCH: "s3", FFFLEET_S3_BUCKET: "media" })).toThrow(/credentials/);
  });

  it("stages the file under the job's tmp prefix, returns a presigned URL and deletes the object on release", async () => {
    const s3 = { putFile: vi.fn(async () => 123), deleteObject: vi.fn(async () => undefined) };
    const staging = createTranscriptionStaging({ AUDITOR_STT_FETCH: "s3", FFFLEET_S3_BUCKET: "media", FFFLEET_S3_PREFIX: "/app/" }, { s3, config })!;
    const { url, release } = await staging.stage("/data/tmp/job-7.wav", "job-7");

    const [bucket, key, file] = s3.putFile.mock.calls[0] as unknown as [string, string, string];
    expect([bucket, file]).toEqual(["media", "/data/tmp/job-7.wav"]);
    expect(key).toMatch(/^app\/tmp\/job-7\/transcribe-[0-9a-f]{6}\.wav$/);
    const parsed = new URL(url);
    expect(parsed.origin).toBe("http://minio.local:9000");
    expect(parsed.pathname).toBe(`/media/${key}`);
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();

    expect(s3.deleteObject).not.toHaveBeenCalled();
    await release();
    expect(s3.deleteObject).toHaveBeenCalledWith("media", key);
  });

  it("s3-source stages the original, reports its key and deletes by key", async () => {
    const s3 = { putFile: vi.fn(async () => 123), deleteObject: vi.fn(async () => undefined) };
    const staging = createTranscriptionStaging({ AUDITOR_STT_FETCH: "s3-source", FFFLEET_S3_BUCKET: "media" }, { s3, config })!;
    expect(staging.mode).toBe("source");
    const { key } = await staging.stage("/data/sources/p/talk.mp4", "job-9");
    expect(key).toMatch(/^saarnavideo\/tmp\/job-9\/transcribe-[0-9a-f]{6}\.mp4$/);
    expect(s3.deleteObject).not.toHaveBeenCalled();
    await staging.delete(key); // a restarted worker releases a key it read from the job's parameters
    expect(s3.deleteObject).toHaveBeenCalledWith("media", key);
  });

  it("plain s3 mode stays in audio mode", () => {
    const s3 = { putFile: vi.fn(), deleteObject: vi.fn() };
    expect(createTranscriptionStaging({ AUDITOR_STT_FETCH: "s3", FFFLEET_S3_BUCKET: "media" }, { s3: s3 as never, config })!.mode).toBe("audio");
  });
});
