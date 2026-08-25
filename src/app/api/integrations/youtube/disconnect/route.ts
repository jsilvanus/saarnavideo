import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  await prisma.youTubeConnection.deleteMany({ where: { provider: "youtube" } });
  return NextResponse.json({ connected: false });
}
