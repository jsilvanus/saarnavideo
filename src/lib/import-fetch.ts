import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkUrlAllowed, pinnedFetch, type NetworkRules } from "varfetch";
import { networkRulesFromEnv } from "@/domain/connectors";

/**
 * Server-side fetching of what another system hands over (manifest, VTT, event log, video files). The same SSRF guard as
 * the API connectors: private, loopback and link-local targets are refused unless `CONNECTOR_ALLOW` (or `IMPORT_ALLOW`)
 * lists them, and every redirect hop is checked again. Signed download URLs carry a token in the query string, so error
 * text only ever shows the address without it.
 */
const MAX_REDIRECTS = 5;

export function importNetworkRules(env: Record<string, string | undefined> = process.env): NetworkRules {
  const base = networkRulesFromEnv(env);
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return { allow: [...(base.allow ?? []), ...list(env.IMPORT_ALLOW)], deny: [...(base.deny ?? []), ...list(env.IMPORT_DENY)] };
}

/** `https://host/path` without query or credentials: safe for logs and error messages. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

export class ImportFetchError extends Error {}

export type FetchOptions = { rules?: NetworkRules; signal?: AbortSignal; timeoutMs?: number };

/** GET with the SSRF guard and manual redirects. The caller reads (or drops) the body. */
export async function guardedGet(input: string, options: FetchOptions = {}): Promise<Response> {
  const rules = options.rules ?? importNetworkRules();
  const signal = options.signal ?? (options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
  let url: URL;
  try { url = new URL(input); } catch { throw new ImportFetchError("Invalid URL"); }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ImportFetchError(`Unsupported protocol for ${scrubUrl(url.href)}`);
    const verdict = await checkUrlAllowed(url, { ...rules, signal });
    if (!verdict.allowed || !verdict.addresses) throw new ImportFetchError(`${verdict.reason ?? "Blocked"} (${scrubUrl(url.href)}). Allow the host with CONNECTOR_ALLOW or IMPORT_ALLOW if it is yours.`);
    let response: Response;
    try {
      response = await pinnedFetch(url, { method: "GET", headers: { accept: "*/*" }, signal }, { addresses: verdict.addresses });
    } catch (error) {
      throw new ImportFetchError(`Could not reach ${scrubUrl(url.href)}: ${error instanceof Error ? error.message.replace(/\?[^\s]*/g, "") : "network error"}`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      void response.body?.cancel().catch(() => undefined);
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    return response;
  }
  throw new ImportFetchError("Too many redirects");
}

async function okResponse(url: string, options: FetchOptions): Promise<Response> {
  const response = await guardedGet(url, options);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new ImportFetchError(`${scrubUrl(url)} answered ${response.status}`);
  }
  return response;
}

/** Reads a body into text, refusing more than `maxBytes`. */
async function readText(response: Response, maxBytes: number, what: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) { void response.body?.cancel().catch(() => undefined); throw new ImportFetchError(`${what} is larger than ${maxBytes} bytes`); }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(response.body as never) as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new ImportFetchError(`${what} is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchText(url: string, what: string, maxBytes: number, options: FetchOptions = {}): Promise<string> {
  return readText(await okResponse(url, { timeoutMs: 60_000, ...options }), maxBytes, what);
}

export async function fetchJson(url: string, what: string, maxBytes = 5 * 1024 * 1024, options: FetchOptions = {}): Promise<unknown> {
  const text = await fetchText(url, what, maxBytes, options);
  try { return JSON.parse(text); } catch { throw new ImportFetchError(`${what} is not valid JSON`); }
}

/** Streams a file to disk, stopping at `maxBytes`; a partial file is removed on failure. Returns the size. */
export async function downloadToFile(url: string, dest: string, options: FetchOptions & { maxBytes: number; onProgress?: (bytes: number, total: number | null) => void }): Promise<number> {
  const response = await okResponse(url, options);
  const declared = Number(response.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (total !== null && total > options.maxBytes) { void response.body?.cancel().catch(() => undefined); throw new ImportFetchError(`File is larger than the limit of ${options.maxBytes} bytes`); }
  let received = 0;
  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > options.maxBytes) source.destroy(new ImportFetchError(`File is larger than the limit of ${options.maxBytes} bytes`));
    else options.onProgress?.(received, total);
  });
  try {
    await pipeline(source, createWriteStream(dest));
  } catch (error) {
    await rm(dest, { force: true });
    throw error instanceof ImportFetchError ? error : new ImportFetchError(`Download of ${scrubUrl(url)} failed: ${error instanceof Error ? error.message : "error"}`);
  }
  if (total !== null && received !== total) { await rm(dest, { force: true }); throw new ImportFetchError(`Download of ${scrubUrl(url)} ended early`); }
  return received;
}
