import { prisma } from "@/lib/prisma";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

function config() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("YouTube OAuth is not configured");
  return { clientId, clientSecret, redirectUri };
}

export function youtubeAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeYouTubeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = config();
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
  if (!response.ok) throw new Error(`YouTube OAuth token exchange failed (${response.status})`);
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!token.access_token || !token.refresh_token) throw new Error("YouTube OAuth did not return a refresh token");
  return prisma.youTubeConnection.upsert({ where: { provider: "youtube" }, update: { accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiry: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null, scope: token.scope }, create: { provider: "youtube", accessToken: token.access_token, refreshToken: token.refresh_token, tokenExpiry: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null, scope: token.scope } });
}

export async function getYouTubeAccessToken(): Promise<string> {
  const connection = await prisma.youTubeConnection.findUnique({ where: { provider: "youtube" } });
  if (!connection) throw new Error("YouTube account is not connected");
  if (connection.tokenExpiry && connection.tokenExpiry.getTime() > Date.now() + 60_000) return connection.accessToken;
  const { clientId, clientSecret } = config();
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: connection.refreshToken, grant_type: "refresh_token" }) });
  if (!response.ok) throw new Error(`YouTube token refresh failed (${response.status})`);
  const token = await response.json() as { access_token: string; expires_in?: number };
  await prisma.youTubeConnection.update({ where: { id: connection.id }, data: { accessToken: token.access_token, tokenExpiry: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null } });
  return token.access_token;
}
