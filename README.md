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
- FFmpeg source-range rendering and separated-clip concatenation
- downloadable generated outputs
- Docker Compose development environment
- Vitest renderer tests

YouTube OAuth/download, transcription, rich slate/overlay rendering, and the complete template system are the next implementation steps described in `docs/technical-phase-plan.md`.

## Development

Requirements:

- Node.js 22+
- PostgreSQL 17+ (or Docker)
- FFmpeg for local rendering

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

## Architecture

```text
Project -> Source -> Composition -> GenerationJob -> Output -> optional Publication
                         |
                    Template/theme
```

Large source and output media is temporary by design; the default retention period is seven days.

See:

- `docs/plan.md` for the product and architecture plan.
- `docs/technical-phase-plan.md` for the five implementation phases.
