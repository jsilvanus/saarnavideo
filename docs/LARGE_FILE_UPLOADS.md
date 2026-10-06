# Large File Upload Guide

## Overview

Saarnavideo now supports **unlimited file size uploads** through presigned S3 URLs. Instead of uploading files through the Node.js server (which has memory and body size limits), files are uploaded directly to S3.

## API Endpoints

### 1. Request Presigned URL

**POST** `/api/projects/{projectId}/source/presigned-url`

Request body:
```json
{
  "fileName": "my-video.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 1073741824
}
```

Response:
```json
{
  "uploadUrl": "https://s3.example.com/...",
  "sourceId": "abc123def456",
  "s3Key": "media/projects/.../abc123def456/my-video.mp4",
  "projectId": "cmux2m8xu0000nu0k8kqd4eky"
}
```

### 2. Upload File to S3

Use the `uploadUrl` to upload the file directly to S3:

```javascript
const response = await presignedUrlResponse.json();
const { uploadUrl, sourceId } = response;

await fetch(uploadUrl, {
  method: "PUT",
  body: file, // File from input element
  headers: {
    "Content-Type": file.type,
  },
});
```

The presigned URL is valid for **1 hour**. If the upload takes longer, request a new URL.

### 3. Finalize the Source

**POST** `/api/projects/{projectId}/source/{sourceId}/finalize`

Optional request body (if you have duration):
```json
{
  "durationMs": 60000
}
```

Response:
```json
{
  "id": "abc123def456",
  "type": "UPLOAD",
  "status": "AVAILABLE",
  "originalName": "my-video.mp4",
  "sizeBytes": "1073741824",
  "durationMs": 60000
}
```

## Frontend Example

```typescript
async function uploadLargeFile(projectId: string, file: File) {
  // Step 1: Request presigned URL
  const urlResponse = await fetch(
    `/api/projects/${projectId}/source/presigned-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    }
  );

  if (!urlResponse.ok) {
    throw new Error("Failed to get presigned URL");
  }

  const { uploadUrl, sourceId } = await urlResponse.json();

  // Step 2: Upload directly to S3
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  if (!uploadResponse.ok) {
    throw new Error("Upload to S3 failed");
  }

  // Step 3: Finalize the source in the database
  const finalizeResponse = await fetch(
    `/api/projects/${projectId}/source/${sourceId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        durationMs: 60000, // optional: video duration in ms
      }),
    }
  );

  if (!finalizeResponse.ok) {
    throw new Error("Failed to finalize upload");
  }

  return await finalizeResponse.json();
}
```

## Advantages

✅ **Unlimited file size** - No server body size limits  
✅ **Direct S3 upload** - Bypass Node.js server  
✅ **Low server memory** - No buffering required  
✅ **Resumable** - Can use S3 multipart API for large files  
✅ **Fast** - Optimal network path directly to S3  

## Error Handling

| Status | Meaning |
|--------|---------|
| 404 | Project not found |
| 413 | File exceeds MAX_UPLOAD_BYTES limit |
| 500 | S3 configuration error |

Check the response body for error details.

## Configuration

The following environment variables control file upload behavior:

- `MAX_UPLOAD_BYTES` - Max file size (default: 50GB)
- `MEDIA_S3_BUCKET` - S3 bucket for uploads
- `MEDIA_S3_PREFIX` - Key prefix in bucket (default: `media`)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - S3 credentials
- `MEDIA_S3_ENDPOINT` - S3-compatible endpoint (optional)
