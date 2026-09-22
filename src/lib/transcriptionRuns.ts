import { prisma } from "@/lib/prisma";

/**
 * The subset of the Prisma client this module needs - satisfied by both the
 * top-level `prisma` singleton and the interactive-transaction client Prisma
 * hands to a `prisma.$transaction(async (tx) => ...)` callback, so callers
 * can pass either.
 */
type TxClient = Pick<typeof prisma, "transcriptSegment" | "transcriptionRun">;

export type ApplyStrategy = "replace_overlap" | "append";

export type ApplyOutcome = { ok: true } | { ok: false; conflicts: string[] };

type OverlapSegment = { id: string; startSeconds: number; endSeconds: number };

function segmentsOverlap(a: OverlapSegment, b: OverlapSegment): boolean {
  return a.startSeconds < b.endSeconds && b.startSeconds < a.endSeconds;
}

/**
 * Applies a PENDING run's segments to the active track per
 * docs/transcription-editor-contract.md's "Apply strategies":
 *  - replace_overlap: deactivate every active segment whose range overlaps
 *    the run's own [rangeStartSeconds, rangeEndSeconds), then activate the
 *    run's segments. Always succeeds.
 *  - append: activate the run's segments only, refusing (without changing
 *    anything) if any of them individually overlaps an already-active
 *    segment.
 * Does not open its own transaction - callers that need atomicity wrap this
 * in `prisma.$transaction(async (tx) => applyRunWithStrategy(tx, ...))`.
 */
export async function applyRunWithStrategy(
  tx: TxClient,
  run: { id: string; sourceId: string; rangeStartSeconds: number; rangeEndSeconds: number },
  strategy: ApplyStrategy,
): Promise<ApplyOutcome> {
  if (strategy === "append") {
    const [runSegments, activeSegments] = await Promise.all([
      tx.transcriptSegment.findMany({ where: { runId: run.id }, select: { id: true, startSeconds: true, endSeconds: true } }),
      tx.transcriptSegment.findMany({ where: { sourceId: run.sourceId, isActive: true }, select: { id: true, startSeconds: true, endSeconds: true } }),
    ]);
    const conflicts = new Set<string>();
    for (const runSegment of runSegments) {
      for (const activeSegment of activeSegments) {
        if (segmentsOverlap(runSegment, activeSegment)) conflicts.add(activeSegment.id);
      }
    }
    if (conflicts.size > 0) return { ok: false, conflicts: [...conflicts] };
    await tx.transcriptSegment.updateMany({ where: { runId: run.id }, data: { isActive: true } });
  } else {
    await tx.transcriptSegment.updateMany({
      where: { sourceId: run.sourceId, isActive: true, startSeconds: { lt: run.rangeEndSeconds }, endSeconds: { gt: run.rangeStartSeconds } },
      data: { isActive: false },
    });
    await tx.transcriptSegment.updateMany({ where: { runId: run.id }, data: { isActive: true } });
  }
  await tx.transcriptionRun.update({ where: { id: run.id }, data: { status: "APPLIED", appliedAt: new Date(), appliedStrategy: strategy } });
  return { ok: true };
}

export type NewRunSegment = { startSeconds: number; endSeconds: number; text: string; confidence?: number };

/**
 * Creates a TranscriptionRun (with its segments, all initially inactive) and
 * auto-applies it - trivially, as replace_overlap against nothing - only if
 * the source currently has zero active segments. Otherwise the run is left
 * PENDING for an explicit user Apply/Discard, per the contract's "Auto-apply
 * rule". Used both by the worker (origin: SERVICE) and the .vtt upload route
 * (origin: UPLOAD).
 */
export async function createTranscriptionRun(params: {
  sourceId: string;
  jobId?: string;
  origin: "SERVICE" | "UPLOAD" | "MANUAL";
  language: string;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  segments: NewRunSegment[];
}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.transcriptionRun.create({
      data: {
        sourceId: params.sourceId,
        jobId: params.jobId,
        origin: params.origin,
        language: params.language,
        rangeStartSeconds: params.rangeStartSeconds,
        rangeEndSeconds: params.rangeEndSeconds,
      },
    });
    if (params.segments.length) {
      await tx.transcriptSegment.createMany({
        data: params.segments.map((segment) => ({
          sourceId: params.sourceId,
          runId: run.id,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          text: segment.text,
          confidence: segment.confidence,
          isActive: false,
        })),
      });
    }
    const activeCount = await tx.transcriptSegment.count({ where: { sourceId: params.sourceId, isActive: true } });
    if (activeCount === 0) await applyRunWithStrategy(tx, run, "replace_overlap");
    return tx.transcriptionRun.findUniqueOrThrow({ where: { id: run.id }, include: { segments: { orderBy: { startSeconds: "asc" } } } });
  });
}

export function serializeRun(run: Awaited<ReturnType<typeof createTranscriptionRun>>) {
  return {
    id: run.id,
    origin: run.origin,
    language: run.language,
    rangeStartSeconds: run.rangeStartSeconds,
    rangeEndSeconds: run.rangeEndSeconds,
    status: run.status,
    createdAt: run.createdAt,
    error: run.error,
    segments: run.segments,
  };
}
