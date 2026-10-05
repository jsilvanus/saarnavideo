import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { isUniqueViolation } from "@/app/api/_lib/connectors";
import { connectorInputSchema, connectorView, mergeAuth } from "@/domain/connectors";

/** All API connectors with their requests. Secrets are never returned, only `auth.hasSecret`. */
export async function GET() {
  const rows = await prisma.apiConnector.findMany({ orderBy: { name: "asc" }, include: { requests: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  return NextResponse.json({ connectors: rows.map(connectorView) });
}

export async function POST(request: Request) {
  try {
    const input = connectorInputSchema.parse(await request.json());
    const row = await prisma.apiConnector.create({
      data: { name: input.name, baseUrl: input.baseUrl, auth: mergeAuth(undefined, input.auth), headers: input.headers },
      include: { requests: true },
    });
    return NextResponse.json(connectorView(row), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    if (isUniqueViolation(error)) return jsonError("A connector with that name already exists", 409);
    console.error(error);
    return jsonError("Unable to save the connector", 500);
  }
}
