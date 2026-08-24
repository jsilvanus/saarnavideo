# SaarnaVideo

SaarnaVideo is a focused media composition tool for turning worship-service recordings into publishable videos with minimal manual editing.

## Current implementation

The repository now contains the initial application foundation:

- Next.js + TypeScript web application
- PostgreSQL + Prisma project/media lifecycle model
- declarative Project / Source / Composition / GenerationJob / Output / Publication domain
- local source upload API
- YouTube source reference model
- database-backed generation worker
- dedicated Docker worker image with FFmpeg and yt-dlp
- FFmpeg source-range rendering and separated-clip concatenation
- downloadable generated outputs
- Docker Compose development environment
- Vitest renderer tests

The web application no longer needs FFmpeg or yt-dlp installed in its container. Media acquisition and rendering run in the dedicated `worker` container, which is built from `Dockerfile.worker` and verifies both `ffmpeg` and `yt-dlp` during the image build.

YouTube OAuth/download, transcription, rich slate/overlay rendering, and the complete template system are the next implementation steps described in `docs/technical-phase-plan.md`.

## Development

Requirements:

- Node.js 22+
- PostgreSQL 17+ (or Docker)
- FFmpeg for local rendering when running the worker directly on the host

Start PostgreSQL with:

```bash
docker compose up postgres
```

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

Run the worker separately on the host:

```bash
npm run worker
```

For the complete containerized stack, including the dedicated FFmpeg worker:

```bash
docker compose up --build
```

The worker polls the database-backed `GenerationJob` queue, claims queued work, acquires any required sources, renders with FFmpeg, creates outputs/thumbnails, and updates job state. The same worker image also contains `yt-dlp` for YouTube source acquisition.

Run tests:

```bash
npm test
```

## Architecture

```text
Project -> Source -> Composition -> GenerationJob -> Output -> optional Publication
                         |                  |
                    Template/theme      dedicated worker
                                       (FFmpeg + yt-dlp)
```

Large source and output media is temporary by design; the default retention period is seven days.

See:

- `docs/plan.md` for the product and architecture plan.
- `docs/technical-phase-plan.md` for the five implementation phases.
