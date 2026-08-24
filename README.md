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
- dedicated self-contained Docker media worker with FFmpeg, ffprobe, Python, and yt-dlp
- FFmpeg source-range rendering and separated-clip concatenation
- downloadable generated outputs
- Docker Compose development environment
- Vitest renderer tests

The web application does not need FFmpeg or yt-dlp installed in its container or on the host. Media acquisition and rendering run in the dedicated `worker` container. The worker image verifies its complete media toolchain during the image build.

YouTube OAuth/download, transcription, rich slate/overlay rendering, and the complete template system are the next implementation steps described in `docs/technical-phase-plan.md`.

## Development

For the normal Docker workflow, the host only needs Docker/Compose. FFmpeg, ffprobe, yt-dlp, and Python are provided by the worker image.

Start the complete stack:

```bash
docker compose up --build
```

The worker polls the database-backed `GenerationJob` queue, claims queued work, acquires any required sources with `yt-dlp`, renders with FFmpeg, creates outputs/thumbnails, and updates job state. The same worker image handles both YouTube acquisition and rendering.

For host-based development without Docker, Node.js 22+ and PostgreSQL 17+ are required; running the worker directly on the host also requires its media-processing dependencies.

Run tests:

```bash
npm test
```

## Architecture

```text
                    PostgreSQL
                GenerationJob queue
                        |
                        v
                 dedicated worker
              +--------------------+
              | Node.js            |
              | yt-dlp             |
              | FFmpeg / ffprobe   |
              | media processing   |
              +---------+----------+
                        |
                   /data/media
                        |
                        v
                    Outputs
```

The worker is stateless apart from PostgreSQL job state and the shared media volume, so multiple identical workers can consume the queue later.

Large source and output media is temporary by design; the default retention period is seven days.

See:

- `docs/plan.md` for the product and architecture plan.
- `docs/technical-phase-plan.md` for the five implementation phases.
- `docs/DEPLOYMENT.md` for Docker deployment and worker requirements.
