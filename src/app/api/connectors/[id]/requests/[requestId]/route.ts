import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { isUniqueViolation } from "@/app/api/_lib/connectors";
import { requestPatchSchema, requestView } from "@/domain/connectors";

type Context = { params: Promise<{ id: string; requestId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, requestId } = await context.params;
  try {
    const input = requestPatchSchema.parse(await request.json());
    if (!(await prisma.apiRequest.findFirst({ where: { id: requestId, connectorId: id }, select: { id: true } }))) return jsonError("Request not found", 404);
    const row = await prisma.apiRequest.update({
      where: { id: requestId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.method !== undefined && { method: input.method }),
        ...(input.path !== undefined && { path: input.path }),
        ...(input.query !== undefined && { query: input.query }),
        ...(input.bodyType !== undefined && { bodyType: input.bodyType }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.responseType !== undefined && { responseType: input.responseType }),
        ...(input.mappings !== undefined && { mappings: input.mappings }),
        ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
      },
    });
    return NextResponse.json(requestView(row));
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    if (isUniqueViolation(error)) return jsonError("This connector already has a request with that name", 409);
    console.error(error);
    return jsonError("Unable to save the request", 500);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id, requestId } = await context.params;
  const deleted = await prisma.apiRequest.deleteMany({ where: { id: requestId, connectorId: id } });
  if (deleted.count === 0) return jsonError("Request not found", 404);
  return NextResponse.json({ ok: true });
}
