# Transcription + captions editor: backend/frontend contract

This is the frozen contract for wiring the `AuditorSttClient`/`AuditorSttTranscriptionProvider`
(`src/integrations/auditorStt/`) into the worker/job system, storing transcripts, and building the
Transcription tab UI. Backend and frontend are being built by two separate agents in parallel — **do
not deviate from the shapes below without updating this file first**, since the other side is building
against it independently.

Scope is a Source's transcript, not a Project's: `Source` is many-to-many with `Project`
(`Source.projects Project[]`), so a transcript belongs to the source and is shared by every project
that references it. Job *creation* is nested under a project (a `MediaJob` requires `projectId`), but
everything about the transcript itself (`/api/sources/:sourceId/...`) is source-scoped.

## Why transcripts are versioned as "runs", not just a single blob

Explicit product decision: **transcribing a source again must never silently overwrite an existing,
possibly hand-edited transcript.** Every transcription (whether from the STT service or an uploaded
.vtt) is stored as a `TranscriptionRun` containing its own segments. A run only becomes visible/editable
(`isActive` segments) when:
- it's the *first* run ever created for that source (nothing to protect yet → auto-applied), or
- the user explicitly clicks "Apply" on it.

This is also how "transcribe only part of the video" and "multiple transcriptions per video" and
"what happens on overlap" are all answered by the same mechanism: each transcription (full-video or a
selected range) is its own run; applying a run is always an explicit user action, and the user picks
how it reconciles with whatever is already active (see "Apply strategies" below). Nothing is ever
silently merged or overwritten.

## Prisma schema additions (`prisma/schema.postgresql.prisma` AND `prisma/schema.prisma` — both must
stay in sync, as the rest of the file already does)

```prisma
enum MediaJobType {
  DOWNLOAD
  THUMBNAIL
  PREVIEW
  VIDEO
  TRANSCRIBE          // NEW
}

enum TranscriptionRunOrigin {
  SERVICE   // produced by a MediaJob TRANSCRIBE job via liturgos-auditor-stt
  UPLOAD    // imported from a user-supplied .vtt file
  MANUAL    // segment(s) typed directly in the editor with no run backing them
}

enum TranscriptionRunStatus {
  PENDING     // exists, awaiting an explicit Apply/Discard decision
  APPLIED     // its segments (or the subset the chosen strategy selected) are/were promoted to isActive
  DISCARDED   // explicitly discarded; its segments are never active
}

model TranscriptionRun {
  id                String                   @id @default(cuid())
  sourceId          String
  source            Source                   @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  jobId             String?                  @unique
  job               MediaJob?                @relation(fields: [jobId], references: [id], onDelete: SetNull)
  origin            TranscriptionRunOrigin
  language          String
  rangeStartSeconds Float
  rangeEndSeconds   Float
  status            TranscriptionRunStatus   @default(PENDING)
  appliedAt         DateTime?
  appliedStrategy   String?                  // "replace_overlap" | "append", set when applied
  error             String?
  createdAt         DateTime                 @default(now())
  segments          TranscriptSegment[]
  @@index([sourceId, status])
}

model TranscriptSegment {
  id            String              @id @default(cuid())
  sourceId      String
  source        Source              @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  runId         String?             // nullable: MANUAL-origin segments inserted with no run context
  run           TranscriptionRun?   @relation(fields: [runId], references: [id], onDelete: Cascade)
  isActive      Boolean             @default(false)
  startSeconds  Float
  endSeconds    Float
  text          String
  confidence    Float?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  @@index([sourceId, isActive, startSeconds])
  @@index([runId])
}
```

Also add to existing models:
- `Source`: `transcriptionRuns TranscriptionRun[]`, `transcriptSegments TranscriptSegment[]`
- `MediaJob`: `transcriptionRun TranscriptionRun?`, and a new `cancelRequested Boolean @default(false)`
  column (see "Cancellation" below — there is currently no working cancel mechanism for `MediaJob`,
  this introduces the first one)

The "active track" for a source is always: `TranscriptSegment.findMany({ where: { sourceId, isActive:
true }, orderBy: { startSeconds: "asc" } })`. There is no separate "current transcript" pointer to keep
in sync — it's computed by that query alone.

## MediaJob.parameters shape for a TRANSCRIBE job

```ts
{
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  language: string;
  auditorJobId?: string;   // set as soon as submitJob() returns; persist before the first poll so a
                            // worker restart can find it again (see "Resumability")
  tempClipPath?: string;   // set only when a partial range required extracting an audio clip; used for
                            // cleanup and, if present, to know a restart should re-check disk state
}
```

## Partial-range transcription: the one correctness-critical rule

`AuditorSttClient.submitJob()` uploads a whole file — the batch jobs API has no start/end offset
parameters (confirmed against `docs/batch-jobs.md` in the liturgos-auditor repo). So a ranged
transcription request is **not** sent as-is:

