# SaarnaVideo

SaarnaVideo is a focused media composition tool for turning worship-service recordings into publishable videos with minimal manual editing.

## Current implementation

- Next.js + TypeScript web application
- Prisma project/media lifecycle model
- local source upload and YouTube URL source references
- Google/YouTube OAuth connection with encrypted token-at-rest storage
- database-backed media worker with DOWNLOAD / THUMBNAIL / PREVIEW / VIDEO jobs
- self-contained Docker worker containing FFmpeg, ffprobe and yt-dlp
- live persisted media-job progress
- FFmpeg source-range rendering and separated-clip concatenation
- downloadable generated outputs
- queued YouTube publication, private by default, including generated thumbnail upload
- Docker Compose development environment
- Vitest renderer tests

Transcription, assisted timestamping, and the complete reusable template system remain planned work described in `docs/technical-phase-plan.md`.

## Development

Requirements:

- Node.js 22+
- PostgreSQL 17+ (or Docker)
- Docker for the containerized media worker

Install dependencies and initialize Prisma:

```bash
npm install
npx prisma generate
npx prisma db push
```

Run the web application:

```bash
npm run dev
```

Run the worker separately:

```bash
npm run worker
```

Run tests:

```bash
npm test
```

For the complete containerized stack:

```bash
docker compose up --build
```

### YouTube setup

Create OAuth credentials in Google Cloud with the YouTube Data API enabled. Configure `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` in `.env`. Also set `YOUTUBE_TOKEN_ENCRYPTION_KEY` to a stable 32-byte hex key (for example, `openssl rand -hex 32`).

The application exposes **Connect YouTube** in the UI. After OAuth, the connection is retained using an encrypted access/refresh token pair. Generated videos can then be queued for YouTube publication; the default privacy state is **private**.

The OAuth callback is:

```text
/api/integrations/youtube/callback
```

The redirect URI configured in Google Cloud must match `YOUTUBE_REDIRECT_URI` exactly.

## Architecture

```text
Project -> Source -> Composition -> MediaJob -> Output -> optional Publication
                                      |
                                 media worker
                              yt-dlp + FFmpeg
```

PostgreSQL is the persistent job queue. The application creates media jobs and the worker polls/claims them. The worker container owns all media-processing dependencies, so the host does not need FFmpeg or yt-dlp installed.

Large source and output media is temporary by design; the default retention period is seven days.

See:

- `docs/plan.md` for the product and architecture plan.
- `docs/technical-phase-plan.md` for the implementation phases.
