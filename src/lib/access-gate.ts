// Shared-secret access gate. Pure helpers on Web Crypto only, so the Edge middleware and the route handlers share them.
// With ACCESS_SECRET unset the gate is off and nothing changes (development, existing installs).

export const GATE_COOKIE = "saarnavideo-session";
export const GATE_HEADER = "x-access-secret";
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

export function accessSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.ACCESS_SECRET?.trim();
  return secret ? secret : null;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The cookie value: derived from the secret, so changing the secret signs everybody out. */
export function sessionToken(secret: string): Promise<string> {
  return hmacHex(secret, "saarnavideo-session-v1");
}

/** Compares two strings in time that does not depend on where they differ (both are hashed to equal length first). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmacHex("compare", a), hmacHex("compare", b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i += 1) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/** A same-site path only, so the login page cannot be used as an open redirect. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

export interface GateInput {
  secret: string;
  cookie?: string | null;
  header?: string | null;
  authorization?: string | null;
}

/** True when the request carries the secret: the session cookie, an `x-access-secret` header or `Authorization: Bearer`. */
export async function isAuthorized({ secret, cookie, header, authorization }: GateInput): Promise<boolean> {
  if (cookie && (await safeEqual(cookie, await sessionToken(secret)))) return true;
  if (header && (await safeEqual(header, secret))) return true;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(bearer && (await safeEqual(bearer, secret)));
}
