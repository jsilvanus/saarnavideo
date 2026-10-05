import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { isUniqueViolation } from "@/app/api/_lib/connectors";
import { requestInputSchema, requestView } from "@/domain/connectors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const input = requestInputSchema.parse(await request.json());
    if (!(await prisma.apiConnector.findUnique({ where: { id }, select: { id: true } }))) return jsonError("Connector not found", 404);
    const last = await prisma.apiRequest.findFirst({ where: { connectorId: id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const row = await prisma.apiRequest.create({
      data: {
        connectorId: id,
        name: input.name,
        method: input.method,
        path: input.path,
        query: input.query,
        bodyType: input.bodyType,
        body: input.body ?? null,
        responseType: input.responseType,
        mappings: input.mappings,
        timeoutMs: input.timeoutMs ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return NextResponse.json(requestView(row), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    if (isUniqueViolation(error)) return jsonError("This connector already has a request with that name", 409);
    console.error(error);
    return jsonError("Unable to save the request", 500);
  }
}
