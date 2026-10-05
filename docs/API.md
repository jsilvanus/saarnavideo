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
  "templateKey": "sermon",            // built-in key; or "userTemplateId": "..." for a saved template
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
  "sizeBytes": 5368709120
}
```

**Limits:**
- Max file size: 50 GB (configurable via `MAX_UPLOAD_BYTES`)
- Supported formats: MP4, MOV, MKV, WebM
- Kept permanently in the shared library

**Identical bytes already in the library** are reused (200 instead of 201): the existing asset and its `assetKey` stay, and the response adds `"reused": true` and, when the name asked for differs, `"requestedKey": "logo"` so the caller knows overlays must use the returned `assetKey`.

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
- Assets are kept in the global library until deleted explicitly

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

#### Remove Asset from Project (unlink)

```
DELETE /projects/{projectId}/assets/{assetId}[?force=1]

Response: 204 No Content
```

Only unlinks; the library asset and its file are never deleted here. Answers `409`
`{ error, usage: string[] }` while the project's definition (graphic layers, composition
items, podcast intro/outro) still refers to the asset, unless `?force=1`.

#### Link Library Asset

```
POST /projects/{projectId}/assets/{assetId}

Response: { ok: true, assetId, projectId }
```

#### Library management (`/assets/{id}`)

```
PATCH  /assets/{id}   { assetKey?, folderId? }   rename (400 invalid key, 409 name taken) / move
DELETE /assets/{id}[?force=1]                     204; 409 { error, projectCount } while linked
```

Deleting removes the row and the content-addressed file (the file only when no other row shares its `storagePath`).

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
Content-Type: application/json

{
  "allowClamping": false,
  "preview": false,
  "captions": { "mode": "none" | "soft" | "burn" | "both", "language": "fi", "styleGraphicId": "graphic-id" }   // optional; default { "mode": "none" }
}

Response: 202 Accepted
{
  "id": "job-id",
  "status": "QUEUED",
  "progress": 0,
  "createdAt": "2024-08-20T12:00:00Z",
  "durationWarnings": [],              // length notices (platform limit, target); never block
  "assetWarnings": [],                 // image references that match no library asset; they render without it
  "autoLinkedAssets": []               // keys of library assets the definition refers to that were linked to the project now
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

Add a `Range` header (or `?inline=1`, which also advertises `Accept-Ranges: bytes` and drops the attachment header) for a seekable stream: players get `206 Partial Content`.

**Output Types:**
- `VIDEO` - Rendered MP4 video (`.mp4`)
- `THUMBNAIL` - Generated JPG thumbnail (`.jpg`)
- `CAPTIONS_SRT` - Sidecar SubRip captions on the output timeline (`.srt`, `application/x-subrip; charset=utf-8`)
- `CAPTIONS_VTT` - Sidecar WebVTT captions on the output timeline (`.vtt`, `text/vtt; charset=utf-8`)
- `AUDIO` - Podcast audio file (`.mp3`, `audio/mpeg`, or `.m4a`, `audio/mp4`); downloaded as `saarnavideo-podcast.<ext>`

Caption outputs carry a `language` (BCP 47 tag) and are named `saarnavideo-captions-<language>.<ext>`.
They exist only for renders queued with `captions.mode = "soft"`, and share the video's `jobId`.

#### Audio assets (voiceovers, podcast intro/outro)

`POST /assets` and `POST /projects/{projectId}/assets` also accept audio: MP3, M4A, WAV, OGG or WebM
(the type is taken from the MIME type, codec parameters such as `audio/webm;codecs=opus` are ignored, a
missing/generic type falls back to the file extension). The asset is stored with `type: "AUDIO"` whatever
`type` the form sends, the duration is probed with ffprobe (`durationMs` in every asset response) and files
that ffprobe cannot read as audio return `400`. The size limit is `MAX_AUDIO_ASSET_SIZE_BYTES` (default
200 MB, `413` above it). Identical bytes are deduplicated like images. `GET /assets/{id}` and
`GET /projects/{projectId}/assets/{assetId}` serve audio with `Range` support.

#### Voiceover timeline item and podcast export

A composition item `{"type":"audio-clip","assetId":...}` places an audio asset on the timeline.
`startSeconds`/`endSeconds` trim the audio file (so the clip length is known without probing), `volume`
defaults to 1.
- `mode: "standalone"` (default): a section in sequence with the others. Video: the template background
  colour, `backgroundImage` or `graphicId` graphic is shown while the recording plays. Podcast: voice only.
- `mode: "mix"`: layered over the finished timeline from `atSeconds` (video-timeline seconds) for its length;
  `duckSourceVolume` (0-1, default 1 = untouched) multiplies the source audio while it plays.

Audio assets are looked up by id in the whole library. `POST /projects/{projectId}/generate` returns `400`
when an `audio-clip` or podcast intro/outro asset does not exist as an `AUDIO` asset.

`POST /projects/{projectId}/generate` with `{"type":"PODCAST","podcast":{...}}` queues an audio-only job
(no THUMBNAIL job follows). `podcast` is merged over `definition.podcast` (the settings saved with the
project) and may contain `introAssetId`, `outroAssetId`, `format` (`mp3` default | `m4a`), `channels`
(`mono` default | `stereo`), `crossfadeSeconds` (0-5, default 0.5) and the tags `title`, `artist`, `album`,
`date`, `comment`; invalid values return `400`. The result is `[intro] + composition audio + [outro]`,
crossfaded, loudness-normalised in two passes to -16 LUFS (-1.5 dBTP), 44.1 kHz, 96 kbit/s mono or
128 kbit/s stereo, and stored as an `AUDIO` output. Standalone slates are silent and skipped; mixed
voiceovers keep their position relative to the audio around them. Tags default to the project title
(title), preacher (artist), Gospel reference (comment) and today (date); the latest thumbnail, if any,
is embedded as cover art. Intro and outro are used for the podcast only, never in the video.

#### Caption options

`captions.mode = "soft"` maps the active transcript segments of every source used by the composition
onto the rendered timeline, muxes them into the MP4 as a `mov_text` subtitle track (language tagged
with the ISO 639-2 code, e.g. `fin`) and stores the SRT/VTT sidecar outputs. `language` defaults to the
language of the source's applied transcription run. If there are no active segments inside the
composition the render succeeds without a track and a `WARN` job log is written. Invalid options
return `400`. When such a video is published to YouTube, the SRT sidecar is uploaded as a caption
track afterwards (failures are logged and do not fail the publication).

`captions.mode = "burn"` draws the same output-timeline cues into the picture (after overlays and slates,
before the preview downscale, so previews show proportionally scaled captions) and creates no caption
outputs or track. `"both"` burns them in and also produces the soft track and the SRT/VTT outputs.
`styleGraphicId` (only with `burn`/`both`) names a graphic of the project that contains a layer of type
`caption`; its box position/size, font, colours, alignment, background box, outline/shadow and `max-lines`
control the look. Without it the built-in default (bottom centre, white bold text on a semi-transparent
box, two lines) is used. Long cues are word-wrapped to the box and split into pages of at most `max-lines`
lines. Returns `400` when the graphic does not exist in the project or has no caption layer. Requires
ffmpeg with libass. See `docs/GRAPHIC_PACKAGE.md` for the caption layer.

### Plain-text transcript (no timings)

```
GET /sources/{sourceId}/transcript.txt?start=&end=&runId=&title=&gap=
GET /sources/{sourceId}/transcript.html?start=&end=&runId=&title=&gap=&lang=
```

The spoken text of a source without timestamps, for accessibility. `text/plain; charset=utf-8`
(attachment `<name>-transcript.txt`) or a minimal HTML document (`text/html; charset=utf-8`, `lang`
attribute from the run language or `lang`, `<h1>` when `title` is given, one `<p>` per paragraph).

- **Range:** `start`/`end` are seconds. A segment is included when its *start* lies in `[start, end)`; a segment
  that began before `start` is left out, one that starts inside and runs past `end` is kept whole, so adjacent
  ranges do not repeat text. Both optional; `end <= start` or non-numeric/negative values return `400`.
- **Source of segments:** the active track, or one transcription run (applied or pending) with `runId`
  (`404` when it does not belong to the source).
- **Paragraphs:** a pause longer than `gap` seconds (default 2) starts a new paragraph; a paragraph that already has
  600 characters is closed at the next sentence end. Whitespace is normalised; nothing else is changed (no
  punctuation added, no speaker labels).
- An empty range returns `200` with an empty body.

### Publications

#### Publish a rendered video (YouTube or Facebook)

```
POST /projects/{projectId}/publish
Content-Type: application/json

