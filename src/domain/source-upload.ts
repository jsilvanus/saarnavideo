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
  updatedAt: z.string().datetime().optional(),
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

export function touchSourceUploadSession(session: SourceUploadSession, now = new Date()) {
  return { ...session, updatedAt: now.toISOString() } satisfies SourceUploadSession;
}

export function sourceUploadUpdatedAt(session: SourceUploadSession, fallback = new Date(0)) {
  if (!session.updatedAt) return fallback;
  const parsed = new Date(session.updatedAt);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function sourceUploadIsStale(session: SourceUploadSession, staleAfterMs: number, now = new Date(), fallback = new Date(0)) {
  return now.getTime() - sourceUploadUpdatedAt(session, fallback).getTime() >= staleAfterMs;
}

export function expectedMultipartPartSize(session: SourceUploadSession, partNumber: number) {
  const multipart = session.multipart;
  if (!multipart || partNumber <= 0) return null;
  const start = (partNumber - 1) * multipart.chunkSizeBytes;
  if (start >= session.sizeBytes) return null;
  return Math.min(multipart.chunkSizeBytes, session.sizeBytes - start);
}
