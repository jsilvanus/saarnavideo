import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptYouTubeToken, encryptYouTubeToken } from "./youtube-token-crypto";

const PROVIDER = "youtube";
export const MAX_COOKIES_BYTES = 256 * 1024;

export type CookiesStatus = { configured: boolean; source: "db" | "env" | "none"; cookieCount: number | null; updatedAt: Date | null; envFallback: boolean };

/** Number of cookie lines (7 tab-separated fields; `#HttpOnly_` lines count, other comments do not) in a Netscape cookie file. */
export function countCookies(text: string): number {
  return text.split(/\r?\n/).filter((line) => {
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) return false;
    return line.split("\t").length === 7;
  }).length;
}

/** Normalises pasted/uploaded cookie text (line endings, header) and validates it; throws a readable Error when it is not a cookie file. */
export function parseCookiesText(raw: string): { text: string; count: number } {
  if (Buffer.byteLength(raw, "utf8") > MAX_COOKIES_BYTES) throw new Error("The cookie file is too large (max 256 KB)");
  const body = raw.replace(/\r\n?/g, "\n").trim();
  const count = countCookies(body);
  if (!count) throw new Error("No cookies found: expected a Netscape-format cookies.txt (tab-separated, 7 fields per line)");
  const text = /^#\s*(Netscape|HTTP) /i.test(body) ? body : `# Netscape HTTP Cookie File\n${body}`;
  return { text: `${text}\n`, count };
}

const envCookiesFile = () => process.env.YTDLP_COOKIES_FILE?.trim() || undefined;

export async function saveStoredCookies(text: string): Promise<{ count: number }> {
  const { text: normalized, count } = parseCookiesText(text);
  const encrypted = encryptYouTubeToken(normalized);
  await prisma.ytDlpCookies.upsert({ where: { provider: PROVIDER }, create: { provider: PROVIDER, encrypted, cookieCount: count }, update: { encrypted, cookieCount: count } });
  return { count };
}

export async function deleteStoredCookies(): Promise<void> {
  await prisma.ytDlpCookies.deleteMany({ where: { provider: PROVIDER } });
}

export async function getStoredCookies(): Promise<string | null> {
  const row = await prisma.ytDlpCookies.findUnique({ where: { provider: PROVIDER }, select: { encrypted: true } });
  return row ? decryptYouTubeToken(row.encrypted) : null;
}

export async function cookiesStatus(): Promise<CookiesStatus> {
  const row = await prisma.ytDlpCookies.findUnique({ where: { provider: PROVIDER }, select: { cookieCount: true, updatedAt: true } });
  const envFallback = Boolean(envCookiesFile());
  if (row) return { configured: true, source: "db", cookieCount: row.cookieCount, updatedAt: row.updatedAt, envFallback };
  return { configured: envFallback, source: envFallback ? "env" : "none", cookieCount: null, updatedAt: null, envFallback };
}

export type CookieStore = { get(): Promise<string | null>; save(text: string): Promise<unknown> };
const dbStore: CookieStore = { get: getStoredCookies, save: saveStoredCookies };

export type CookiesRun = { source: "db" | "env"; updated: boolean };

/**
 * Runs `fn` with the cookie file a yt-dlp download should use, or undefined when none is configured. Cookies stored in the
 * database win; YTDLP_COOKIES_FILE is the fallback. A database copy is decrypted into a private temp file for the run only,
 * and, because yt-dlp rewrites the file, saved back (re-encrypted) when it changed. The temp file is always removed.
 * The env file is passed as is (yt-dlp, or the fleet write-back, updates it in place).
 */
export async function withDownloadCookies<T>(fn: (cookiesFile: string | undefined, info: { source: "db" | "env" | "none" }) => Promise<T>, store: CookieStore = dbStore, baseDir = tmpdir()): Promise<{ result: T; cookies: CookiesRun | null }> {
  const stored = await store.get();
  if (stored === null) {
    const file = envCookiesFile();
    return { result: await fn(file, { source: file ? "env" : "none" }), cookies: file ? { source: "env", updated: false } : null };
  }
  await mkdir(baseDir, { recursive: true });
  const dir = await mkdtemp(path.join(baseDir, "saarnavideo-cookies-"), { encoding: "utf8" });
  const file = path.join(dir, "cookies.txt");
  try {
    await writeFile(file, stored, { mode: 0o600 });
    const result = await fn(file, { source: "db" });
    let updated = false;
    const after = await readFile(file, "utf8").catch(() => null);
    if (after !== null && after !== stored && countCookies(after) > 0) { await store.save(after); updated = true; }
    return { result, cookies: { source: "db", updated } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
