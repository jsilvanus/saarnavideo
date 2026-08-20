# SaarnaVideo API Documentation

## Base URL

```
https://saarnavideo.example.com/api
```

## Authentication

Most endpoints are currently open. In production, add authentication middleware:

```typescript
// Example: Add Bearer token validation
if (!request.headers.get("Authorization")?.startsWith("Bearer ")) {
  return new Response("Unauthorized", { status: 401 });
}
```

## Core Resources

### Projects

#### Create Project

```
POST /projects
Content-Type: application/json

{
  "title": "Sunday Service",
  "preacher": "Fr. John Doe",
  "gospelRef": "Mt 5:1-12",
  "gospelText": "And seeing the multitudes...",
  "templateKey": "sermon",
  "semanticSegments": [
    {
      "id": "gospel",
      "label": "Gospel",
      "startSeconds": 300,
      "endSeconds": 600
    },
    {
      "id": "sermon",
      "label": "Sermon",
      "startSeconds": 600,
      "endSeconds": 2400
    }
  ]
}

Response: 201 Created
{
  "id": "project-id",
  "title": "Sunday Service",
  "preacher": "Fr. John Doe",
  "templateKey": "sermon",
  "createdAt": "2024-08-20T12:00:00Z"
}
```

#### List Projects

```
GET /projects

Response: 200 OK
[
  {
    "id": "project-1",
    "title": "Sunday Service",
    "preacher": "Fr. John",
    "templateKey": "sermon",
    "createdAt": "2024-08-20T12:00:00Z",
    "updatedAt": "2024-08-20T13:00:00Z",
    "source": { ... },
    "jobs": [ ... ],
    "outputs": [ ... ],
    "publications": [ ... ]
  }
]
```

#### Get Project

```
GET /projects/{projectId}

Response: 200 OK
{
  "id": "project-id",
  "title": "Sunday Service",
  "definition": { ... },
  "source": { ... },
  "jobs": [ ... ],
  "outputs": [ ... ],
  "publications": [ ... ]
}
```

#### Update Project

```
PATCH /projects/{projectId}
Content-Type: application/json

{
  "title": "Updated Title",
  "preacher": "Fr. Jane Doe",
  "templateKey": "liturgy"
}

Response: 200 OK
{
  "id": "project-id",
  "title": "Updated Title",
  ...
}
```

#### Delete Project

```
DELETE /projects/{projectId}

Response: 204 No Content
```

### Sources

#### Upload Source File

```
POST /projects/{projectId}/source
Content-Type: multipart/form-data

file: (binary video file)

Response: 201 Created
{
  "id": "source-id",
  "originalName": "service.mp4",
  "sizeBytes": 5368709120,
  "expiresAt": "2024-08-27T12:00:00Z"
}
```

**Limits:**
- Max file size: 50 GB (configurable via `MAX_UPLOAD_BYTES`)
- Supported formats: MP4, MOV, MKV, WebM
- Retention: 7 days by default

### Assets (Images for Slates/Overlays)

#### Upload Image Asset

```
POST /projects/{projectId}/assets
Content-Type: multipart/form-data

file: (binary image file)
assetKey: "logo" (unique identifier for this asset)
type: "OVERLAY" | "BACKGROUND" | "LOGO" | "FONT"

Response: 201 Created
{
  "id": "asset-id",
  "assetKey": "logo",
  "type": "OVERLAY",
  "mimeType": "image/png",
  "width": 1920,
  "height": 1080,
  "sizeBytes": "2097152",
  "hasAlpha": true,
  "createdAt": "2024-08-20T12:00:00Z"
}
```

**Supported formats:**
- PNG (with full transparency support)
- JPEG (no alpha channel)
- WebP (with transparency support)

**Limits:**
- Max file size: 10 MB (configurable via `MAX_ASSET_SIZE_BYTES`)
- Max dimensions: 4096x2160 (4K)
- Min dimensions: 100x100
- Retention: 7 days by default

#### List Project Assets

