import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { api, createProject, fixture, fixturesDir, probe, uploadSource, waitForJob } from "./helpers";

// Real speech-to-text round trip: worker -> ffmpeg range extraction -> liturgos-auditor-stt (faster-whisper) -> TranscriptionRun.
// Needs AUDITOR_STT_URL pointing at a healthy service (a small model such as "tiny" is enough) and espeak-ng to synthesize the speech.
// Skips cleanly when either is missing. Run with `npm run test:e2e:transcription`.
const execFileAsync = promisify(execFile);
const auditorUrl = inject("auditorSttUrl");

async function probeStt(url: string) {
  if (!url) return "AUDITOR_STT_URL is not set";
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok ? "" : `${url}/health returned ${response.status}`;
  } catch (error) {
    return `${url}/health is unreachable (${error instanceof Error ? error.message : error})`;
  }
}

async function hasEspeak() {
  try {
    await execFileAsync("espeak-ng", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const skipReason = (await probeStt(auditorUrl)) || ((await hasEspeak()) ? "" : "espeak-ng is not installed");
if (skipReason) console.warn(`[transcription e2e] skipped: ${skipReason}`);

const PHRASE_A = "Good morning and welcome to church today";
const PHRASE_B = "Let us pray together for peace and love";
const GAP_SECONDS = 4;

async function speak(text: string, wavPath: string) {
  await execFileAsync("espeak-ng", ["-v", "en", "-s", "130", "-w", wavPath, text]);
  return (await probe(wavPath)).duration;
}

const words = (segments: Array<{ text: string }>) => segments.map((segment) => segment.text).join(" ").toLowerCase().replace(/[^a-z' ]+/g, " ");

type Segment = { startSeconds: number; endSeconds: number; text: string };
type Captions = { active: Segment[]; pendingRuns: unknown[] };

describe.skipIf(Boolean(skipReason))("transcription via liturgos-auditor-stt", () => {
  let projectId: string;
  let totalSeconds: number;
  let phraseBStart: number;

  beforeAll(async () => {
    await mkdir(fixturesDir, { recursive: true });
    const a = fixture("speech-a.wav");
    const b = fixture("speech-b.wav");
    const durationA = await speak(PHRASE_A, a);
    await speak(PHRASE_B, b);
    // Speech A, a silent gap, speech B: B's true position in the whole source is known, which is what the offset check needs.
    phraseBStart = durationA + GAP_SECONDS;
    const list = fixture("speech-concat.txt");
    const silence = fixture("speech-gap.wav");
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", String(GAP_SECONDS), silence]);
    await writeFile(list, [a, silence, b].map((file) => `file '${file}'`).join("\n"));
    const joined = fixture("speech.wav");
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ar", "22050", "-ac", "1", joined]);
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x240:r=15", "-i", joined, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fixture("speech.mp4")]);
    totalSeconds = (await probe(fixture("speech.mp4"))).duration;

    projectId = (await createProject("Transcription e2e")).id;
  });

  /**
   * Queues a TRANSCRIBE job on a fresh source and returns its segments. A source with no active
   * segments has the run auto-applied (see createTranscriptionRun), so they come back as `active`.
   */
  async function transcribe(body: Record<string, unknown>) {
    const sourceId = (await uploadSource(projectId, "speech.mp4", Math.round(totalSeconds * 1000))).id;
    const job = await api<{ id: string }>(`/api/projects/${projectId}/source/${sourceId}/transcription-jobs`, { method: "POST", json: { language: "en", ...body } }, 202);
    const done = await waitForJob(projectId, job.id, 170_000);
    expect(done.error).toBeNull();
    expect(done.status).toBe("COMPLETED");
    const captions = await api<Captions>(`/api/sources/${sourceId}/captions`);
    expect(captions.pendingRuns).toHaveLength(0);
    if (process.env.E2E_VERBOSE) console.log(JSON.stringify(captions.active.map((s) => [s.startSeconds, s.endSeconds, s.text])));
    return captions.active;
  }

  it("transcribes the whole source with ordered, in-range segments containing the spoken words", async () => {
    const segments = await transcribe({});
    expect(segments.length).toBeGreaterThan(0);

    let previousStart = -1;
    for (const segment of segments) {
      expect(segment.startSeconds).toBeGreaterThanOrEqual(previousStart);
      expect(segment.endSeconds).toBeGreaterThan(segment.startSeconds);
      expect(segment.startSeconds).toBeGreaterThanOrEqual(0);
      expect(segment.endSeconds).toBeLessThanOrEqual(totalSeconds + 1);
      previousStart = segment.startSeconds;
    }
    const text = words(segments);
    for (const word of ["welcome", "church", "pray", "peace"]) expect(text).toContain(word);
  });

  it("puts partial-range segments on the whole-source timeline, not the extracted clip's", async () => {
    // Start one second before phrase B so the extracted clip's own time zero is clearly not the source's.
    const rangeStartSeconds = phraseBStart - 1;
    expect(rangeStartSeconds).toBeGreaterThan(4);
    const segments = await transcribe({ rangeStartSeconds, rangeEndSeconds: totalSeconds });
    expect(segments.length).toBeGreaterThan(0);

    const text = words(segments);
    expect(text).toContain("pray");
    expect(text).not.toContain("welcome");
    let previousStart = -1;
    for (const segment of segments) {
      // Uncorrected (clip-relative) times would be < 3s here; corrected ones cannot start before the range.
      expect(segment.startSeconds).toBeGreaterThanOrEqual(rangeStartSeconds - 0.01);
      expect(segment.endSeconds).toBeLessThanOrEqual(totalSeconds + 1);
      expect(segment.startSeconds).toBeGreaterThanOrEqual(previousStart);
      previousStart = segment.startSeconds;
    }
    expect(Math.abs(segments[0].startSeconds - phraseBStart)).toBeLessThan(1.5);
  });
});