{ "platform": "FACEBOOK", "privacy": "PUBLIC" }

Response: 202 Accepted   (the Publication row, status QUEUED)
```

`platform` is `YOUTUBE` (default) or `FACEBOOK`; the `Publication.provider` column holds it. The latest non-preview
`VIDEO` output is uploaded by the worker. Facebook maps `PUBLIC` to a published Page video and `PRIVATE` to an
unpublished one (Page admins only); `UNLISTED` returns `400`. `409` when the platform is not set up (no YouTube
connection, or `FACEBOOK_PAGE_ID`/`FACEBOOK_PAGE_ACCESS_TOKEN` missing), `404` when there is no rendered video.
`GET /projects/{projectId}` lists `publications` with `status` (`QUEUED`, `UPLOADING`, `COMPLETED`, `FAILED`),
`externalId` (YouTube video id or Facebook video id) and a readable `error` on failure. See `docs/FACEBOOK_SETUP.md`.

#### Create YouTube Publication (legacy description)

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

#### List Publications

```
GET /projects/{projectId}/publications

Response: 200 OK
{ "publications": [
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
] }
```

Newest first; 404 for an unknown project. This is the light request the publish panel polls while an upload runs.

### Facebook Integration

```
GET /integrations/facebook/status

Response: 200 OK
{ "configured": true, "pageId": "1234567890", "pageName": "My Church", "graphVersion": "v24.0" }
```

`configured: false` when the environment has no Page. If the token or Page is unusable, `pageName` is `null` and
`error` holds a readable message. The token is never returned. There is no connect/disconnect route: the single Page
comes from `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_ACCESS_TOKEN`.

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

### yt-dlp cookies (YouTube downloads)

Cookies for yt-dlp, stored AES-256-GCM encrypted. The text is write-only and is never returned.

```
GET /api/integrations/youtube/cookies
Response: 200 { "configured": true, "source": "db" | "env" | "none", "cookieCount": 12, "updatedAt": "...", "envFallback": false }

