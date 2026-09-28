import { prisma } from "@/lib/prisma";
import { jsonError } from "./http";

/** Loads a transcription run of the source that is still PENDING; otherwise returns the 404/409 response. */
export async function findPendingRun(sourceId: string, runId: string) {
  const run = await prisma.transcriptionRun.findFirst({ where: { id: runId, sourceId } });
  if (!run) return jsonError("Transcription run not found", 404);
  if (run.status !== "PENDING") return jsonError(`Run is already ${run.status.toLowerCase()}`, 409);
  return run;
}
