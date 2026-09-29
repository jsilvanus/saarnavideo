import { NextResponse } from "next/server";
import { getFacebookPageName, readFacebookConfig } from "@/integrations/facebook";

// The Page name lookup doubles as a token check, so it is cached briefly to keep page loads from hitting the Graph API every time.
let cache: { key: string; at: number; body: Record<string, unknown> } | null = null;
const CACHE_MS = 60_000;

/** Whether the single Facebook Page is configured through the environment, and its name. Never returns the token. */
export async function GET() {
  let config;
  try { config = readFacebookConfig(); } catch (error) { return NextResponse.json({ configured: false, error: error instanceof Error ? error.message : "Invalid Facebook configuration" }); }
  if (!config) return NextResponse.json({ configured: false });
  const key = `${config.pageId}|${config.version}|${config.baseUrl}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  let body: Record<string, unknown>;
  try {
    body = { configured: true, pageId: config.pageId, pageName: await getFacebookPageName(config), graphVersion: config.version };
  } catch (error) {
    // Configured, but the token or Page is not usable right now: report it so the UI can warn before a publish fails.
    body = { configured: true, pageId: config.pageId, pageName: null, graphVersion: config.version, error: error instanceof Error ? error.message : "Could not reach Facebook" };
  }
  cache = { key, at: Date.now(), body };
  return NextResponse.json(body);
}
