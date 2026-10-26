# Docker Build Guide

This guide covers building and using Docker images for saarnavideo locally, and troubleshooting registry access issues.

## Local Building

If you encounter rate limiting or access issues with docker.io (Docker Hub), you can build the images locally:

### Build Commands

```bash
# Build the main application image
docker build -f Dockerfile -t saarnavideo:local .

# Build the worker image (includes ffmpeg, yt-dlp, fonts)
docker build -f Dockerfile.worker -t saarnavideo-worker:local .
```

### Tag for Local Use

After building locally, tag the images for use in compose files:

```bash
docker tag saarnavideo:local ghcr.io/jsilvanus/saarnavideo:latest
docker tag saarnavideo-worker:local ghcr.io/jsilvanus/saarnavideo-worker:latest
```

## Using Locally-Built Images

Modify your docker-compose configuration to use the locally-built images:

```yaml
saarnavideo:
  image: ghcr.io/jsilvanus/saarnavideo:latest  # Will use local image if not in registry
  # ... rest of config

saarnavideo-worker:
  image: ghcr.io/jsilvanus/saarnavideo-worker:latest  # Will use local image if not in registry
  # ... rest of config
```

Or use the local tags directly:

```yaml
saarnavideo:
  image: saarnavideo:local
  # ... rest of config

saarnavideo-worker:
  image: saarnavideo-worker:local
  # ... rest of config
```

## Base Image Information

- **Main Application (Dockerfile)**: Uses `node:22-bookworm-slim` as base
  - Includes: Node.js 22, openssl, curl
  - Used for the Next.js web application and API
  
- **Worker (Dockerfile.worker)**: Uses `node:22-bookworm-slim` as base
  - Adds: ffmpeg, fontconfig, fonts-dejavu-core, openssl, python3, python3-pip, yt-dlp
  - Used for video rendering and download jobs

## Troubleshooting docker.io Access

If you see errors like:
- `Error response from daemon: pull access denied for library/node`
- Rate limit exceeded errors from Docker Hub
- Timeout when pulling images

### Solution 1: Build Locally (Recommended)

Use the local build commands above. This avoids docker.io entirely and works offline (except for npm dependencies).

### Solution 2: Use Authentication

If you have a Docker Hub account:

```bash
docker login
docker pull node:22-bookworm-slim
```

This provides higher rate limits (200 pulls/hour vs 100 for unauthenticated).

### Solution 3: Configure Docker Daemon

Edit `~/.docker/config.json` or Docker Desktop settings to add registry mirrors or configure authentication.

## CI/CD Publishing

The publish workflow (`.github/workflows/publish-images.yml`) builds and pushes to GitHub Container Registry (ghcr.io), not Docker Hub. The base image is still pulled from docker.io.

For environments with restricted docker.io access:
1. Pre-download the base image and push to a private registry
2. Use the locally-built images in the deployment stack
3. Configure the CI workflow to use an alternative registry for the base image
