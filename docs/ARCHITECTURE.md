# Architecture

How SaarnaVideo is put together. For feature-by-feature behaviour see [CLAUDE.md](../CLAUDE.md); for wiring up fffleet, S3 and the other services see [INTEGRATIONS.md](INTEGRATIONS.md).

## The big picture

```text
                       browser
                          │  HTTPS (optional ACCESS_SECRET login)
                          ▼
                ┌───────────────────┐         ┌──────────────────────────┐
                │  Next.js app      │         │  Database                │
                │  pages + /api     │────────▶│  SQLite or PostgreSQL    │
                └─────────┬─────────┘  Prisma │  projects, sources, jobs, │
                          │                   │  outputs, assets, ...    │
                          │                   └────────────┬─────────────┘
                          │ files                          │ the job queue is a table:
                          ▼                                │ the worker polls and claims
                ┌───────────────────┐                      ▼
                │  Media store      │◀────────┌──────────────────────────┐
                │  folder or S3     │  files  │  Worker (npm run worker) │
                └───────────────────┘         │  claims MediaJob rows    │
                                              └───┬──────┬──────┬────────┘
                                                  │      │      │
                       ffmpeg (local or fffleet)──┘      │      └── YouTube / Facebook upload
                       yt-dlp (local or fffleet)         └── speech-to-text service (polled)
```

- The **app** never renders. It validates requests, stores projects and files, and writes `MediaJob` rows.
- The **worker** owns all media work. App and worker share only the database and the media store; they never call each other, so the worker needs no access secret and several workers can run at once.
- The **database is the queue.** There is no message broker. A job is a row; the worker claims it atomically, writes progress into it and records logs.
- **ffmpeg, yt-dlp and speech-to-text can run elsewhere** (an fffleet worker, an auditor service) without changing the model: the worker still claims the job and records the result.

## Data model (Prisma)

Two schemas are kept in sync by hand: `prisma/schema.prisma` (SQLite, development) and `prisma/schema.postgresql.prisma` (production). CI pushes the PostgreSQL one.

```text
Project ──┬─ Source            uploaded file or YouTube reference
          ├─ MediaJob ─┬─ JobLog
          │            └─ TranscriptionRun ─ TranscriptSegment
          ├─ Output            video, thumbnail, SRT/VTT, podcast audio
          ├─ Publication       YouTube or Facebook upload
          └─ Asset (n:m)       library item linked to the project
Asset ─ AssetFolder            library tree (organisation only)
UserTemplate                   a saved project structure
ApiConnector ─ ApiRequest      global connectors for fetched variables
YouTubeConnection, YtDlpCookies  encrypted credentials (singletons)
```

The composition itself is **one JSON document**, `Project.definition`, validated by Zod (`src/domain/project.ts`): template settings (size, fps, reframe), sections and segments, a timeline of items (source clips, slates, overlays, audio clips), graphics, variables, podcast settings. Rendering reads that document; nothing else describes a video. A template only seeds the document and is not referenced afterwards.

`MediaJob.type` is one of `DOWNLOAD`, `THUMBNAIL`, `PREVIEW`, `VIDEO`, `PODCAST`, `TRANSCRIBE`. Status goes `QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`; while running, `phase` and `progress` say where it is. `dependsOnJobId` chains jobs (a download before a render).

## Request flow: from recording to published video

1. **Source.** A file is streamed into the media store, or a YouTube link creates a `Source` and a `DOWNLOAD` job. The worker downloads with yt-dlp (locally or on a fleet worker, with the stored cookies if any) and records the file.
2. **Transcription (optional).** A `TRANSCRIBE` job hands the audio to the speech-to-text service, polls it, and stores the result as a pending `TranscriptionRun`; the user applies it and the segments become the active transcript.
3. **Editing.** The browser edits `definition` through `PATCH /api/projects/[id]`. Server-side validation (`validateRenderSettings`) rejects odd sizes, invalid reframes and bad variable names.
4. **Generate.** `POST /api/projects/[id]/generate` links the library assets the definition uses, checks the options, returns warnings (duration, unresolved asset references) and queues a `VIDEO` (or `PREVIEW`, `PODCAST`) job plus a thumbnail job.
5. **Render.** The worker builds a render plan from the definition (`src/renderer`), prepares captions (soft SRT/VTT or a burned-in ASS file), runs ffmpeg and reports progress from its output, then stores the `Output` rows.
6. **Publish.** `POST /api/projects/[id]/publish` queues a `Publication`; the worker's publication lane uploads video, thumbnail and captions to YouTube or Facebook.

## The renderer

Pure code, no I/O: it turns a definition into ffmpeg arguments, so it is testable with mocked output and with real ffmpeg in the e2e suite.

