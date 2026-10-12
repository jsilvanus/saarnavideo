import { prisma } from "@/lib/prisma";
import { getMediaStore, s3Ref } from "@/lib/media-store";
import { abortMultipartUpload } from "@/app/api/_lib/s3";
import { parseSourceUploadSession, sourceUploadIsStale } from "@/domain/source-upload";

export function uploadStaleAfterMs() {
  return Math.max(60_000, Number(process.env.UPLOAD_STALE_AFTER_MS ?? 24 * 60 * 60 * 1000));
}

/**
 * Aborts and removes direct uploads that were never finished (PENDING sources older than `UPLOAD_STALE_AFTER_MS`).
 * Safe to run from several processes at once: every step is a delete that tolerates "already gone".
 */
export async function cleanupStalePendingUploads(now = new Date()) {
  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) return;
  const staleAfterMs = uploadStaleAfterMs();
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const pending = await prisma.source.findMany({
    where: { type: "UPLOAD", status: "PENDING", createdAt: { lte: cutoff } },
    select: { id: true, createdAt: true, uploadSession: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const source of pending) {
    const uploadSession = parseSourceUploadSession(source.uploadSession);
    if (!uploadSession || !sourceUploadIsStale(uploadSession, staleAfterMs, now, source.createdAt)) continue;
    if (uploadSession.multipart?.uploadId) {
      await abortMultipartUpload(bucket, uploadSession.s3Key, uploadSession.multipart.uploadId).catch(() => undefined);
    }
    await (await getMediaStore()).remove(s3Ref(bucket, uploadSession.s3Key)).catch(() => undefined);
    await prisma.source.delete({ where: { id: source.id } }).catch(() => undefined);
  }
}
