import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditorSttClient, type JobResultJson, type JobStatusResponse, type WaitForCompletionOptions } from "./client";
import { AuditorSttCancelledError, AuditorSttJobFailedError, AuditorSttTranscriptionProvider } from "./provider";

function statusResponse(overrides: Partial<JobStatusResponse> = {}): JobStatusResponse {
  return {
    id: "job-1",
    status: "completed",
    phase: "completed",
    error: null,
    client_ref: null,
    created_at: "2024-09-21T12:34:56Z",
    started_at: "2024-09-21T12:34:57Z",
    finished_at: "2024-09-21T12:35:56Z",
    progress: 100,
    current_seconds: 10,
    total_seconds: 10,
    eta_seconds: 0,
    chunks_done: 1,
    chunks_total: 1,
    params: { language: "fi", chunk_seconds: 60, word_timestamps: true },
    cancel_requested: false,
    ...overrides,
  };
}

describe("AuditorSttTranscriptionProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("submits, polls, fetches the result, and maps it to saarnavideo's TranscriptionResult", async () => {
    vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-1", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockImplementation(async (_jobId: string, options?: WaitForCompletionOptions) => {
      options?.onProgress?.(statusResponse({ status: "running", progress: 50, phase: "transcribing" }));
      return statusResponse();
    });
    const result: JobResultJson = {
      text: "moi maailma",
      language: "fi",
      complete: true,
      chunks_done: 1,
      chunks_total: 1,
      duration_seconds: 2,
      segments: [
        { start: 0, end: 1.5, text: "moi maailma", avg_logprob: -0.15, no_speech_prob: 0.001, words: [] },
        { start: 1.5, end: 1.5, text: "zero-length, must be dropped", avg_logprob: -0.5, no_speech_prob: 0.2, words: [] },
      ],
    };
    vi.spyOn(AuditorSttClient.prototype, "getJobResult").mockResolvedValue(result);

    const progressEvents: unknown[] = [];
    const provider = new AuditorSttTranscriptionProvider({ onProgress: (p) => progressEvents.push(p) });
    const transcription = await provider.transcribe("/tmp/clip.wav", "fi");

    expect(transcription.jobId).toBe("job-1");
    expect(transcription.transcript).toEqual({
      version: 1,
      language: "fi",
      segments: [{ startSeconds: 0, endSeconds: 1.5, text: "moi maailma", confidence: 0.85 }],
    });
    expect(transcription.suggestions).toEqual([]);
    expect(progressEvents).toEqual([{ jobId: "job-1", status: "running", phase: "transcribing", progress: 50, etaSeconds: 0 }]);
  });

  it("omits confidence when avg_logprob is null", async () => {
    vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-2", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockResolvedValue(statusResponse({ id: "job-2" }));
    vi.spyOn(AuditorSttClient.prototype, "getJobResult").mockResolvedValue({
      text: "x",
      language: "fi",
      complete: true,
      chunks_done: 1,
      chunks_total: 1,
      duration_seconds: 1,
      segments: [{ start: 0, end: 1, text: "x", avg_logprob: null, no_speech_prob: null, words: [] }],
    });

    const provider = new AuditorSttTranscriptionProvider();
    const transcription = await provider.transcribe("/tmp/clip.wav");
    expect(transcription.transcript.segments[0].confidence).toBeUndefined();
  });

  it("clamps confidence to [0, 1] for extreme avg_logprob values", async () => {
    vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-5", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockResolvedValue(statusResponse({ id: "job-5" }));
    vi.spyOn(AuditorSttClient.prototype, "getJobResult").mockResolvedValue({
      text: "x",
      language: "fi",
      complete: true,
      chunks_done: 1,
      chunks_total: 1,
      duration_seconds: 1,
      segments: [
        { start: 0, end: 1, text: "confident", avg_logprob: 0.5, no_speech_prob: 0, words: [] },
        { start: 1, end: 2, text: "unconfident", avg_logprob: -5, no_speech_prob: 0.9, words: [] },
      ],
    });

    const provider = new AuditorSttTranscriptionProvider();
    const transcription = await provider.transcribe("/tmp/clip.wav");
    expect(transcription.transcript.segments[0].confidence).toBe(1);
    expect(transcription.transcript.segments[1].confidence).toBe(0);
  });

  it("passes submit options (language, chunkSeconds, etc.) through to the client", async () => {
    const submitJob = vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-6", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockResolvedValue(statusResponse({ id: "job-6" }));
    vi.spyOn(AuditorSttClient.prototype, "getJobResult").mockResolvedValue({ text: "", language: "fi", complete: true, chunks_done: 0, chunks_total: 0, duration_seconds: 0, segments: [] });

    const provider = new AuditorSttTranscriptionProvider({ chunkSeconds: 45, wordTimestamps: false, prompt: "liturgical vocabulary", clientRef: "project-1" });
    await provider.transcribe("/tmp/clip.wav", "sv");

    expect(submitJob).toHaveBeenCalledWith("/tmp/clip.wav", { language: "sv", chunkSeconds: 45, wordTimestamps: false, prompt: "liturgical vocabulary", clientRef: "project-1" });
  });

  it("throws AuditorSttJobFailedError carrying the service's error string on a failed job", async () => {
    vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-3", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockResolvedValue(statusResponse({ id: "job-3", status: "failed", error: "Could not decode audio from /tmp/clip.wav" }));
    const getResult = vi.spyOn(AuditorSttClient.prototype, "getJobResult");

    const provider = new AuditorSttTranscriptionProvider();
    const error = await provider.transcribe("/tmp/clip.wav").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuditorSttJobFailedError);
    expect((error as AuditorSttJobFailedError).jobId).toBe("job-3");
    expect((error as Error).message).toContain("Could not decode audio from /tmp/clip.wav");
    expect(getResult).not.toHaveBeenCalled();
  });

  it("throws AuditorSttCancelledError distinctly from a failure on a cancelled job", async () => {
    vi.spyOn(AuditorSttClient.prototype, "submitJob").mockResolvedValue({ id: "job-4", status: "queued" });
    vi.spyOn(AuditorSttClient.prototype, "waitForCompletion").mockResolvedValue(statusResponse({ id: "job-4", status: "cancelled", error: null }));
    const getResult = vi.spyOn(AuditorSttClient.prototype, "getJobResult");

    const provider = new AuditorSttTranscriptionProvider();
    const error = await provider.transcribe("/tmp/clip.wav").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuditorSttCancelledError);
    expect(error).not.toBeInstanceOf(AuditorSttJobFailedError);
    expect((error as AuditorSttCancelledError).jobId).toBe("job-4");
    expect(getResult).not.toHaveBeenCalled();
  });
});
