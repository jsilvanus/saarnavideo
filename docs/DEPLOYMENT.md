# SaarnaVideo Deployment Guide

## System Requirements

- **Node.js**: 18+
- **PostgreSQL**: 14+
- **FFmpeg**: 5.0+ with libfdk_aac codec support
- **yt-dlp**: Latest version (for YouTube source download)
- **Python**: 3.9+ (for transcription worker)

## Environment Variables

### Core Application
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/saarnavideo

# API
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://saarnavideo.example.com

# YouTube OAuth (see YOUTUBE_OAUTH_SETUP.md)
YOUTUBE_CLIENT_ID=your-client-id
YOUTUBE_CLIENT_SECRET=your-client-secret
```

### Media and Jobs
```bash
# Media storage (should be on fast, high-capacity storage)
MEDIA_ROOT=/data/media

# Resource limits
MAX_SOURCE_SIZE_BYTES=53687091200          # 50 GB
MAX_OUTPUT_SIZE_BYTES=107374182400         # 100 GB
MAX_DURATION_SECONDS=43200                 # 12 hours
MAX_CONCURRENT_JOBS=2
REQUEST_TIMEOUT_SECONDS=3600               # 1 hour

# File upload size limit (API)
MAX_UPLOAD_BYTES=53687091200               # 50 GB

# Worker poll interval (ms)
WORKER_POLL_MS=3000
```

### Rendering on an fffleet fleet (Optional)
By default the worker runs ffmpeg itself. With `RENDER_EXECUTOR=fffleet` it sends VIDEO, PREVIEW, THUMBNAIL and PODCAST ffmpeg commands to an [fffleet](https://github.com/jsilvanus/fffleet) fleet instead. Transcription and the audio probe on upload still run where the worker runs; YouTube downloads can be moved separately (next section).

```bash
RENDER_EXECUTOR=fffleet
FFFLEET_URL=http://orchestrator:5000          # unset = render here, through the same S3 staging
FFFLEET_CLIENT_ID=saarnavideo                 # an app login, or FFFLEET_TOKEN for a static token
FFFLEET_CLIENT_SECRET=...
FFFLEET_S3_BUCKET=saarnavideo-render
FFFLEET_S3_ENDPOINT=https://hel1.your-objectstorage.com   # S3-compatible stores only
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The remote workers need no shared volume. For each render the worker uploads the files it reads to S3 (sources, assets, audio, the generated `.ass`/`.srt`, a template font), submits one batch job, and copies the output back to `MEDIA_ROOT`, so Output rows, downloads and publishing are unchanged. A file is uploaded once (keyed by path, size and modification time) and reused by later renders. Temporary caption files and the output copy in S3 are deleted after each job; sources and assets stay, so give the bucket a lifecycle rule if you want them to expire. Fleet workers should run with `FFFLEET_CACHE_DIR` so a source is downloaded to a worker once, not for every job, and the worker image must have `libass`, `drawtext` and `libmp3lame` (the published `fffleet-worker` image does).

### yt-dlp downloads on an fffleet worker (Optional)
`DOWNLOAD_EXECUTOR=fffleet` (default `local`) runs the YouTube download of a DOWNLOAD job on a fleet worker instead of in the SaarnaVideo worker. It uses the same `FFFLEET_*` and `AWS_*` settings as rendering (`RENDER_EXECUTOR` and `DOWNLOAD_EXECUTOR` are independent). The fleet workers must be able to run the `download` job type: build them from `Dockerfile.fleet-worker`, which adds python3, yt-dlp and `fleet/download-executor.mjs` to the published `ghcr.io/jsilvanus/fffleet-worker` image and sets `FFFLEET_EXECUTORS`.

```bash
docker build -f Dockerfile.fleet-worker -t saarnavideo-fleet-worker .
# app / worker host
DOWNLOAD_EXECUTOR=fffleet
YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt   # optional
```

The video goes through S3 and is copied to `MEDIA_ROOT/sources/...`, as renders do; everything staged for the job under `<FFFLEET_S3_PREFIX>/tmp/<jobId>/` is deleted afterwards. Without `FFFLEET_URL`, or when the fleet cannot be reached, the download runs in the SaarnaVideo worker through the same executor (yt-dlp must then be installed there; the stock `Dockerfile.worker` has it). Cookies for yt-dlp (local and fleet downloads alike) come from Settings > "YouTube cookies" (stored AES-256-GCM encrypted with `YOUTUBE_TOKEN_ENCRYPTION_KEY`, never returned to the browser); `YTDLP_COOKIES_FILE` is the fallback when nothing is stored. For a fleet job a short-lived copy is staged in S3, and cookies refreshed by yt-dlp are written back (to the database, or to the env file). Keep the bucket private; the cookie copy exists there only while the job runs. CI builds `Dockerfile.fleet-worker` and pushes `ghcr.io/<owner>/saarnavideo-fleet-worker` (`latest` and the commit sha) from main; use it for the workers that receive downloads. Not yet tested against a real fleet or real YouTube.

### Transcription (Optional)
```bash
# Python transcription worker
PYTHON_PATH=/usr/bin/python3
TRANSCRIPTION_MODEL=small                  # Options: tiny, small, base, medium, large
TRANSCRIPTION_DEVICE=cpu                   # Options: cpu, cuda, mps
```

## Docker Deployment

### 1. Build Docker Images

```bash
docker build -t saarnavideo:latest .
docker build -f transcription/Dockerfile -t saarnavideo-transcription:latest ./transcription
```

