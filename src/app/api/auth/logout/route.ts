import { NextResponse } from "next/server";
import { GATE_COOKIE } from "@/lib/access-gate";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(GATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