```
GET /projects/{projectId}/assets

Response: 200 OK
{
  "assets": [
    {
      "id": "asset-id",
      "assetKey": "logo",
      "type": "LOGO",
      "mimeType": "image/png",
      "width": 1920,
      "height": 1080,
      "hasAlpha": true,
      "sizeBytes": "2097152",
      "createdAt": "2024-08-20T12:00:00Z"
    }
  ]
}
```

#### Delete Asset

```
DELETE /projects/{projectId}/assets/{assetId}

Response: 204 No Content
```

**Usage in Compositions:**
```typescript
// Slate with image background:
{
  type: "slate",
  template: "opening",
  backgroundImage: "logo", // references assetKey
  durationSeconds: 3,
  data: { title: "Service", subtitle: "Sunday" }
}

// Overlay with image (PNG recommended):
{
  type: "overlay",
  template: "gospel",
  imageAsset: "gospel-overlay", // PNG with transparency
  startSeconds: 0,
  endSeconds: 30,
  data: { title: "Gospel Reading" }
}
```

### Generation Jobs

#### Queue Generation

```
POST /projects/{projectId}/generate

Response: 202 Accepted
{
  "id": "job-id",
  "status": "QUEUED",
  "progress": 0,
  "createdAt": "2024-08-20T12:00:00Z"
}
```

#### Get Job Status

```
GET /projects/{projectId}/jobs/{jobId}

Response: 200 OK
{
  "id": "job-id",
  "status": "RENDERING",
  "progress": 50,
  "error": null,
  "createdAt": "2024-08-20T12:00:00Z",
  "startedAt": "2024-08-20T12:05:00Z",
  "completedAt": null
}
```

**Job Status Values:**
- `QUEUED` - Waiting to process
- `ACQUIRING_SOURCE` - Downloading/preparing source
- `PROCESSING` - Analyzing and planning composition
- `RENDERING` - Running FFmpeg to generate video
- `COMPLETED` - Successfully finished
- `FAILED` - Error occurred
- `CANCELLATION_REQUESTED` - User requested cancellation
- `CANCELLED` - Cancellation complete

#### Get Job Logs

```
GET /projects/{projectId}/jobs/{jobId}/logs

Response: 200 OK
[
  {
    "id": "log-id",
    "level": "INFO",
    "message": "Starting FFmpeg render",
    "data": { "outputPath": "/media/..." },
    "createdAt": "2024-08-20T12:05:00Z"
  },
  ...
]
```

#### Cancel Job

```
POST /projects/{projectId}/jobs/{jobId}/cancel

Response: 200 OK
{
  "id": "job-id",
  "status": "CANCELLATION_REQUESTED",
  "cancellationRequested": true
}
```

### Outputs

#### Download Output

```
GET /outputs/{outputId}

Response: 200 OK (with file stream)
Content-Type: video/mp4 (or image/jpeg for thumbnails)
Content-Disposition: attachment; filename="saarnavideo-video.mp4"
Content-Length: 1234567890

(binary file data)
```

**Output Types:**
- `VIDEO` - Rendered MP4 video
- `THUMBNAIL` - Generated JPG thumbnail

### Publications

#### Create YouTube Publication

```
POST /projects/{projectId}/publications
Content-Type: application/json

{
  "outputId": "output-id",
  "provider": "YOUTUBE",
  "privacy": "PRIVATE"
}

Response: 201 Created
{
  "id": "publication-id",
  "provider": "YOUTUBE",
  "status": "QUEUED",
  "privacy": "PRIVATE",
  "createdAt": "2024-08-20T12:00:00Z"
}
```

**Privacy Values:**
- `PRIVATE` - Only visible to you
- `UNLISTED` - Visible via link
- `PUBLIC` - Visible in search/subscriptions

#### Get Publication

```
GET /projects/{projectId}/publications/{publicationId}

Response: 200 OK
{
  "id": "publication-id",
  "provider": "YOUTUBE",
  "externalId": "youtube-video-id",
  "status": "COMPLETED",
  "privacy": "PRIVATE",
  "error": null,
  "createdAt": "2024-08-20T12:00:00Z",
  "completedAt": "2024-08-20T12:15:00Z"
}
```

