import { NextResponse } from "next/server";
import { exchangeYouTubeCode } from "@/integrations/youtube-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = request.headers.get("cookie") ?? "";
  const expected = cookieHeader.match(/(?:^|;\s*)youtube_oauth_state=([^;]+)/)?.[1];
  if (!code || !state || !expected || state !== expected) return NextResponse.json({ error: "Invalid YouTube OAuth state" }, { status: 400 });
  try {
    await exchangeYouTubeCode(code);
    const response = NextResponse.redirect(new URL("/?youtube=connected", request.url));
    response.cookies.delete("youtube_oauth_state");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "YouTube connection failed" }, { status: 500 });
  }
}
