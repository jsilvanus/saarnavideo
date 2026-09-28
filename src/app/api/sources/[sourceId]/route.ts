import { prisma } from "@/lib/prisma";
import { rangedFileResponse } from "@/app/api/_lib/files";
import { jsonError } from "@/app/api/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source || source.type !== "UPLOAD" || !source.storagePath) return jsonError("Uploaded source not found", 404);
  return rangedFileResponse(request, source.storagePath, source.mimeType);
}
