# SaarnaVideo Deployment Guide

## System Requirements

The host does **not** need FFmpeg, ffprobe, yt-dlp, or Python installed for the normal Docker deployment. Media-processing dependencies are contained in the dedicated worker image.

- **Docker / Docker Compose**
- **PostgreSQL** (provided by Compose in the development stack, or an external PostgreSQL 14+ instance)
- Sufficient persistent disk for `/data/media`

For host-based development without Docker, Node.js 18+ is required and the worker's media tools must be installed locally.

## Environment Variables

### Core Application
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/saarnavideo
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://saarnavideo.example.com
YOUTUBE_CLIENT_ID=your-client-id
YOUTUBE_CLIENT_SECRET=your-client-secret
```

### Media and Jobs
```bash
MEDIA_ROOT=/data/media
MEDIA_RETENTION_DAYS=7
MAX_SOURCE_SIZE_BYTES=53687091200
MAX_OUTPUT_SIZE_BYTES=107374182400
MAX_DURATION_SECONDS=43200
MAX_CONCURRENT_JOBS=2
REQUEST_TIMEOUT_SECONDS=3600
MAX_UPLOAD_BYTES=53687091200
WORKER_POLL_MS=3000
```

## Docker Deployment

The repository's `docker-compose.yml` builds three services: PostgreSQL, the web application, and the dedicated media worker. The worker is built from `Dockerfile.worker` and contains the complete media-processing toolchain:

- Node.js
- FFmpeg and ffprobe
- Python
- yt-dlp

The web application image deliberately does **not** install FFmpeg or yt-dlp. The worker handles both YouTube source downloads and media rendering. The persistent `GenerationJob` table in PostgreSQL is the queue; the worker container is its consumer/execution engine.

Build and start the complete stack:

```bash
docker compose up --build
```

No host FFmpeg/yt-dlp installation is required.

## Worker Image

`Dockerfile.worker` uses Debian's packaged FFmpeg rather than compiling FFmpeg from source. This keeps the image maintainable while making the complete media toolchain part of the image rather than a host dependency. A custom FFmpeg build can be introduced later if a specific codec or FFmpeg-version requirement warrants it.

The worker image build verifies:

```text
ffmpeg -version
ffprobe -version
yt-dlp --version
```

and performs a small functional FFmpeg encode test. A broken or incomplete media toolchain therefore fails the image build.

## Production Setup Checklist

### Database
- [ ] PostgreSQL running and accessible
- [ ] Database initialized with Prisma
- [ ] Regular backups configured
- [ ] Connection pool configured if needed

### Media Storage
- [ ] `/data/media` mounted on fast, high-capacity storage
- [ ] Automatic cleanup enabled (seven-day retention by default)
- [ ] Worker and app have access to the same media volume/storage

### Worker
- [ ] Dedicated worker container running
- [ ] Worker can reach PostgreSQL
- [ ] Worker can reach YouTube for source downloads
- [ ] Worker has access to `/data/media`
- [ ] No host FFmpeg/yt-dlp installation required
- [ ] Worker logs monitored for acquisition/rendering failures

### YouTube Integration
- [ ] OAuth credentials configured
- [ ] HTTPS enforced for OAuth callback
- [ ] Callback URL matches the registered YouTube OAuth configuration

### Application
- [ ] Application container running
- [ ] Prisma schema initialized
- [ ] Reverse proxy/TLS configured for production
- [ ] Health check configured

## Scaling

The worker is intentionally stateless apart from the shared media volume and PostgreSQL job state. Multiple identical worker containers can consume the same database-backed queue:

```text
                    PostgreSQL
                 GenerationJob queue
                    /    |    \
                   /     |     \
                  v      v      v
             worker-1 worker-2 worker-3
             FFmpeg   FFmpeg   FFmpeg
             yt-dlp   yt-dlp   yt-dlp
```

This allows rendering/download capacity to be increased without changing the application architecture.

## Troubleshooting

### Worker cannot process media

Inspect the worker container:

```bash
docker compose logs worker
```

Verify the bundled toolchain:

```bash
docker compose run --rm worker ffmpeg -version
docker compose run --rm worker ffprobe -version
docker compose run --rm worker yt-dlp --version
```

These commands test the container, not the host.

### Source Download Fails

Check the worker logs and verify that the container has outbound network access to YouTube. The download is performed by `yt-dlp` inside the worker image.

### Worker Hangs / High CPU

Inspect the worker container and FFmpeg processes:

```bash
docker compose logs worker
docker stats
```

Check disk space for the shared media volume and review the configured resource limits.

### Database Errors

Check PostgreSQL logs and verify the worker's `DATABASE_URL` points to the reachable PostgreSQL service.

## Maintenance

- Monitor media disk usage.
- Review worker errors.
- Update the worker image regularly to receive FFmpeg and yt-dlp updates.
- Rebuild the worker image after dependency updates.
- Periodically test the complete flow: create project → acquire source → render → thumbnail → optional publication.
