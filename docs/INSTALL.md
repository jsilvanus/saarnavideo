# Installing SaarnaVideo

Three ways to run it, from simplest to most complete:

1. [Development on one machine](#1-development-on-one-machine) (SQLite, no containers)
2. [Docker Compose](#2-docker-compose) (PostgreSQL, app, worker and speech-to-text in containers)
3. [Production](#3-production) (what to add: HTTPS, access secret, backups, optional S3 and render fleet)

Every setting is an environment variable; the full list is in [Environment reference](#environment-reference). `.env.example` is the template.

## What runs

| Part | What it is | Needs |
|---|---|---|
| **App** | Next.js web UI and HTTP API (`npm run dev` / `npm start`) | Node.js 22+, the database |
| **Worker** | Takes queued jobs from the database: downloads, renders, thumbnails, podcasts, transcriptions, publishing (`npm run worker`) | The database, the media store, FFmpeg + ffprobe (+ yt-dlp for YouTube sources) unless rendering and downloading are sent to an fffleet fleet |
| **Database** | SQLite (development) or PostgreSQL 17+ (production). It is also the job queue | |
| **Media store** | Where sources, outputs and the asset library live: a folder (`MEDIA_ROOT`) or an S3 bucket | |
| **Speech-to-text** (optional) | The [liturgos-auditor](https://github.com/jsilvanus/liturgos-auditor) service, for transcriptions and captions | |
| **fffleet** (optional) | A pool of render workers, see [INTEGRATIONS.md](INTEGRATIONS.md) | |

App and worker never talk to each other over HTTP: they share the database and the media store. So the worker needs no access secret, and several workers can run side by side.

## 1. Development on one machine

Requirements: Node.js 22 or newer, FFmpeg and ffprobe (with `libass` and a default font), and yt-dlp if you want YouTube links.

```bash
git clone https://github.com/jsilvanus/saarnavideo.git
cd saarnavideo
npm install
cp .env.example .env
npx prisma db push          # creates ./prisma/dev.db (SQLite) from prisma/schema.prisma
npm run dev                 # http://localhost:3000
```

In a second terminal (the worker does not read `.env` itself, so load it into the shell first; Next.js reads it for the app):

```bash
set -a; . ./.env; set +a
npm run worker
```

Open http://localhost:3000, create a project, add a source and render a preview. Without the worker running, jobs stay queued.

Check the tools the worker needs: `ffmpeg -version`, `ffprobe -version`, `ffmpeg -hide_banner -filters | grep ' ass '` (burned captions), `yt-dlp --version`.

Tests: `npm test` (after `npx prisma db push`), `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e` (needs ffmpeg; starts its own server and worker).

## 2. Docker Compose

`docker-compose.yml` starts PostgreSQL 17, the app (port 3000), the worker (FFmpeg, yt-dlp, fonts included) and the speech-to-text service (port 8090). Media lives in the `media_data` volume.

```bash
cp .env.example .env     # compose reads YOUTUBE_*, FACEBOOK_*, ACCESS_SECRET, AUDITOR_STT_* from it
docker compose up --build -d postgres
docker compose run --rm app npx prisma db push --schema prisma/schema.postgresql.prisma
docker compose up --build -d
```

The `db push` step creates the tables; do it once, and again after upgrading to a version that changes `prisma/schema.postgresql.prisma`. Then open http://localhost:3000.

Notes:

- The images are built for PostgreSQL (`prisma generate --schema prisma/schema.postgresql.prisma`). Do not point them at a SQLite file.
- The speech-to-text model downloads on first start into the `auditor_stt_models` volume; the first transcription may wait for it. `AUDITOR_STT_MODEL` picks the size (`tiny`, `base`, `small`, ...).
- Change the PostgreSQL password in `docker-compose.yml` before exposing anything.
- `docker compose up` was not re-run when this guide was written; if a step fails, check `docker compose logs app worker`.

## 3. Production

A checklist beyond the compose file. [DEPLOYMENT.md](DEPLOYMENT.md) has the longer version (scaling, backups, troubleshooting).

1. **PostgreSQL**, with a strong password and backups. Set `DATABASE_URL` on the app and on every worker.
2. **HTTPS.** Put a reverse proxy (Traefik, nginx, Caddy) in front of the app. The access cookie is marked `Secure` when the request arrives over HTTPS (it reads `x-forwarded-proto`).
3. **Access secret.** The app has no user accounts. Set `ACCESS_SECRET` (see below) or put your own authentication in front.
4. **Token encryption key.** Set `YOUTUBE_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) on the app and the worker; it encrypts the stored YouTube tokens and the yt-dlp cookies. Keep it stable: changing it invalidates what is stored.
5. **Media.** Either a shared volume mounted at the same `MEDIA_ROOT` on app and workers, or S3 (`MEDIA_STORAGE=s3`, see [INTEGRATIONS.md](INTEGRATIONS.md#media-in-s3)). Media is never deleted automatically; plan disk space or a bucket policy.
6. **Publishing** (optional): [YOUTUBE_OAUTH_SETUP.md](YOUTUBE_OAUTH_SETUP.md), [FACEBOOK_SETUP.md](FACEBOOK_SETUP.md).
7. **Rendering on a fleet** (optional): [INTEGRATIONS.md](INTEGRATIONS.md#fffleet-render-and-download-on-workers).
8. **Upgrades:** pull, `npm install`, `npx prisma db push --schema prisma/schema.postgresql.prisma`, restart app and worker. Queued jobs wait in the database.

### Access secret (login)

Set one long random string on the **app**:

```bash
ACCESS_SECRET="$(openssl rand -base64 32)"
```

Every page and `/api/*` call then needs it. Browsers are sent to `/login` once and keep a 30-day cookie; scripts send `x-access-secret: <secret>` or `Authorization: Bearer <secret>`. Changing the secret signs everybody out. It is one shared password, not per-person accounts. Unset = no gate, which is fine on your own laptop and nowhere else.

## Environment reference

Defaults are what the code uses when the variable is unset. "App" and "worker" say where it is read; where both are listed, give both the same value.

### Core

| Variable | Default | Where | Meaning |
|---|---|---|---|
| `DATABASE_URL` | `file:./dev.db` (dev) | app, worker | SQLite file or `postgresql://user:pass@host:5432/db` |
| `NODE_ENV` | | app, worker | `production` for deployments |
| `ACCESS_SECRET` | unset (no gate) | app | Shared-secret login, see above |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | | app, worker | 32-byte hex key; encrypts YouTube tokens and stored yt-dlp cookies |
| `CONNECTOR_ALLOW` / `CONNECTOR_DENY` | | app | Hosts the API connectors (Settings) may or may not call. Private and loopback addresses are blocked unless allowed; deny wins |

### Media and limits

| Variable | Default | Where | Meaning |
|---|---|---|---|
| `MEDIA_ROOT` | `/data/media` (`.env.example` sets `./data/media`) | app, worker | Folder for media; with S3 only scratch space on the worker |
| `MEDIA_STORAGE` | `local` | app, worker | `local` or `s3` |
| `MEDIA_S3_BUCKET`, `MEDIA_S3_PREFIX`, `MEDIA_S3_ENDPOINT` | | app, worker | Bucket, key prefix, endpoint for S3-compatible stores |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | | app, worker | S3 credentials (also used for fleet staging) |
| `MEDIA_CACHE_MAX_BYTES` | 20 GB | worker | Size of the worker's cache of downloaded S3 files |
| `MAX_SOURCE_SIZE_BYTES` | 50 GB | worker | Largest source |
| `MAX_OUTPUT_SIZE_BYTES` | 100 GB | worker | Largest output |
| `MAX_UPLOAD_BYTES` | 5 GB (`.env.example` sets 50 GB) | app | Largest upload |
| `MAX_ASSET_SIZE_BYTES` | 10 MB | app | Largest library image |
| `MAX_AUDIO_ASSET_SIZE_BYTES` | 200 MB | app | Largest library audio file |
| `MAX_DURATION_SECONDS` | 43200 (12 h) | worker | Longest source |

### Worker

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_POLL_MS` | 750 | How often the worker looks for queued jobs |
| `MAX_CONCURRENT_JOBS` | 1 (4 when `RENDER_EXECUTOR=fffleet`) | Jobs run side by side. Publications always have their own lane |
| `REQUEST_TIMEOUT_SECONDS` | 3600 | Part of the worker's resource limits |
| `FFMPEG_PATH`, `YTDLP_PATH` | `ffmpeg`, `yt-dlp` | Binaries |

### Rendering and downloads on a fleet

See [INTEGRATIONS.md](INTEGRATIONS.md#fffleet-render-and-download-on-workers).

| Variable | Default | Meaning |
|---|---|---|
| `RENDER_EXECUTOR` | `local` | `fffleet` sends ffmpeg commands to the fleet |
| `DOWNLOAD_EXECUTOR` | `local` | `fffleet` sends yt-dlp runs to the fleet |
| `FFFLEET_URL` | | The orchestrator. Unset = run the same jobs in-process on the worker host |
| `FFFLEET_CLIENT_ID`, `FFFLEET_CLIENT_SECRET` | | App login created with `fffleet-orchestrator add-client` |
| `FFFLEET_TOKEN` | | A ready-made token instead of the login |
| `FFFLEET_S3_BUCKET`, `FFFLEET_S3_PREFIX` | `saarnavideo` (prefix) | Staging bucket for files the fleet reads and writes |
| `FFFLEET_S3_ENDPOINT` | | Endpoint for S3-compatible stores |
| `FFFLEET_CACHE_DIR`, `FFFLEET_CACHE_MAX_SIZE` | | In-process fallback only: keep staged inputs between jobs |
| `YTDLP_COOKIES_FILE` | | Fallback Netscape cookie file, used when no cookies are stored in Settings |

### Transcription

| Variable | Default | Meaning |
|---|---|---|
| `AUDITOR_STT_URL` | `http://localhost:8090` | The speech-to-text service |
| `AUDITOR_STT_API_KEY` | | Sent as a bearer token if the service has one |
| `AUDITOR_STT_FETCH` | `upload` | `upload`, `s3` (stage audio, send a presigned URL) or `s3-source` (stage the original, let the service strip audio on a fleet worker) |
| `AUDITOR_STT_MODEL` | `base` | Compose only: Whisper model the service loads |
| `PYTHON_PATH`, `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_DEVICE` | `python`, `small`, `cpu` | The older local Python fallback in `transcription/` |

### Publishing

| Variable | Meaning |
|---|---|
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` | Google OAuth; the redirect must be `<your address>/api/integrations/youtube/callback` and match Google Cloud exactly |
| `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` | One Facebook Page (app and worker). The token is only read from the environment |
| `FACEBOOK_GRAPH_VERSION` | Default `v24.0` |
| `FACEBOOK_GRAPH_BASE_URL`, `FACEBOOK_STATUS_POLL_MS`, `FACEBOOK_PROCESSING_TIMEOUT_MS` | Tests, proxies and tuning |
| `YOUTUBE_API_BASE_URL`, `YOUTUBE_OAUTH_TOKEN_URL` | Test-only overrides; leave unset |

## First run checklist

1. Open the app (and sign in if `ACCESS_SECRET` is set).
2. **Settings** (top right): add an API connector if you want church-year data; paste YouTube cookies if downloads are blocked.
3. Create a project from a template, add a source, add sections, queue a **preview**.
4. Watch the job in the project (progress and phase); if it stays `QUEUED`, the worker is not running or cannot reach the database.
5. Download the preview. Then try captions (needs the speech-to-text service) and publishing.
