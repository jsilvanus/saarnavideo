import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const connection = await prisma.youTubeConnection.findUnique({ where: { provider: "youtube" }, select: { createdAt: true, updatedAt: true, tokenExpiry: true, scope: true } });
  return NextResponse.json({ connected: Boolean(connection), tokenExpiry: connection?.tokenExpiry ?? null, scope: connection?.scope ?? null, connectedAt: connection?.createdAt ?? null, updatedAt: connection?.updatedAt ?? null });
}
