import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeImport } from "@/lib/lcyt-import";

export async function GET() {
  const rows = await prisma.import.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json(rows.map((row) => serializeImport(row)));
}
