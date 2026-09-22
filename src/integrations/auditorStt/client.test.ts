import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditorSttClient, type JobStatusResponse } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function statusBody(overrides: Partial<JobStatusResponse> = {}): JobStatusResponse {
  return {
    id: "abc123",
    status: "running",
    phase: "transcribing",
    error: null,
    client_ref: null,
    created_at: "2024-09-21T12:34:56Z",
    started_at: "2024-09-21T12:34:57Z",
    finished_at: null,
    progress: 40,
    current_seconds: 10,
    total_seconds: 25,
    eta_seconds: 15,
    chunks_done: 1,
    chunks_total: 3,
    params: { language: "fi", chunk_seconds: 60, word_timestamps: true },
    cancel_requested: false,
    ...overrides,
  };
}

describe("AuditorSttClient", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "auditor-stt-client-"));
    filePath = path.join(tempDir, "clip.wav");
    writeFileSync(filePath, Buffer.from("not really audio, just test bytes"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("submits a job as a streamed multipart/form-data upload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8090/v1/jobs");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=----saarnavideoAuditorStt/);
      expect(Number(headers["Content-Length"])).toBeGreaterThan(0);
      expect(headers.Authorization).toBeUndefined();
      expect((init as { duplex?: string })?.duplex).toBe("half");
      return jsonResponse(202, { id: "abc123", status: "queued" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    const result = await client.submitJob(filePath, { language: "fi", chunkSeconds: 30, wordTimestamps: false });

    expect(result).toEqual({ id: "abc123", status: "queued" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends an Authorization header only when an API key is configured", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret-key");
      return jsonResponse(202, { id: "abc123", status: "queued" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090", apiKey: "secret-key" });
    await client.submitJob(filePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws with the service's response body on a non-202 submit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(422, { detail: "chunk_seconds outside 5-300" })));
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.submitJob(filePath, { chunkSeconds: 1000 })).rejects.toThrow(/422/);
  });

  it("fetches job status from GET /v1/jobs/{id}", async () => {
    const body = statusBody();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://localhost:8090/v1/jobs/abc123");
      return jsonResponse(200, body);
    }));
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.getJobStatus("abc123")).resolves.toEqual(body);
  });

  it("throws on a failing status request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.getJobStatus("missing")).rejects.toThrow(/404/);
  });

  it("fetches the JSON result with format=json", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://localhost:8090/v1/jobs/abc123/result?format=json");
      return jsonResponse(200, { text: "moi", language: "fi", segments: [], complete: true, chunks_done: 1, chunks_total: 1, duration_seconds: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    const result = await client.getJobResult("abc123");
    expect(result.text).toBe("moi");
  });

  it("requests a partial result when asked", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://localhost:8090/v1/jobs/abc123/result?format=json&partial=1");
      return jsonResponse(200, { text: "", language: "fi", segments: [], complete: false, chunks_done: 0, chunks_total: 3, duration_seconds: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await client.getJobResult("abc123", { partial: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deletes/cancels a job", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://localhost:8090/v1/jobs/abc123");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.deleteJob("abc123")).resolves.toEqual({ status: 202 });
  });

  it("treats delete of an unknown job (404) as success, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.deleteJob("gone")).resolves.toEqual({ status: 404 });
  });

  it("polls until a terminal status is reached, forwarding each status via onProgress", async () => {
    const statuses: JobStatusResponse["status"][] = ["queued", "running", "running", "completed"];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, statusBody({ status: statuses[call++] }))));

    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    const seen: JobStatusResponse["status"][] = [];
    const final = await client.waitForCompletion("abc123", { pollMs: 5, maxPollMs: 10, onProgress: (s) => seen.push(s.status) });

    expect(final.status).toBe("completed");
    expect(seen).toEqual(statuses);
  });

  it("gives up once the overall timeout elapses instead of polling forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, statusBody({ status: "running" }))));
    const client = new AuditorSttClient({ baseUrl: "http://localhost:8090" });
    await expect(client.waitForCompletion("abc123", { pollMs: 5, maxPollMs: 5, timeoutMs: 12 })).rejects.toThrow(/did not finish within/);
  });
});
