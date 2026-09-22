import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * HTTP client for the liturgos-auditor-stt batch jobs API:
 *   POST   /v1/jobs               submit a file for transcription
 *   GET    /v1/jobs/{id}          poll status/progress
 *   GET    /v1/jobs/{id}/result   fetch the transcript (format=json here)
 *   DELETE /v1/jobs/{id}          cancel a running job / purge a finished one
 *
 * Field and status names below are taken verbatim from
 * liturgos-auditor/docs/batch-jobs.md and docs/integration.md — treat those
 * documents as the source of truth if this client and they ever disagree.
 */

export type AuditorSttClientOptions = {
  /** Base URL of the auditor-stt service. Defaults to the AUDITOR_STT_URL env var, then http://localhost:8090. */
  baseUrl?: string;
  /** Bearer token. Only sent when set. The service itself only requires it when AUDITOR_STT_API_KEY is configured server-side. Defaults to the AUDITOR_STT_API_KEY env var. */
  apiKey?: string;
  /** Timeout for the fast JSON calls (status/result/delete). Default 30s. */
  requestTimeoutMs?: number;
  /** Timeout for the (potentially large) file upload on submit. Default 30 minutes. */
  uploadTimeoutMs?: number;
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type SubmitJobOptions = {
  language?: string;
  chunkSeconds?: number;
  wordTimestamps?: boolean;
  prompt?: string;
  clientRef?: string;
};

export type JobSubmitResponse = { id: string; status: "queued" };

export type JobStatusResponse = {
  id: string;
  status: JobStatus;
  phase: string;
  error: string | null;
  client_ref: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress: number;
  current_seconds: number;
  total_seconds: number;
  eta_seconds: number | null;
  chunks_done: number;
  chunks_total: number;
  params: { language: string; chunk_seconds: number; word_timestamps: boolean };
  cancel_requested: boolean;
};

export type JobResultWord = { start: number; end: number; text: string; probability: number };

export type JobResultSegment = {
  start: number;
  end: number;
  text: string;
  avg_logprob: number | null;
  no_speech_prob: number | null;
  words: JobResultWord[];
};

export type JobResultJson = {
  text: string;
  language: string;
  segments: JobResultSegment[];
  complete: boolean;
  chunks_done: number;
  chunks_total: number;
  duration_seconds: number;
  models?: string[];
};

export type GetJobResultOptions = { partial?: boolean };

export type WaitForCompletionOptions = {
  /** Initial poll interval. Default 750ms, matching src/worker/index.ts's own default poll cadence. */
  pollMs?: number;
  /** The poll interval backs off by 250ms per poll up to this cap. Default 2000ms (also matching the worker). */
  maxPollMs?: number;
  /** Overall bound on how long to keep polling before giving up. Default 6 hours. */
  timeoutMs?: number;
  onProgress?: (status: JobStatusResponse) => void;
};

const DEFAULT_BASE_URL = "http://localhost:8090";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 750;
const DEFAULT_MAX_POLL_MS = 2000;
const POLL_BACKOFF_STEP_MS = 250;
const DEFAULT_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const TERMINAL_STATUSES: readonly JobStatus[] = ["completed", "failed", "cancelled"];

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

function guessContentType(fileName: string): string {
  return EXTENSION_CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

/**
 * Builds a multipart/form-data body that streams the file from disk instead
 * of buffering it fully in memory, so a multi-GB source does not have to fit
 * in the process's heap (matching the streaming style already used for the
 * YouTube upload in src/integrations/youtube.ts, which also hands fetch a
 * Node stream with duplex: "half"). The exact byte length is known up front
 * (preamble + file size + closing boundary), so we can still send a
 * Content-Length header.
 */
async function buildMultipartBody(
  filePath: string,
  fields: Record<string, string>,
  fileFieldName: string,
  fileName: string,
  contentType: string,
): Promise<{ body: Readable; boundary: string; contentLength: number }> {
  const boundary = `----saarnavideoAuditorStt${crypto.randomUUID().replace(/-/g, "")}`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const preamble = Buffer.from(parts.join(""), "utf8");
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fileSize = (await stat(filePath)).size;

  async function* generate() {
    yield preamble;
    for await (const chunk of createReadStream(filePath)) yield chunk as Buffer;
    yield closing;
  }

  return { body: Readable.from(generate()), boundary, contentLength: preamble.length + fileSize + closing.length };
}

export class AuditorSttClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly requestTimeoutMs: number;
  private readonly uploadTimeoutMs: number;

  constructor(options: AuditorSttClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AUDITOR_STT_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env.AUDITOR_STT_API_KEY ?? undefined;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async request(pathName: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${pathName}`, {
        ...init,
        headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST /v1/jobs — submits a local file for transcription by streaming it from disk (multipart upload; no shared media volume is assumed). */
  async submitJob(filePath: string, options: SubmitJobOptions = {}): Promise<JobSubmitResponse> {
    const fields: Record<string, string> = {};
    if (options.language !== undefined) fields.language = options.language;
    if (options.chunkSeconds !== undefined) fields.chunk_seconds = String(options.chunkSeconds);
    if (options.wordTimestamps !== undefined) fields.word_timestamps = String(options.wordTimestamps);
    if (options.prompt !== undefined) fields.prompt = options.prompt;
    if (options.clientRef !== undefined) fields.client_ref = options.clientRef;

    const fileName = path.basename(filePath);
    const { body, boundary, contentLength } = await buildMultipartBody(filePath, fields, "file", fileName, guessContentType(fileName));

    const response = await this.request(
      "/v1/jobs",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(contentLength) },
        body: body as unknown as BodyInit,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
      this.uploadTimeoutMs,
    );

    if (response.status !== 202) throw new Error(`Auditor STT job submission failed (${response.status}): ${await safeText(response)}`);
    return (await response.json()) as JobSubmitResponse;
  }

  /** GET /v1/jobs/{id} */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }, this.requestTimeoutMs);
    if (!response.ok) throw new Error(`Auditor STT job status failed (${response.status}): ${await safeText(response)}`);
    return (await response.json()) as JobStatusResponse;
  }

  /** GET /v1/jobs/{id}/result?format=json[&partial=1] */
  async getJobResult(jobId: string, options: GetJobResultOptions = {}): Promise<JobResultJson> {
    const query = options.partial ? "?format=json&partial=1" : "?format=json";
    const response = await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/result${query}`, { method: "GET" }, this.requestTimeoutMs);
    if (!response.ok) throw new Error(`Auditor STT job result failed (${response.status}): ${await safeText(response)}`);
    return (await response.json()) as JobResultJson;
  }

  /** DELETE /v1/jobs/{id} — cancels a running job or purges a finished one. 202/204/404 are all treated as success (404 means it is already gone). */
  async deleteJob(jobId: string): Promise<{ status: number }> {
    const response = await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, this.requestTimeoutMs);
    if (response.status !== 202 && response.status !== 204 && response.status !== 404) {
      throw new Error(`Auditor STT job delete failed (${response.status}): ${await safeText(response)}`);
    }
    return { status: response.status };
  }

  /**
   * Polls GET /v1/jobs/{id} until it reaches a terminal status (completed,
   * failed or cancelled), or throws once timeoutMs has elapsed (bounded —
   * this never polls forever). The interval starts at pollMs and backs off
   * toward maxPollMs so a long job is not polled faster than the service
   * writes progress, roughly matching saarnavideo's own worker's cadence
   * (see PROGRESS_WRITE_MS / POLL_MS in src/worker/index.ts).
   */
  async waitForCompletion(jobId: string, options: WaitForCompletionOptions = {}): Promise<JobStatusResponse> {
    const minPollMs = Math.max(250, options.pollMs ?? DEFAULT_POLL_MS);
    const maxPollMs = Math.max(minPollMs, options.maxPollMs ?? DEFAULT_MAX_POLL_MS);
    const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let pollMs = minPollMs;

    for (;;) {
      const status = await this.getJobStatus(jobId);
      options.onProgress?.(status);
      if (TERMINAL_STATUSES.includes(status.status)) return status;

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Auditor STT job ${jobId} did not finish within ${timeoutMs}ms`);
      await sleep(Math.min(pollMs, remaining));
      pollMs = Math.min(maxPollMs, pollMs + POLL_BACKOFF_STEP_MS);
    }
  }
}