- `src/domain/timeline.ts` (`layoutTimeline`) is the single layout of the timeline (crossfades pull the next item back, standalone slates and audio clips take time, overlays take none). The video plan, the podcast plan and the caption alignment all use it, so they cannot drift apart.
- `src/renderer/composition.ts` (`buildCompositionRenderPlan`) builds the filter graph: source clips (reframed and normalised to one frame rate and pixel format), slates, overlays and graphics (variables filled in, positions scaled from the 1920×1080 design canvas to the output size), audio clips and mixes, and burned captions as the last overlay step.
- `src/renderer/podcast.ts` builds the audio-only plan (body once to a temporary WAV, then loudness normalisation and intro/outro).
- `src/renderer/ass.ts`, `caption-wrap.ts`, `caption-timeline.ts` lay transcript cues onto the output timeline and write ASS for libass.

## Worker internals

`src/worker/index.ts` (`main`):

- **Lanes.** Up to `MAX_CONCURRENT_JOBS` media jobs run side by side (1 locally, 4 with a fleet). Publications run in their own lane so a slow upload does not block renders.
- **Claiming.** Atomic update of a `QUEUED` row; jobs with an unfinished dependency are skipped.
- **Heartbeat and recovery.** Each worker has a `workerId` and refreshes `heartbeatAt` on its running jobs. `job-recovery.ts` fails jobs whose worker stopped, and lets another worker take over an interrupted transcription.
- **Files.** `media-io.ts` gives each job a `JobFiles`: local references are used as they are, S3 references are downloaded into a size-capped cache, and outputs written to a scratch folder are uploaded when the job finishes.
- **Executors.** ffmpeg and yt-dlp go through a local process or through `remote-ffmpeg.ts` / `remote-download.ts` (fffleet). Cancellation is polled from the database and stops the process or the fleet job.
- **Soft failures.** Thumbnails and captions after a successful upload, caption tracks without transcript, and unresolved asset references are WARN logs, never failures of the main job.

## Storage

`src/lib/media-store/` hides where bytes live. A `storagePath` is either an absolute local path (all older rows) or `s3://bucket/key`; the store picks the backend per reference and writes to `MEDIA_STORAGE`. Library assets are content-addressed (`assets/library/<sha256>.<ext>`) so identical uploads are stored once. Nothing expires: files go only when a project, source or asset is deleted explicitly. (The `expiresAt` columns and the seven-day retention in `plan.md` are legacy and unused.)

## Security model

- **Access:** optional shared secret (`ACCESS_SECRET`) enforced by the Edge middleware for every page and API route; see [INSTALL.md](INSTALL.md#access-secret-login). No per-user accounts.
- **Secrets at rest:** YouTube tokens and yt-dlp cookies are AES-256-GCM encrypted with `YOUTUBE_TOKEN_ENCRYPTION_KEY`. The Facebook Page token is environment-only. API connector secrets are stored in the database and never returned by the API (only `hasSecret`); they are **not encrypted at rest yet**.
- **Outbound requests:** connector calls go through varfetch's address guard (private and loopback blocked unless allowed by `CONNECTOR_ALLOW`), with DNS pinning.
- **Uploads:** size limits and MIME checks per route; images are validated for type and dimensions.

## Source map

```text
src/app/                  Next.js pages (/, /assets, /settings, /login) and API routes (/api/...)
  api/_lib/               shared route helpers (files, assets, transcript, connectors)
src/middleware.ts         access gate (Edge)
src/components/           React UI; workspace/ holds the project page (steps Pikajulkaisu, Lähde, Rakenne, Julkaisu)
src/domain/               Zod schemas and pure business logic (project, templates, graphics, captions, reframe, ...)
src/renderer/             definition → ffmpeg plans, captions, podcast
src/worker/               the worker: loop, jobs, remote ffmpeg/yt-dlp, publishing, recovery
src/integrations/         YouTube, Facebook, speech-to-text client, audio/image assets, cookies
src/lib/                  media store, prisma client, asset linking, access gate, duration report, transcript text
src/i18n/                 fi / en / sv messages
fleet/                    the fffleet `download` executor (plain ESM)
prisma/                   both schemas (+ legacy migrations)
scripts/                  media-migrate (move files between local and S3)
e2e/                      end-to-end tests with real ffmpeg, fake S3, fake Google and Graph servers
transcription/            the older local Python transcription fallback
docs/                     these documents
```

## Testing layers

- **Unit** (`npm test`, Vitest): domain, renderer plans (mocked ffmpeg arguments), worker logic, media store with a fake S3 server, access gate, i18n key parity. Some tests need the database (`npx prisma db push`).
- **End to end** (`npm run test:e2e`): starts `next dev` and the worker, generates fixtures with ffmpeg and checks results by pixels, ffprobe, loudness and tags. `E2E_STORAGE=s3` runs the suite against a fake bucket. Fake servers stand in for Google, the Graph API and S3.
- **Not covered anywhere:** real fleet, real S3, real Google/Facebook, real speech-to-text container, PostgreSQL in the e2e suite.
