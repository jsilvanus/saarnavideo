import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/_lib/http";
import { getFleetStatus } from "@/lib/fleet-status";

export const dynamic = "force-dynamic";

/** Numbers for the fleet strip in the job panel. `{ enabled: false }` when FLEET_STRIP=0. Never returns addresses or credentials. */
export async function GET() {
  try {
    return NextResponse.json(await getFleetStatus());
  } catch (error) {
    console.error("Fleet status error:", error);
    return jsonError("Failed to read fleet status", 500);
  }
}