1. If `rangeStartSeconds > 0 || rangeEndSeconds < (source.durationMs / 1000)`: extract just that range
   as 16kHz mono WAV *audio only* (no need to preserve video — this is going to an STT service) with
   ffmpeg, sample-accurate: `ffmpeg -y -i <source.storagePath> -ss <rangeStartSeconds> -to
   <rangeEndSeconds> -vn -acodec pcm_s16le -ar 16000 -ac 1 <tempClipPath>`. Use `-ss`/`-to` *after*
   `-i` so the cut is accurate, not keyframe-snapped. Store `tempClipPath` under `MEDIA_ROOT` (e.g.
   `path.join(MEDIA_ROOT, "tmp", `${job.id}.wav`)`), submit *that* file, and delete it once the job
   reaches a terminal state (completed/failed/cancelled) — same disk-hygiene reasoning as
   `docs/data-protection.md` in liturgos-auditor: don't keep audio around longer than needed.
2. If the range covers the whole source, submit `source.storagePath` directly (current behavior,
   unchanged, no temp file).
3. **The result's segments come back time-zeroed to the clip, not the source.** Before persisting any
   `TranscriptSegment`, add `rangeStartSeconds` to both `start` and `end` of every returned segment.
   Every `TranscriptSegment` ever stored is in source-absolute time, full stop — the editor, the
   overlap math, and VTT/SRT export must never have to think about which run's range produced a
   segment.

## Cancellation

`src/app/api/projects/[id]/jobs/[jobId]/cancel/route.ts` currently calls `prisma.generationJob...` —
**that model does not exist anywhere in either schema file** (verified by grep); this route is dead
code that throws at runtime. Fix it in place to operate on `prisma.mediaJob` instead (guard: only
QUEUED/RUNNING may be cancelled, set `cancelRequested: true`) rather than adding a second, parallel
cancel route — this is the URL the existing Generate-tab Stop button already calls, so fixing it also
repairs that pre-existing bug for free. Do not touch anything else about the Generate tab.

