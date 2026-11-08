import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { getYouTubeAccessToken } from "@/integrations/youtube-oauth";
import { createYouTubeClient, YouTubeApiError } from "@/integrations/youtube-api";

/** Playlists of the connected channel (playlists.list mine=true), for the playlist picker of the publish panel. */
export async function GET() {
  const connection = await prisma.youTubeConnection.findUnique({ where: { provider: "youtube" }, select: { id: true } });
  if (!connection) return jsonError("Connect a YouTube account first.", 409);
  try {
    const playlists = await createYouTubeClient({ token: forceRefresh => getYouTubeAccessToken({ forceRefresh }), maxRetries: 2 }).listPlaylists();
    return NextResponse.json({ playlists });
  } catch (error) {
    const status = error instanceof YouTubeApiError && error.status === 403 ? 403 : 502;
    return jsonError(error instanceof Error ? error.message : "Could not list YouTube playlists", status);
  }
}
