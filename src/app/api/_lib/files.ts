import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { jsonError } from "./http";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024);

export function mediaRoot() {
  return process.env.MEDIA_ROOT ?? "/data/media";
}

export function parseDurationMs(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
}

/** Validates the `file` form field of a source upload; returns the file or an error response. */
export function sourceUploadFile(file: FormDataEntryValue | null): File | Response {
  if (!(file instanceof File)) return jsonError("A file is required", 400);
  if (file.size <= 0) return jsonError("File is empty", 400);
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("File is too large", 413);
  return file;
}

/** Writes an uploaded source file under MEDIA_ROOT/sources/<projectId>/ and returns its path. */
export async function saveSourceFile(projectId: string, file: File): Promise<string> {
  const directory = path.join(mediaRoot(), "sources", projectId);
  await mkdir(directory, { recursive: true });
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "source";
  const storagePath = path.join(directory, `${Date.now()}-${safeName}`);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
  return storagePath;
}

/** Streams a media file, honouring a single `Range: bytes=start-end` request header. */
export async function rangedFileResponse(request: Request, storagePath: string, mimeType: string | null) {
  const size = (await stat(storagePath)).size;
  const range = request.headers.get("range");
  const headers = new Headers({ "Content-Type": mimeType || "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60" });
  const stream = (start?: number, end?: number) => Readable.toWeb(createReadStream(storagePath, start === undefined ? undefined : { start, end })) as ReadableStream;
  if (!range) {
    headers.set("Content-Length", String(size));
    return new Response(stream(), { status: 200, headers });
  }
  const unsatisfiable = () => new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return unsatisfiable();
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (start >= size || requestedEnd < start) return unsatisfiable();
  const end = Math.min(requestedEnd, size - 1);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(stream(start, end), { status: 206, headers });
}