The TRANSCRIBE worker path must poll `cancelRequested` (a cheap `select` alongside each status poll is
fine, this polls every 750ms–2000ms already) and, on seeing it true: call
`client.deleteJob(auditorJobId)` (cancels the remote auditor-stt job; 202/204/404 all mean "gone," per
`AuditorSttClient.deleteJob`'s own contract) and set the local `MediaJob.status = "CANCELLED"`. Use
`AuditorSttClient` directly in the worker (submit + a manual status-poll loop), **not**
`AuditorSttTranscriptionProvider.transcribe()`— the provider's `waitForCompletion()` has no
cancellation hook and no way to persist `auditorJobId` mid-flight, both of which are required here.

## Resumability

`processJob()`'s claim loop (`worker/index.ts`) only ever looks at `QUEUED` jobs, so a `MediaJob` stuck
`RUNNING` after a worker restart is orphaned today — true already for ffmpeg jobs, not a regression.
Because `auditorJobId` is persisted into `parameters` before the first poll (see above), this is cheap
to close specifically for TRANSCRIBE: on `main()` startup, look for `RUNNING` TRANSCRIBE jobs with a
saved `auditorJobId` and resume polling them (the liturgos-auditor job itself is authoritative and
durable — see `docs/batch-jobs.md`'s resumability guarantees — so there's nothing to redo, only to
resume watching).

## Apply strategies

`POST /api/sources/:sourceId/transcription-runs/:runId/apply` body `{ strategy: "replace_overlap" |
"append" }`:
- `replace_overlap`: within one transaction, set `isActive = false` on every currently-active segment
  whose `[startSeconds, endSeconds)` overlaps the run's `[rangeStartSeconds, rangeEndSeconds)`, then
  set `isActive = true` on all of this run's segments. This is "redo this stretch, trust the new one."
- `append`: set `isActive = true` on this run's segments only. **Refuse with 409** if any of them would
  overlap an already-active segment (return the conflicting active segment ids) — overlap must always
  be an explicit `replace_overlap` choice, never silent.
- Either way, set the run's `status = APPLIED`, `appliedAt`, `appliedStrategy`.

`POST /api/sources/:sourceId/transcription-runs/:runId/discard` → `status = DISCARDED`, no segment
changes (segments stay `isActive: false`, kept for audit rather than deleted).

**Auto-apply rule:** when a run is created (job completes, or a .vtt finishes uploading), auto-apply it
immediately (`replace_overlap` against nothing, trivially) **only if the source currently has zero
active segments**. Otherwise leave it `PENDING` — always, even if its range doesn't overlap anything
active. This is deliberately conservative (an explicit Apply click every time after the first
transcription) per the product rule: never touch an existing transcript without the user asking.

## REST API

All under `src/app/api/...`, following the existing route-per-folder convention.

| Route | Purpose |
|---|---|
| `POST /api/projects/:id/source/:sourceId/transcription-jobs` | Body `{ language, rangeStartSeconds?, rangeEndSeconds? }` (omit both → full duration). If the source is a YouTube source with no `storagePath` yet, create a `DOWNLOAD` `MediaJob` first and chain via `dependsOnJobId` — same pattern as `generate/route.ts`. Creates a `TRANSCRIBE` `MediaJob`. Returns 202 `{ id, status, type, progress }` (same shape `generate` already returns). |
| `GET /api/projects/:id/jobs/:jobId` | **New** — generic job polling endpoint (nothing like this exists today; the UI currently only refreshes via a full project reload). Returns the `MediaJob` row: `{ id, type, status, progress, phase, etaSeconds, currentMs, totalMs, error }`. |
| `POST /api/projects/:id/jobs/:jobId/cancel` | Fixed in place (see "Cancellation"). Works for any `MediaJob`, including TRANSCRIBE. |
| `GET /api/sources/:sourceId/captions` | `{ active: TranscriptSegment[], pendingRuns: Array<{ id, origin, language, rangeStartSeconds, rangeEndSeconds, status, createdAt, error, segments: TranscriptSegment[] }> }`. `active` sorted by `startSeconds`. `pendingRuns` only ever contains `PENDING` runs. |
| `POST /api/sources/:sourceId/transcription-runs/:runId/apply` | See "Apply strategies". Returns `{ active: TranscriptSegment[] }` on success, 409 `{ error, conflicts: string[] }` on a blocked `append`. |
| `POST /api/sources/:sourceId/transcription-runs/:runId/discard` | 200, no body needed. |
| `POST /api/sources/:sourceId/transcription-runs/upload` | Multipart: `file` (.vtt), `language`, `rangeStartSeconds?`, `rangeEndSeconds?` (default full duration). Parses the VTT, creates a run with `origin: "UPLOAD"`, same auto-apply rule as service runs. Returns 201 the created run (same shape as a `pendingRuns` entry, or already-active if auto-applied). |
| `PATCH /api/transcript-segments/:id` | Body `{ text?, startSeconds?, endSeconds? }`. Only ever edits an active segment (404 if not `isActive`). Validates `endSeconds > startSeconds`. Returns the updated segment. This is what "save after focus changes" calls. |
| `POST /api/sources/:sourceId/transcript-segments` | Body `{ startSeconds, endSeconds, text }`. Inserts one new **active**, `runId: null` (MANUAL-origin) segment — "insert a new line". |
| `DELETE /api/transcript-segments/:id` | Removes one segment. |
| `GET /api/sources/:sourceId/captions.vtt` | `active` segments as a WebVTT file, `Content-Disposition: attachment; filename="<source name>.vtt"`. |
| `GET /api/sources/:sourceId/captions.srt` | Same, SRT format. |

### VTT format (import + export)

```
WEBVTT

00:00:01.000 --> 00:00:04.000
Text line one

00:00:04.500 --> 00:00:07.000
Text line two
```
`HH:MM:SS.mmm` (parser must also accept `MM:SS.mmm` with no hours, per spec). An optional cue
identifier line may precede the timestamp line on import — ignore it. Multi-line cue text: join with
`\n` into `TranscriptSegment.text` (the editor is a plain textarea, so newlines round-trip fine both
ways).

### SRT format (export only)

```
1
00:00:01,000 --> 00:00:04,000
Text line one

2
00:00:04,500 --> 00:00:07,000
Text line two
```
Comma decimal separator, sequential 1-based cue numbers, no header.

## Frontend notes (for the FE agent, backend can skip this section)

- Video source for scrubbing: `GET /api/sources/:sourceId` (`src/app/api/sources/[sourceId]/route.ts`)
  already supports byte-range requests (206) — use that as the `<video>` `src`, not the older
  `/api/projects/:id/source/:sourceId` route.
- The existing `SectionPicker` component (inline in `src/app/page.tsx`, ~line 86) already has the
  reference pattern for a source player with a `seek(seconds)` function, live `current` time via
  `onTimeUpdate`, and YouTube-vs-local branching. Build the transcription player the same way, but as
  its own component file (`src/components/TranscriptionEditor.tsx` or similar) — the Transcription
  panel is going to be too large to stay inline, matching how `CompositionEditor`/`SectionManager`
  already got pulled out of `page.tsx`.
- There is **no existing polling loop** for job progress anywhere in the app today — `Generate`'s
  progress only updates when `openProject()` is called again (e.g. after clicking something). A live
  progress bar/ETA for a TRANSCRIBE job needs its own `setInterval` polling `GET
  /api/projects/:id/jobs/:jobId` while status is QUEUED/RUNNING, cleared on unmount and on reaching a
  terminal status.
- `formatTime(seconds)` already exists as a module-level helper in `page.tsx` but isn't exported —
  either export it or duplicate the one-liner in the new component.
- `vitest run` cannot resolve `@/...` imports in this project — `vite-tsconfig-paths` isn't installed
  and there's no `vitest.config.ts` (pre-existing gap, unrelated to this feature). Either add
  `vite-tsconfig-paths` + a minimal `vitest.config.ts` as a small side-fix (it'll unblock every new
  test file you write, not just this feature's), or use relative imports in new test files.
