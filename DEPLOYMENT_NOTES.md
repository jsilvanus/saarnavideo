# Deployment Notes: Presigned S3 URLs

## What Changed

The frontend source upload flow has been migrated from direct FormData POST (which hit Node.js body size limits) to presigned S3 URLs. This eliminates the 10MB body size limit and allows direct S3 streaming.

**Commit**: `3a8c992` - Frontend: migrate source uploads to presigned S3 URLs

### Key Changes
- `src/components/workspace/useWorkspace.tsx`: Updated to use presigned URL flow
  - `uploadFileToS3()`: New helper for direct S3 PUT requests
  - `addUploads()`: Now requests presigned URL → uploads to S3 → finalizes
  - `uploadPendingSource()`: Also uses presigned URL flow
- `src/app/api/_lib/s3.ts`: Exported `getS3Client` function

### Upload Flow (3 steps)
1. **Request presigned URL**: `POST /api/projects/[id]/source/presigned-url`
   - Request: `{ fileName, fileSizeBytes, sourceId }`
   - Response: `{ uploadUrl, sourceId }`
   
2. **Upload to S3**: `PUT {uploadUrl}`
   - File is uploaded directly to S3 (bypasses Node.js)
   - No body size limits
   
3. **Finalize upload**: `POST /api/projects/[id]/source/[sourceId]/finalize`
   - Updates source status from PENDING to AVAILABLE

## Testing Locally

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
   - Should see: `POST /source/presigned-url` → `PUT {S3 presigned URL}` → `POST /source/[id]/finalize`
   - Should NOT see: Direct file POST to `/api/projects/[id]/source`
4. ✅ Check S3 logs to verify file appears directly in S3 bucket
5. ✅ Source should show AVAILABLE status after upload completes

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
