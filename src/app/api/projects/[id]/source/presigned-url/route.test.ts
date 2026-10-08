import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createMediaStore, setMediaStore } from "@/lib/media-store";
import { createMemoryObjectClient } from "@/lib/media-store/memory-client";

const s3 = vi.hoisted(() => ({
  abortMultipartUpload: vi.fn(async () => undefined),
  completeMultipartUpload: vi.fn(async () => undefined),
  createMultipartUploadSession: vi.fn(async () => ({ uploadId: "upload-1" })),
  generateMultipartPartUrl: vi.fn(async (_bucket: string, key: string, uploadId: string, partNumber: number) => `https://upload.example/${key}/${uploadId}/${partNumber}`),
  generatePresignedUploadUrl: vi.fn(async (_bucket: string, key: string) => `https://upload.example/${key}`),
}));

vi.mock("@/app/api/_lib/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/_lib/s3")>()),
  ...s3,
}));

import { POST as START, PATCH } from "./route";
import { POST as FINALIZE } from "../[sourceId]/finalize/route";

describe("direct source upload routes", () => {
  let projectId: string;
  let memory: ReturnType<typeof createMemoryObjectClient>;

  beforeEach(async () => {
    process.env.MEDIA_S3_BUCKET = "b";
    process.env.S3_MULTIPART_THRESHOLD_BYTES = "8";
    process.env.S3_MULTIPART_CHUNK_BYTES = "5242880";
    memory = createMemoryObjectClient();
    setMediaStore(createMediaStore({ mode: "s3", root: "/tmp/saarnavideo-upload-route", s3: { client: memory.client, bucket: "b" } }));
    projectId = (await prisma.project.create({ data: { title: "Upload route test", definition: {} } })).id;
    s3.abortMultipartUpload.mockClear();
    s3.completeMultipartUpload.mockClear();
    s3.createMultipartUploadSession.mockClear();
    s3.generateMultipartPartUrl.mockClear();
    s3.generatePresignedUploadUrl.mockClear();
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    setMediaStore(undefined);
    delete process.env.MEDIA_S3_BUCKET;
    delete process.env.S3_MULTIPART_THRESHOLD_BYTES;
    delete process.env.S3_MULTIPART_CHUNK_BYTES;
  });

  const ctx = () => ({ params: Promise.resolve({ id: projectId }) });
  const finalizeCtx = (sourceId: string) => ({ params: Promise.resolve({ id: projectId, sourceId }) });

  it("creates and resumes a persisted multipart upload session on the same source", async () => {
    const start = await START(new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ fileName: "clip.mp4", contentType: "video/mp4", sizeBytes: 20 }),
    }), ctx());
    expect(start.status).toBe(200);
    const first = await start.json();
    expect(first.multipartEnabled).toBe(true);
    expect(first.multipart.uploadId).toBe("upload-1");

    const created = await prisma.source.findUniqueOrThrow({ where: { id: first.sourceId } });
    expect(created.originalName).toBe("clip.mp4");
    expect(created.status).toBe("PENDING");
    expect(created.uploadSession).toMatchObject({
      s3Key: first.s3Key,
      fileName: "clip.mp4",
      sizeBytes: 20,
      multipart: { uploadId: "upload-1", chunkSizeBytes: 5242880, completed: false, parts: [] },
    });

    const partDone = await PATCH(new Request("http://localhost/x", {
      method: "PATCH",
      body: JSON.stringify({ action: "part-complete", sourceId: first.sourceId, uploadId: "upload-1", partNumber: 1, etag: "etag-1", sizeBytes: 5 }),
    }), ctx());
    expect(partDone.status).toBe(200);

    const resumed = await START(new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ sourceId: first.sourceId, fileName: "clip.mp4", contentType: "video/mp4", sizeBytes: 20 }),
    }), ctx());
    expect(resumed.status).toBe(200);
    const second = await resumed.json();
    expect(second.sourceId).toBe(first.sourceId);
    expect(second.completedBytes).toBe(5);
    expect(second.completedParts).toEqual([{ partNumber: 1, etag: "etag-1", sizeBytes: 5 }]);
    expect(s3.createMultipartUploadSession).toHaveBeenCalledTimes(1);
  });

  it("completes a multipart upload and finalizes the source with an s3 storage path", async () => {
    const start = await START(new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ fileName: "clip.mp4", contentType: "video/mp4", sizeBytes: 20 }),
    }), ctx());
    const session = await start.json();

    await PATCH(new Request("http://localhost/x", {
      method: "PATCH",
      body: JSON.stringify({ action: "part-complete", sourceId: session.sourceId, uploadId: "upload-1", partNumber: 1, etag: "etag-1", sizeBytes: 20 }),
    }), ctx());
    const completed = await PATCH(new Request("http://localhost/x", {
      method: "PATCH",
      body: JSON.stringify({ action: "complete", sourceId: session.sourceId, uploadId: "upload-1" }),
    }), ctx());
    expect(completed.status).toBe(200);
    expect(s3.completeMultipartUpload).toHaveBeenCalledWith("b", session.s3Key, "upload-1", [{ ETag: "etag-1", PartNumber: 1 }]);

    const store = createMediaStore({ mode: "s3", root: "/tmp/saarnavideo-upload-route", s3: { client: memory.client, bucket: "b" } });
    await store.put(session.s3Key, Readable.from(Buffer.alloc(20)), { mimeType: "video/mp4" });

    const finalize = await FINALIZE(new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ durationMs: 1234 }),
    }), finalizeCtx(session.sourceId));
    expect(finalize.status).toBe(200);

    const source = await prisma.source.findUniqueOrThrow({ where: { id: session.sourceId } });
    expect(source.status).toBe("AVAILABLE");
    expect(source.storagePath).toBe(`s3://b/${session.s3Key}`);
    expect(source.durationMs).toBe(1234);
    expect(source.referenceDurationMs).toBe(1234);
    expect(source.uploadSession).toBeNull();
  });

  it("reuses an existing pending source instead of creating a duplicate row", async () => {
    const source = await prisma.source.create({
      data: {
        type: "UPLOAD",
        status: "PENDING",
        originalName: "placeholder.mp4",
        projects: { connect: { id: projectId } },
      },
    });

    const res = await START(new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ sourceId: source.id, fileName: "real.mp4", contentType: "video/mp4", sizeBytes: 20 }),
    }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sourceId).toBe(source.id);
    expect(await prisma.source.count({ where: { projects: { some: { id: projectId } } } })).toBe(1);
  });
});