PUT /api/integrations/youtube/cookies
{ "cookies": "<text of a Netscape cookies.txt>" }
Response: 200 (same as GET) | 400 not a cookie file or too large (256 KB) | 503 YOUTUBE_TOKEN_ENCRYPTION_KEY missing or invalid

DELETE /api/integrations/youtube/cookies
Response: 200 (same as GET; falls back to YTDLP_COOKIES_FILE if set)
```

## Templates

Built-in templates (`sermon`, `liturgy`, `vespers`, `short-vertical`) and templates saved from projects. See `docs/TEMPLATE_CREATION.md`.

### List templates

```
GET /api/templates

Response: 200 OK
{ "templates": [
  { "kind": "builtin", "key": "sermon", "name": "Saarna", "description": "...", "sections": ["Evankeliumi", "Saarna"], "presetKey": "youtube-1080p", "targetSeconds": 900 },
  { "kind": "saved", "id": "ckx...", "name": "Oma iltahartaus", "description": "", "sections": ["Psalmi"], "presetKey": "youtube-1080p", "targetSeconds": null }
] }
```

### Save a project as a template

```
POST /api/templates
{ "projectId": "...", "name": "Oma iltahartaus", "description": "optional" }

Response: 201 Created   { "id": "...", "name": "...", "description": "", "sections": [...] }
404 unknown project, 409 a template with this name exists
```

### Delete a saved template

```
DELETE /api/templates/{id}     Response: 200 { "ok": true }   (404 when unknown)
```

Projects made from the template keep their copy.

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

## API connectors and fetched variables

Connectors are global (like the asset library) and configured on the Asetukset page (`/settings`). Secrets are write-only: responses carry `auth.hasSecret`, never the secret. Requests are executed with the `varfetch` package (SSRF guard, 10 s timeout, 5 MiB limit).

- `GET /api/connectors` - list connectors with their requests
- `POST /api/connectors` - create `{ name, baseUrl, auth: { type: none|bearer|api_key|basic, secret?, headerName?, username? }, headers: [{key,value}] }` (409 duplicate name)
- `GET|PATCH|DELETE /api/connectors/[id]` - omitted fields keep their stored value (an omitted `auth.secret` keeps the stored secret)
- `POST /api/connectors/[id]/requests` - add a request `{ name, method, path, query, bodyType, body, responseType, mappings: [{jsonPath, variable, skipIfNull}], timeoutMs }`; `path`, query, headers and body may use `{{name}}`
- `PATCH|DELETE /api/connectors/[id]/requests/[requestId]`
- `POST /api/connectors/[id]/requests/[requestId]/test` - fire with `{ variables }`, nothing saved; returns `{ ok, status, values }`
- `POST /api/projects/[id]/fetch-variables` - `{ requestId, variables? }`; project variables fill `{{name}}`, `variables` overrides them (for example `paiva`, the service date). Returns `{ ok, status, values }` and saves nothing; the Lähde step shows old and new values and saves the accepted ones with the normal project PATCH. 502 with the remote error when the call fails.

Private-network targets are blocked by default. Allow or deny hosts with the env vars `CONNECTOR_ALLOW` / `CONNECTOR_DENY` (comma lists; deny wins). They are env-only because the app has no login.

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