### YouTube Integration

#### Connect YouTube Account

```
GET /integrations/youtube/connect

Redirects to Google OAuth consent screen
After user grants permission, redirects back to: /integrations/youtube/callback
```

#### YouTube OAuth Callback

```
GET /integrations/youtube/callback?code=...&state=...

Response: 302 Redirect to /
```

(Automatically stores credentials in database)

## Templates & Themes

### List Available Templates

```
GET /templates

Response: 200 OK
[
  {
    "key": "sermon",
    "name": "Sermon",
    "description": "Suitable for sermon videos with Gospel overlay",
    "themeKey": "default",
    "renderSettings": { ... },
    "expectedSegments": ["gospel", "sermon"]
  },
  ...
]
```

### Get Template Details

```
GET /templates/{templateKey}

Response: 200 OK
{
  "key": "sermon",
  "name": "Sermon",
  ...
}
```

### List Available Themes

```
GET /themes

Response: 200 OK
[
  {
    "key": "default",
    "name": "Default Church Theme",
    "colors": { ... },
    "typography": { ... }
  }
]
```

## Webhooks (Future)

Planned for Phase 6:

```
POST /webhooks

{
  "event": "job:completed",
  "jobId": "job-id",
  "projectId": "project-id",
  "outputId": "output-id",
  "timestamp": "2024-08-20T12:15:00Z"
}
```

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid request: field validation failed"
}
```

### 404 Not Found

```json
{
  "error": "Project not found"
}
```

### 413 Payload Too Large

```json
{
  "error": "File is too large"
}
```

### 422 Unprocessable Entity

```json
{
  "error": "Video duration exceeds maximum allowed"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

## Rate Limiting (Future)

Planned for production deployment:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1629465600
```

## Pagination (Future)

Planned for large result sets:

```
GET /projects?page=1&limit=20&sort=-createdAt

{
  "data": [ ... ],
  "page": 1,
  "limit": 20,
  "total": 150,
  "pageCount": 8
}
```

## Usage Examples

### Complete Workflow (cURL)

```bash
# 1. Create project
PROJECT=$(curl -X POST https://saarnavideo.example.com/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Sunday Liturgy",
    "preacher": "Fr. John",
    "templateKey": "liturgy",
    "semanticSegments": [
      {"id": "liturgy", "label": "Divine Liturgy", "startSeconds": 0, "endSeconds": 7200}
    ]
  }')

PROJECT_ID=$(echo $PROJECT | jq -r '.id')

# 2. Upload source
curl -X POST https://saarnavideo.example.com/api/projects/$PROJECT_ID/source \
  -F "file=@service.mp4"

# 3. Queue generation
JOB=$(curl -X POST https://saarnavideo.example.com/api/projects/$PROJECT_ID/generate)
JOB_ID=$(echo $JOB | jq -r '.id')

# 4. Poll job status
while true; do
  JOB_STATUS=$(curl https://saarnavideo.example.com/api/projects/$PROJECT_ID/jobs/$JOB_ID)
  STATUS=$(echo $JOB_STATUS | jq -r '.status')
  PROGRESS=$(echo $JOB_STATUS | jq -r '.progress')
  echo "Status: $STATUS, Progress: $PROGRESS%"
  
  if [ "$STATUS" = "COMPLETED" ]; then
    break
  elif [ "$STATUS" = "FAILED" ]; then
    echo "Job failed!"
    break
  fi
  
  sleep 5
done

# 5. Download video
curl -o video.mp4 \
  https://saarnavideo.example.com/api/outputs/$(echo $JOB_STATUS | jq -r '.outputs[0].id')
```

## OpenAPI/Swagger (Future)

A Swagger definition will be available at:
```
https://saarnavideo.example.com/api/swagger.json
```

## Support

- Report API issues: https://github.com/jsilvanus/saarnavideo/issues
- Check application logs for detailed error messages
- Query `JobLog` table for job-specific debugging