### 2. Docker Compose

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: saarnavideo
      POSTGRES_USER: saarnavideo
      POSTGRES_PASSWORD: your-secure-password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  app:
    image: saarnavideo:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://saarnavideo:your-secure-password@postgres:5432/saarnavideo
      MEDIA_ROOT: /media
      NEXT_PUBLIC_API_URL: https://saarnavideo.example.com
      YOUTUBE_CLIENT_ID: ${YOUTUBE_CLIENT_ID}
      YOUTUBE_CLIENT_SECRET: ${YOUTUBE_CLIENT_SECRET}
    volumes:
      - media_data:/media
      - ./fonts:/app/public/fonts:ro
    depends_on:
      - postgres
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: saarnavideo:latest
    command: npm run worker
    environment:
      DATABASE_URL: postgresql://saarnavideo:your-secure-password@postgres:5432/saarnavideo
      MEDIA_ROOT: /media
      WORKER_POLL_MS: 3000
    volumes:
      - media_data:/media
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
  media_data:
```

## Production Setup Checklist

### Database
- [ ] PostgreSQL running and accessible
- [ ] Database created with Prisma: `npx prisma db push`
- [ ] Regular backups configured
- [ ] Connection pool configured (pgBouncer recommended)

### Media Storage
- [ ] `/data/media` mounted on fast, high-capacity storage (NAS, SSD array, or cloud object storage)
- [ ] Disk has at least 500 GB available
- [ ] Disk monitoring or a manual cleanup routine in place (media is persistent; nothing expires)
- [ ] Filesystem permissions: app runs as dedicated user

### FFmpeg
- [ ] FFmpeg installed and in PATH
- [ ] libfdk_aac codec available: `ffmpeg -codecs | grep fdk`
- [ ] Verify: `ffmpeg -version`

### YouTube Integration
- [ ] OAuth credentials configured (see YOUTUBE_OAUTH_SETUP.md)
- [ ] HTTPS enforced (required for OAuth callback)
- [ ] Callback URL matches registered value: `https://saarnavideo.example.com/api/integrations/youtube/callback`

### SSL/TLS
- [ ] Valid certificate (LetsEncrypt recommended)
- [ ] Reverse proxy (Nginx) configured with HTTPS
- [ ] Redirect HTTP → HTTPS

### Application
- [ ] `npm install && npm run build`
- [ ] `npx prisma db push` to initialize schema
- [ ] App running on port 3000 (internal), reverse proxy on 443 (external)
- [ ] Health check: `curl https://saarnavideo.example.com`

### Worker Process
- [ ] Worker running in separate container/process
- [ ] Worker has access to media storage
- [ ] Worker can download from YouTube (yt-dlp configured)
- [ ] Monitor worker logs for errors

### Monitoring & Logging
- [ ] Logs aggregated (stdout → container engine or syslog)
- [ ] Database job logs accessible via API
- [ ] Disk space monitoring (cleanup happens automatically, but verify)
- [ ] FFmpeg process monitoring (check for hangs)

### Security
- [ ] Database password strong and rotated
- [ ] OAuth secret stored securely (not in code)
- [ ] File uploads validated (size, MIME type)
- [ ] API rate limiting configured
- [ ] CORS properly configured for front-end domains

## Scaling Considerations

### Single Machine
- Works well for small deployments (< 50 projects/day)
- Media storage on local fast disk
- One app instance, one worker process

### Multiple Machines
- PostgreSQL on dedicated database server
- App instances behind load balancer
- Worker processes on dedicated worker machines
- Media storage on NAS (NFS, SMB) or S3-compatible object storage

### Object Storage (S3)
- Update source/output storage to use S3 SDK
- Reduces local disk requirements
- Enables multi-region deployment
- Higher latency for thumbnail generation

## Backup Strategy

### Database
```bash
# Daily automated backup
0 2 * * * pg_dump postgresql://user:pwd@host/db | gzip > /backups/db-$(date +%Y%m%d).sql.gz

# Keep 30 days of backups
find /backups -name "db-*.sql.gz" -mtime +30 -delete
```

### Media (Optional)
- Media under `MEDIA_ROOT` is persistent and not recreated automatically: back up uploaded sources and the asset library if you cannot re-upload them
- Keep project metadata in database backups (includes URLs, IDs)
- Regenerate outputs from projects as needed

## Troubleshooting

### Worker Hangs / High CPU
- Check FFmpeg process: `ps aux | grep ffmpeg`
- Kill stuck process: `pkill -9 ffmpeg`
- Check disk space: `df -h /data/media`
- Verify resource limits in environment

### YouTube Upload Fails
- Check OAuth token expiry: `SELECT * FROM "YouTubeConnection" LIMIT 1`
- Verify API quota at https://console.cloud.google.com/
- Check callback URL matches registered value

### Source Download Fails
- Verify yt-dlp: `yt-dlp --version`
- Check YouTube video availability and region restrictions
- Verify network connectivity and proxy settings

### Database Errors
- Check PostgreSQL logs: `docker logs saarnavideo-postgres`
- Verify disk space: `docker exec postgres pg_stat_statements`
- Run `VACUUM ANALYZE` to optimize queries

## Maintenance

### Weekly
- Monitor disk usage
- Check error logs for patterns
- Verify backups completed

### Monthly
- Analyze database performance
- Review and update dependencies
- Test recovery procedures

### Quarterly
- Full system test (create project, render, publish)
- Update FFmpeg and yt-dlp to latest versions
- Review and update resource limits based on usage

## Support

- Check application logs: `docker logs saarnavideo-app`
- Check worker logs: `docker logs saarnavideo-worker`
- Database job logs: Query `JobLog` table via database
- GitHub Issues: https://github.com/jsilvanus/saarnavideo
