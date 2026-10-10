/**
 * Fetches a JSON API route and returns its body. Throws an Error carrying the
 * route's `error` field (or `fallback`) when the response is not ok. A missing
 * or non-JSON body is treated as `{}`.
 */
export async function requestJson<T = Record<string, unknown>>(url: string, init: RequestInit | undefined, fallback: string): Promise<T & { error?: string }> {
  // A network failure (server down, connection refused) throws a TypeError such as "Failed to fetch";
  // report the translated fallback instead, since that message is shown next to the control.
  const response = await fetch(url, init).catch(() => {
    throw new Error(fallback);
  });
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
  signal?: AbortSignal,
): Promise<T & { error?: string }> {
  const response = await uploadWithProgress(url, init, onProgress, fallback, signal);
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
  signal?: AbortSignal,
): Promise<Response> {
  if (typeof XMLHttpRequest === "undefined") {
    return fetch(url, init).then((response) => response);
  }
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const abort = () => {
      xhr.abort();
      reject(new DOMException("Upload was aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    xhr.open(method, url, true);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };
    xhr.onload = () => {
      if (signal) signal.removeEventListener("abort", abort);
      // Copy every response header: callers read ETag from S3 part uploads.
      const responseHeaders = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const separator = line.indexOf(":");
        if (separator > 0) responseHeaders.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
      }
      if (!responseHeaders.has("Content-Type")) responseHeaders.set("Content-Type", "application/json");
      const response = new Response(xhr.responseText || "", {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      });
      resolve(response);
    };
    xhr.onerror = () => {
      if (signal) signal.removeEventListener("abort", abort);
      reject(new Error(fallback));
    };
    xhr.ontimeout = () => {
      if (signal) signal.removeEventListener("abort", abort);
      reject(new Error(fallback));
    };
    const body = init?.body;
    if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData || body instanceof URLSearchParams || typeof body === "string") {
      xhr.send(body as XMLHttpRequestBodyInit);
      return;
    }
    xhr.send(body as XMLHttpRequestBodyInit | null);
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
