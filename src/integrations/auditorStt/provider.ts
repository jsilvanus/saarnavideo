import { transcriptionResultSchema, type TranscriptionProvider, type TranscriptionResult, type TranscriptSegment } from "@/domain/transcription";
import { AuditorSttClient, type AuditorSttClientOptions, type JobResultSegment, type JobStatusResponse } from "./client";

/**
 * A trimmed-down progress event surfaced from a running auditor-stt job.
 * Deliberately mirrors the fields saarnavideo's own MediaJob progress
 * columns would need if/when this gets wired into the worker (see the
 * follow-up note in the PR description); jobId is included so a caller can
 * persist it even though this pass does not.
 */
export type AuditorSttProgress = {
  jobId: string;
  status: JobStatusResponse["status"];
  phase: string;
  progress: number;
  etaSeconds: number | null;
};

export type AuditorSttTranscriptionOptions = AuditorSttClientOptions & {
  /** Chunk size in seconds sent to the service; see batch-jobs.md (default 60, range [5, 300]). */
  chunkSeconds?: number;
  /** Whether to request word-level timing. Not used by saarnavideo's segment-only transcript contract, so this only affects service-side cost; default is the service's own default (true). */
  wordTimestamps?: boolean;
  prompt?: string;
  clientRef?: string;
  pollMs?: number;
  maxPollMs?: number;
  /** Overall bound on how long transcribe() waits for the job to finish. Default 6 hours (see AuditorSttClient.waitForCompletion). */
  timeoutMs?: number;
  /** Called with each status poll while the job runs. This is the only way this pass exposes the STT job id + live progress; nothing here is persisted (see report). */
  onProgress?: (progress: AuditorSttProgress) => void;
};

/** The STT job id is not part of saarnavideo's TranscriptionResult contract, so it rides along on the object this provider actually returns. */
export type AuditorSttTranscriptionResult = TranscriptionResult & { jobId: string };

export class AuditorSttJobFailedError extends Error {
  constructor(public readonly jobId: string, public readonly serviceError: string | null) {
    super(`Auditor STT job ${jobId} failed: ${serviceError ?? "unknown error"}`);
    this.name = "AuditorSttJobFailedError";
  }
}

export class AuditorSttCancelledError extends Error {
  constructor(public readonly jobId: string) {
    super(`Auditor STT job ${jobId} was cancelled`);
    this.name = "AuditorSttCancelledError";
  }
}

/**
 * Rough confidence heuristic ported from saarnavideo's own dormant
 * faster-whisper worker (transcription/transcribe.py): clamp(avg_logprob +
 * 1.0, 0, 1). avg_logprob is at most 0 and the auditor-stt service defines
 * no calibrated scale or threshold for it (see
 * liturgos-auditor/docs/integration.md, "Segment fields"); this is a rough
 * proxy for "the model was fairly sure", not a calibrated probability.
 */
function confidenceFromAvgLogprob(avgLogprob: number | null): number | undefined {
  if (avgLogprob === null || avgLogprob === undefined) return undefined;
  return Math.max(0, Math.min(1, avgLogprob + 1));
}

function mapSegment(segment: JobResultSegment): TranscriptSegment | null {
  // The service passes faster-whisper's segment times through unchanged and does not
  // enforce endSeconds > startSeconds; saarnavideo's schema does, so a violating segment
  // is dropped rather than failing the whole transcript (see docs/integration.md).
  if (!(segment.end > segment.start)) return null;
  const confidence = confidenceFromAvgLogprob(segment.avg_logprob);
  return {
    startSeconds: segment.start,
    endSeconds: segment.end,
    text: segment.text,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * TranscriptionProvider backed by a remote liturgos-auditor-stt instance's
 * batch jobs API, as an alternative to the local, blocking
 * PythonTranscriptionProvider. Submits the file, polls to completion, and
 * maps the JSON result into saarnavideo's transcript contract.
 *
 * NOT wired into src/worker/index.ts, the Prisma schema or the UI in this
 * pass — see the integration note in the PR description for what that would
 * involve (a MediaJobType.TRANSCRIBE, a migration, a worker case, and
 * persisting the job id from AuditorSttProgress so a saarnavideo restart can
 * resume polling instead of losing track of the STT job).
 */
export class AuditorSttTranscriptionProvider implements TranscriptionProvider {
  private readonly client: AuditorSttClient;

  constructor(private readonly options: AuditorSttTranscriptionOptions = {}) {
    this.client = new AuditorSttClient(options);
  }

  async transcribe(inputPath: string, language?: string): Promise<AuditorSttTranscriptionResult> {
    const submission = await this.client.submitJob(inputPath, {
      language,
      chunkSeconds: this.options.chunkSeconds,
      wordTimestamps: this.options.wordTimestamps,
      prompt: this.options.prompt,
      clientRef: this.options.clientRef,
    });
    const jobId = submission.id;

    const finalStatus = await this.client.waitForCompletion(jobId, {
      pollMs: this.options.pollMs,
      maxPollMs: this.options.maxPollMs,
      timeoutMs: this.options.timeoutMs,
      onProgress: (status) => {
        this.options.onProgress?.({ jobId, status: status.status, phase: status.phase, progress: status.progress, etaSeconds: status.eta_seconds });
      },
    });

    if (finalStatus.status === "cancelled") throw new AuditorSttCancelledError(jobId);
    if (finalStatus.status === "failed") throw new AuditorSttJobFailedError(jobId, finalStatus.error);

    const result = await this.client.getJobResult(jobId);
    const segments = result.segments.map(mapSegment).filter((segment): segment is TranscriptSegment => segment !== null);

    try {
      const transcript = transcriptionResultSchema.parse({
        transcript: { version: 1, language: result.language, segments },
        suggestions: [],
      });
      return { ...transcript, jobId };
    } catch (error) {
      throw new Error(`Invalid auditor-stt result for job ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
