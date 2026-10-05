import { NextResponse } from "next/server";
import { cookiesStatus, deleteStoredCookies, saveStoredCookies } from "@/integrations/ytdlp-cookies";

// The cookie text is write-only: it is never returned, only whether cookies are set, how many, and when they changed.
export async function GET() {
  return NextResponse.json(await cookiesStatus());
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { cookies?: unknown } | null;
  if (typeof body?.cookies !== "string" || !body.cookies.trim()) return NextResponse.json({ error: "cookies (text of a Netscape cookies.txt) is required" }, { status: 400 });
  try {
    await saveStoredCookies(body.cookies);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saving the cookies failed";
    // A missing or malformed encryption key is a server configuration problem, not a bad request.
    return NextResponse.json({ error: message }, { status: message.includes("YOUTUBE_TOKEN_ENCRYPTION_KEY") ? 503 : 400 });
  }
  return NextResponse.json(await cookiesStatus());
}

export async function DELETE() {
  await deleteStoredCookies();
  return NextResponse.json(await cookiesStatus());
}
