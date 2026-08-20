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

# Media retention (days)
MEDIA_RETENTION_DAYS=7

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
- [ ] Automatic cleanup jobs configured (7-day retention by default)
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
- Large files expire after 7 days, no need to backup
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
