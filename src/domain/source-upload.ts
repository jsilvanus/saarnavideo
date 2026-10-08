import { z } from "zod";

export const multipartUploadPartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export const sourceUploadSessionSchema = z.object({
  s3Key: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  multipart: z.object({
    uploadId: z.string().trim().min(1),
    chunkSizeBytes: z.number().int().positive(),
    completed: z.boolean().default(false),
    parts: z.array(multipartUploadPartSchema).default([]),
  }).optional(),
});

export type MultipartUploadPart = z.infer<typeof multipartUploadPartSchema>;
export type SourceUploadSession = z.infer<typeof sourceUploadSessionSchema>;

export function parseSourceUploadSession(value: unknown): SourceUploadSession | null {
  const parsed = sourceUploadSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function upsertMultipartUploadPart(parts: MultipartUploadPart[], next: MultipartUploadPart) {
  return [...parts.filter((part) => part.partNumber !== next.partNumber), next].sort((a, b) => a.partNumber - b.partNumber);
}

export function completedUploadBytes(session: SourceUploadSession) {
  return session.multipart?.parts.reduce((total, part) => total + part.sizeBytes, 0) ?? 0;
}
