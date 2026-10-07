# Deployment Notes: Presigned S3 URLs with Hostname Replacement

## Status: ✅ BROWSER ACCESS FIXED

The presigned S3 URL upload flow now includes automatic hostname replacement, allowing browsers to access S3 via public endpoint (localhost:9000) instead of internal Docker container hostname (s3:9000).

### Verified Working:
- ✅ Presigned URL endpoint (`POST /api/projects/[id]/source/presigned-url`)
- ✅ Hostname replacement: Internal S3 URLs converted to localhost for browser access
- ✅ Direct S3 file upload via presigned URL (`PUT` to S3)
- ✅ Upload finalization (`POST /api/projects/[id]/source/[sourceId]/finalize`)
- ✅ End-to-end upload flow (build time ~3m 30s)
- ✅ Service deployed to http://localhost:3002

### Recently Fixed:
- ✅ Frontend field names in presigned URL requests (`sizeBytes` instead of `fileSizeBytes`, added `contentType`)
- ✅ Presigned URL hostname replacement (internal Docker `s3:9000` → public `localhost:9000`)

## What Changed

The presigned S3 URLs now work correctly for browser-based uploads by:

1. **Fixed Frontend Field Names** (Commit `a530430`)
   - Changed `fileSizeBytes` → `sizeBytes`
   - Added `contentType` field to presigned URL requests
   - Both `addUploads()` and `uploadPendingSource()` functions updated

2. **Presigned URL Hostname Replacement** (Commit `2ed717f`)
   - S3 client generates URLs with internal Docker hostname: `http://saarnavideo-media.s3:9000/...`
   - Browser cannot reach internal Docker container names
   - Solution: Replace internal hostname with public endpoint in `generatePresignedUploadUrl()`
   - Handles both path-style and virtual-hosted-style S3 URLs

3. **Environment Variable Configuration** (Commit `a9040fa`)
   - Added `MEDIA_S3_ENDPOINT_PUBLIC` to `compose.yml`
   - Defaults to `S3_ENDPOINT` if not specified (backward compatible)
   - Set to `http://localhost:9000` in deploy-media `.env` for local development

### Upload Flow (3 steps)
1. **Request presigned URL**: `POST /api/projects/[id]/source/presigned-url`
   - Request: `{ fileName, contentType, sizeBytes }`
   - Response: `{ uploadUrl, sourceId, s3Key, projectId }`
   - Note: `uploadUrl` hostname is automatically replaced to use `MEDIA_S3_ENDPOINT_PUBLIC`
   
2. **Upload to S3**: `PUT {uploadUrl}`
   - File is uploaded directly to S3 (bypasses Node.js)
   - No body size limits
   - Browser connects to `http://localhost:9000` (public endpoint)
   
3. **Finalize upload**: `POST /api/projects/[id]/source/[sourceId]/finalize`
   - Updates source status from PENDING to AVAILABLE

## Testing Locally

### Prerequisites
The build takes approximately **3 minutes 30 seconds**. Plan accordingly.

### Using deploy-media stack (recommended for testing):
```bash
cd D:\deploy-media

# First time setup (create local image):
cd C:\Users\jsilv\Code\saarnavideo
docker build -t saarnavideo:local .

# Then start deploy-media with local image:
cd D:\deploy-media
docker compose -f compose.yml -f compose.local.yml -f compose.dev.yml up -d

# Access at http://localhost:3002
```

### Environment Configuration
For local development, ensure these are set in `.env`:
```
S3_ENDPOINT_PUBLIC=http://localhost:9000
MEDIA_S3_ENDPOINT_PUBLIC=http://localhost:9000
```

The deploy-media `compose.yml` includes fallback logic:
```yaml
MEDIA_S3_ENDPOINT_PUBLIC: ${S3_ENDPOINT_PUBLIC:-${S3_ENDPOINT:-http://s3:9000}}
```

This means:
- Uses `S3_ENDPOINT_PUBLIC` if set
- Falls back to `S3_ENDPOINT` if `S3_ENDPOINT_PUBLIC` not set
- Falls back to `http://s3:9000` (internal) if neither is set

### Using standalone saarnavideo stack:
```bash
cd C:\Users\jsilv\Code\saarnavideo
docker compose up app -d

# Access at http://localhost:3000
```

## What to Test

1. ✅ Frontend loads without errors
2. ✅ Upload a file (any size, especially >10MB)
3. ✅ Check browser DevTools Network tab:
   - Should see: `POST /source/presigned-url` (returns URL with `localhost:9000` hostname)
   - Should see: `PUT {presigned URL}` to S3 (hostname should be `localhost`, not `saarnavideo-media.s3`)
   - Should see: `POST /source/[id]/finalize`
   - Should NOT see: Direct file POST to `/api/projects/[id]/source`
4. ✅ Check presigned URL in Network tab to verify it points to `localhost:9000` not internal `s3:9000`
5. ✅ Browser upload should succeed (no connection refused errors)
6. ✅ Check S3 logs to verify file appears directly in S3 bucket
7. ✅ Source should show AVAILABLE status after upload completes

## What Still Uses FormData

- **Asset uploads** (images, graphics): Still using FormData (`/api/projects/[id]/assets`)
  - These are small files and require metadata extraction
  - Migration deferred for future work
  
- **Transcription VTT uploads**: Still using FormData
  - These are tiny text files
  - Migration deferred for future work

## Deployment to Registry

When ready to push to ghcr.io:
```bash
# From saarnavideo repo
docker build -t ghcr.io/jsilvanus/saarnavideo:v1.2.0 .
docker push ghcr.io/jsilvanus/saarnavideo:v1.2.0
```

Then update deploy-media `.env`:
```
SAARNAVIDEO_VERSION=v1.2.0
```

## Known Issues / Edge Cases

1. **Presigned URL expiration**: If upload takes longer than URL validity, upload will fail
   - Current validity: Check backend presigned URL generation
   - Mitigation: URLs are typically valid for 15-60 minutes

2. **Large file timeouts**: Very large files (>1GB) may timeout on slow connections
   - Mitigation: Implement chunked uploads later if needed

3. **Failed uploads**: If S3 PUT fails, source remains in PENDING status
   - Workaround: Delete the failed source and retry
   - Future: Add cleanup for abandoned PENDING sources

## Rollback

If presigned URLs aren't working, quickly revert:
```bash
# Remove the dev override
cd D:\deploy-media
docker compose -f compose.yml -f compose.local.yml up saarnavideo -d

# This will use the published image from ghcr.io again
```

Or update compose.dev.yml to comment out the saarnavideo override.
