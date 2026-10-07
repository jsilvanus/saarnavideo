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

/** Fetches a JSON route while reporting upload progress, e.g. for multipart FormData uploads. */
export async function requestJsonWithProgress<T = Record<string, unknown>>(
  url: string,
  init: RequestInit | undefined,
  fallback: string,
  onProgress: (percent: number) => void,
): Promise<T & { error?: string }> {
  const response = await uploadWithProgress(url, init, onProgress, fallback);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? fallback);
  return data;
}

/** Sends a request while reporting upload progress using XMLHttpRequest so browser uploads are visible. */
export function uploadWithProgress(
  url: string,
  init: RequestInit | undefined,
  onProgress: (percent: number) => void,
  fallback: string,
): Promise<Response> {
  if (typeof XMLHttpRequest === "undefined") {
    return fetch(url, init).then((response) => response);
  }
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    xhr.open(method, url, true);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };
    xhr.onload = () => {
      const response = new Response(xhr.responseText || "", {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: {
          "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json",
        },
      });
      resolve(response);
    };
    xhr.onerror = () => reject(new Error(fallback));
    xhr.ontimeout = () => reject(new Error(fallback));
    xhr.send(init?.body as BodyInit | null);
  });
}

/** JSON request init for a method with a serialised body. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Message of a caught error, or `fallback` for non-Error values. */
export function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}
