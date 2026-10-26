import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { serializeImport } from "@/lib/lcyt-import";

/** Status of one import. `?events=1` adds the DSK event log kept from the stream. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await prisma.import.findUnique({ where: { id } });
  if (!row) return jsonError("Import not found", 404);
  return NextResponse.json(serializeImport(row, { events: new URL(request.url).searchParams.get("events") === "1" }));
}
