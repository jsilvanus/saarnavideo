/**
 * Fetches a JSON API route and returns its body. Throws an Error carrying the
 * route's `error` field (or `fallback`) when the response is not ok. A missing
 * or non-JSON body is treated as `{}`.
 */
export async function requestJson<T = Record<string, unknown>>(url: string, init: RequestInit | undefined, fallback: string): Promise<T & { error?: string }> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? fallback);
  return data;
}

/** JSON request init for a method with a serialised body. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Message of a caught error, or `fallback` for non-Error values. */
export function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}
