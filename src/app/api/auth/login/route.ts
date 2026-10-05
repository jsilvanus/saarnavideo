import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, accessSecret, safeEqual, sessionToken } from "@/lib/access-gate";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request: NextRequest) {
  const secret = accessSecret();
  if (!secret) return NextResponse.json({ ok: true, gate: false });

  const body = (await request.json().catch(() => null)) as { secret?: unknown } | null;
  const given = typeof body?.secret === "string" ? body.secret : "";
  if (!(await safeEqual(given, secret))) {
    // A pause per wrong guess slows brute force from one client.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "Wrong secret" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set(GATE_COOKIE, await sessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: "/",
    maxAge: THIRTY_DAYS,
  });
  return response;
}
