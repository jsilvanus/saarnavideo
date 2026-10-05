import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { isUniqueViolation } from "@/app/api/_lib/connectors";
import { authInputSchema, connectorPatchSchema, connectorView, mergeAuth } from "@/domain/connectors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const row = await prisma.apiConnector.findUnique({ where: { id }, include: { requests: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  if (!row) return jsonError("Connector not found", 404);
  return NextResponse.json(connectorView(row));
}

/** Updates a connector. An auth secret that is left out stays as it was. */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const input = connectorPatchSchema.parse(await request.json());
    const existing = await prisma.apiConnector.findUnique({ where: { id } });
    if (!existing) return jsonError("Connector not found", 404);
    const previous = authInputSchema.catch({ type: "none" }).parse(existing.auth);
    const row = await prisma.apiConnector.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
        ...(input.headers !== undefined && { headers: input.headers }),
        ...(input.auth !== undefined && { auth: mergeAuth(previous, input.auth) }),
      },
      include: { requests: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    });
    return NextResponse.json(connectorView(row));
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    if (isUniqueViolation(error)) return jsonError("A connector with that name already exists", 409);
    console.error(error);
    return jsonError("Unable to save the connector", 500);
  }
}

/** Deletes a connector and its requests. Projects keep the variable values they already have. */
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const deleted = await prisma.apiConnector.deleteMany({ where: { id } });
  if (deleted.count === 0) return jsonError("Connector not found", 404);
  return NextResponse.json({ ok: true });
}
