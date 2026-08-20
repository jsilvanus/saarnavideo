import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { youtubeAuthorizationUrl } from "@/integrations/youtube-oauth";

export async function GET() {
  const state = randomUUID();
  const response = NextResponse.redirect(youtubeAuthorizationUrl(state));
  response.cookies.set("youtube_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}
