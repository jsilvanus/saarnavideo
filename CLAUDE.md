# SaarnaVideo Codebase Documentation

## Project Overview

**SaarnaVideo** is a focused media composition tool for turning worship-service recordings into publishable videos with minimal manual editing. The application enables users to upload recordings, create compositions with overlays and slates, generate polished videos, and publish to YouTube.

### Core Vision
- Minimal manual editing required
- Template-driven composition system
- Multi-step video generation pipeline
- Support for overlays, slates, transitions, and image assets
- YouTube integration for source reference and publication

---

## Repository Structure

### Root Configuration Files
```
├── package.json              # Node.js dependencies and scripts
├── pnpm-workspace.yaml       # pnpm workspace configuration
├── tsconfig.json             # TypeScript configuration
├── .eslintrc.json            # ESLint rules
├── Dockerfile                # Container image definition
├── docker-compose.yml        # PostgreSQL + app development setup
└── .env.example              # Environment variable template
```

### Source Code Organization (`/src`)

#### `/src/app` - Next.js Application Layer
- **`layout.tsx`** - Root layout component
- **`page.tsx`** - Main application page
- **`globals.css`** - Global styles
- **`/api`** - API route handlers
  - **`/projects`** - Project CRUD and orchestration
    - `route.ts` - List/create projects
    - `[id]/` - Single project operations
      - `route.ts` - Get/update/delete project
      - `generate/` - Trigger video generation
      - `publish/` - YouTube publication
      - `duplicate/` - Clone a project
      - `source/` - Source management
      - `assets/` - Image asset upload/management
      - `jobs/` - Generation job status/control
  - **`/sources`** - Source direct operations (bypass project)
  - **`/outputs`** - Download generated videos
  - **`/integrations`** - External service integrations
    - **`/youtube`** - OAuth callback and connection

#### `/src/domain` - Business Logic & Validation
Core domain models using Zod for type-safe validation:
- **`project.ts`** - Project composition schema (timeline items: source-clips, overlays, slates)
- **`templates.ts`** - Template system and template resolution
- **`graphics.ts`** - Graphic elements and scene graphs
- **`transcription.ts`** - Transcription data structures
- **`validation.ts`** - Shared validation utilities
- **`*.test.ts`** - Unit tests for domain logic

#### `/src/components` - React UI Components
- **`CompositionEditor.tsx`** - Interactive composition editor
- **`GraphicsEditor.tsx`** - Scene graph editor
- **`SidebarToggle.tsx`** - UI toggle component
- **`/graphics-editor/`** - Graphics editor subcomponents, geometry and types
- **`SourcePlayer.tsx`** - Shared YouTube/local source preview player hook
- **`api.ts`**, **`format.ts`** - Shared fetch and formatting helpers

#### `/src/integrations` - External Service Integration
- **`youtube.ts`** - YouTube API client
- **`youtube-oauth.ts`** - OAuth authentication flow
- **`transcription.ts`** - Speech-to-text integration
- **`image-assets.ts`** - Image asset handling

#### `/src/renderer` - Video Generation
FFmpeg-based rendering pipeline:
- **`ffmpeg.ts`** - FFmpeg command execution and parsing
- **`composition.ts`** - Composition-to-FFmpeg translation
- **`layers.ts`** - Video layer composition and filtering
- **`*.test.ts`** - Renderer tests with fixtures

#### `/src/worker` - Async Job Processing
- **`index.ts`** - Worker entry point for generating videos
- **`source-resolution.ts`** - Download/acquire source media
- **`sources.ts`** - Source file operations and cleanup
- **`*.test.ts`** - Worker logic tests

#### `/src/lib` - Utilities
- **`prisma.ts`** - Prisma client singleton

#### `/src/types` - TypeScript Type Definitions
- **`youtube.d.ts`** - YouTube API types

### Database Schema (`/prisma`)
- **`schema.prisma`** - SQLite schema (development)
- **`schema.postgresql.prisma`** - PostgreSQL schema (production)

Models:
- **Project** - Composition project with template reference
- **Source** - Media input (upload or YouTube reference)
- **GenerationJob** - Async video generation task
- **Output** - Generated video or thumbnail artifact
- **Publication** - YouTube upload record
- **Asset** - Library image or audio file (overlay, background, logo, font; audio for voiceovers and podcast intro/outro, with `durationMs`)
- **JobLog** - Generation process logs

Enums:
- SourceType (UPLOAD, YOUTUBE)
- OutputType (VIDEO, THUMBNAIL, CAPTIONS_SRT, CAPTIONS_VTT, AUDIO)
- JobStatus (QUEUED → ACQUIRING_SOURCE → PROCESSING → RENDERING → COMPLETED/FAILED)
- AssetType (OVERLAY, BACKGROUND, LOGO, FONT, AUDIO)
- PublicationStatus (QUEUED → UPLOADING → COMPLETED/FAILED)

### Documentation (`/docs`)
- **`plan.md`** - High-level product roadmap
- **`technical-phase-plan.md`** - Five-phase implementation strategy
- **`API.md`** - API endpoint reference
- **`DEPLOYMENT.md`** - Deployment and environment setup
- **`YOUTUBE_OAUTH_SETUP.md`** - OAuth configuration guide
- **`TEMPLATE_CREATION.md`** - Template system documentation
- **`IMAGE_ASSETS_FEATURE_PLAN.md`** - Image asset feature details

### Python Worker (`/transcription`)
- **`transcribe.py`** - Speech-to-text processing script
- **`requirements.txt`** - Python dependencies

---

## Technology Stack

### Frontend & Backend
- **Next.js 15.5** - React framework with API routes
- **TypeScript 5.9** - Type-safe development
- **React 19.1** - UI components
- **Zod 4.0** - Runtime schema validation

### Database
- **SQLite** - Development database
- **PostgreSQL 17+** - Production database
- **Prisma 6.15** - ORM and migrations

### Media Processing
- **FFmpeg** - Video rendering and composition
- **Python (speech-to-text)** - Transcription pipeline

### Development & Testing
- **Vitest 3.2** - Unit test runner
- **ESLint 8.57** - Code linting
- **tsx 4.20** - TypeScript execution
- **pnpm** - Package manager

### Containerization
- **Docker** - Application container
- **Docker Compose** - Multi-service development

---

## Core Architecture

### Domain Model
```
Project
  ├── Source (uploaded video or YouTube reference)
  ├── Composition (timeline of source clips, overlays, slates)
  ├── GenerationJob (async rendering task)
  ├── Output (rendered video + thumbnail)
  ├── Publication (optional YouTube upload)
  └── Asset (image overlays, backgrounds, logos)
```

### Data Flow
1. **Source Acquisition** - Upload file or reference YouTube URL
2. **Project Definition** - Create composition with timeline items
3. **Asset Upload** - Add custom images for overlays/backgrounds
4. **Job Queue** - Submit for rendering (triggers worker)
5. **Rendering Pipeline**
   - Resolve source segments
   - Composite layers (source + overlays)
   - Apply transitions
   - Generate with FFmpeg
6. **Output Storage** - Download or publish video

### Asset Library
Image assets (PNG/JPEG/WebP, 100×100 to 4096×2160, max 10 MB; audio is described under "Voiceover and podcast") live in one global, deduplicated library shared by all projects. The UI is at `/assets` ("Graphics library" link in the root layout, `src/app/assets/page.tsx`).

- **Storage:** content-addressed files at `MEDIA_ROOT/assets/library/<sha256>.<ext>`. `Asset.contentHash` deduplicates: uploading identical bytes again reuses the existing row (the new `assetKey` is ignored) instead of creating a copy.
- **Lifetime:** library assets have `expiresAt = null` and are never removed by the expiry cleanup. Deleting a project only unlinks its assets. They are removed only through `DELETE /api/projects/[id]/assets/[assetId]` when the last linked project unlinks them.
- **Folders:** `AssetFolder` is a tree (`parentId`) used only for organisation. The library page supports drag-and-drop moves between folders and breadcrumbs.
- **Project link:** `Asset.projects` is a many-to-many relation. Uploading from a project's Graphics tab (`POST /api/projects/[id]/assets`) stores the file in the library and links it. The graphics editor's image picker lists only **linked** assets, and it stores the image `src` as `/api/projects/<projectId>/assets/<assetId>`.
- **Rendering:** the worker builds `assetPaths` from the project's linked assets, keyed by `assetKey`, by `id` and by that project URL. Overlay `imageAsset`, slate `backgroundImage` and rich-layer image `src` values resolve through this map. An asset that isn't linked to the project is silently skipped.
- **Types:** `OVERLAY | BACKGROUND | LOGO | FONT` is a label only; the renderer treats every type the same. `FONT` cannot actually be uploaded because uploads accept images and audio only. `AUDIO` is set automatically for audio files.

### Captions and export formats
Captions come from the active `TranscriptSegment`s of each source (see `docs/transcription-editor-contract.md`). Source-level export is `GET /api/sources/[id]/captions.vtt|.srt`. Composition-level (soft) captions are a render option:

- **Request:** `POST /api/projects/[id]/generate` accepts `captions: { mode: "none" | "soft" | "burn" | "both", language?, styleGraphicId? }` (Zod: `captionOptionsSchema` in `src/domain/captions.ts`; modes `none | soft | burn | both`, plus `styleGraphicId` for burned captions, see below). It is stored in `MediaJob.parameters.captions` and read by the worker (`readCaptionOptions`, `src/worker/captions.ts`). The UI selector is on the Generate panel.
- **Timing:** `mapCaptionsToTimeline` (`src/renderer/caption-timeline.ts`, pure) puts each source's segments on the output timeline: per source-clip it keeps overlapping segments, clips them to the clip range and shifts by the clip's output start (`layoutTimeline` mirrors `buildCompositionRenderPlan`: crossfades pull the next item back by the transition, standalone slates take time and carry no cues, overlays take none). Output cues never overlap (an earlier cue is cut where the next starts), because mov_text cannot hold overlapping cues.
- **Soft mode:** the worker writes `<output>.srt`/`.vtt`, passes the SRT to `buildCompositionRenderPlan(..., { captions: { path, language } })` (extra last `-i`, `-map N:0 -c:s mov_text -metadata:s:s:0 language=<iso639-2>` appended after the video/audio maps, so the preview rewrite of the first `-map` still works), and stores two extra `Output` rows of type `CAPTIONS_SRT` / `CAPTIONS_VTT` (with `Output.language`) beside the `VIDEO` row. Previews get them too (`preview = true`). No transcript in range = render without a track (WARN job log).
- **Downloads:** `GET /api/outputs/[id]` picks extension/mime from the output type (`outputExtension`, `CAPTION_MIME` in `src/domain/captions.ts`).
- **YouTube:** after a successful video upload `processPublication` uploads the job's SRT sidecar with `captions.insert` (`uploadCaptionToYouTube`, `src/worker/caption-publish.ts`). Fails soft (WARN JobLog + console). Needs the `youtube.force-ssl` OAuth scope, which `youtube-oauth.ts` now requests; connections made earlier must be reconnected for caption upload to work (the video upload is unaffected). `captions.insert` costs 400 API quota units.
- **Not covered:** captions in the legacy no-items render path.

#### Burned-in captions (`mode: "burn"` or `"both"`)
- **Caption style = a graphic with a `caption` layer.** `graphicLayerSchema.type` gained `"caption"` (`src/domain/graphics.ts`): a placeholder text box (sample text `Esimerkkiteksti`) whose x/y/width/height (graphic coordinates, 1920x1080 by default) is the area captions are laid out in, and whose `style` map holds the look: `font-family`, `font-size`, `font-weight`, `color`, `text-align`, `vertical-align` (top|middle|bottom; text is anchored to that edge of the box), `background` (box colour, rgba ok), `padding`, `text-shadow` (2nd number = depth), `-webkit-text-stroke` (outline), `max-lines`, `opacity`. `src/domain/caption-style.ts` holds the helpers (`isCaptionStyleGraphic`, `createCaptionGraphic`, `captionStyleFromGraphic` which scales to the video size, and the built-in default: bottom centre, 56 px bold white on `rgba(0,0,0,0.6)`, 2 lines, DejaVu Sans). No schema migration: old graphics/packages are unchanged and a graphic without a caption layer is simply not a caption style. A caption layer inside a graphic that is used as a slate/overlay is ignored by the renderer.
- **Reuse:** graphics stay project-local (`definition.graphics`), so a style is reused within a project by `styleGraphicId`, across projects with the existing graphic export/import routes (`.svgraphic`; import assigns a new id) and by project duplication. No new table or global library. Older SaarnaVideo versions reject packages containing a caption layer (their layer type enum does not know it).
- **Editor:** "＋ Caption" in the graphics toolbar and "New caption style" (Graphics tab and the Generate panel) create a graphic pre-filled with a caption layer. The Generate panel lists caption styles in a picker (default = built-in style); fast previews use the same selection.
- **Render:** the worker (`prepareCaptions`, `src/worker/index.ts`) maps transcript cues onto the output timeline (same `mapCaptionsToTimeline` as soft captions), wraps them (`src/renderer/caption-wrap.ts`: greedy word wrap by character budget, width estimated as `fontSize * 0.55` per character (`0.6` bold) - an approximation for DejaVu Sans, slightly conservative; a cue needing more than `max-lines` (also limited by box height) is split into consecutive pages whose times tile the cue in proportion to their length), writes `<output>.ass` (`src/renderer/ass.ts`, PlayRes = video size) and `buildCompositionRenderPlan(..., { burnedCaptions: { assPath, fontsDir } })` appends `ass=filename=...` after overlays and slates, before the preview downscale (the worker's `scale=640` is appended afterwards, so caption size scales with the picture). The ASS file is deleted after the render. libass is required (`ffmpeg -filters | grep ' ass '`; the Dockerfile.worker build checks it); there is no drawtext fallback. A background colour is one drawn rectangle (box width, height by line count, bottom/top anchored), not libass' per-line box.
- **Fonts:** the template `fontFile` is used when set (family name read with `fc-scan`, its directory passed as `fontsdir`); otherwise the style's first `font-family` resolved by fontconfig, default `DejaVu Sans` (installed by `fonts-dejavu-core`; Dockerfile.worker also installs `fontconfig`). ASS font size = CSS size x 1.16 because libass sizes the font cell, not the em. Finnish ä/ö/å render with DejaVu.
- **Validation:** the generate route returns 400 when `styleGraphicId` (with burn/both) is not a graphic of the project or has no caption layer; at render time a missing style falls back to the default with a WARN job log. `mode: "both"` adds the soft track and SRT/VTT outputs to the burned picture.
- **Tests:** unit tests in `src/renderer/caption-wrap.test.ts`, `ass.test.ts`, `src/domain/caption-style.test.ts`, `src/worker/captions.test.ts`; `e2e/captions-burned.e2e.test.ts` checks text pixels in the caption box only during cues, two box positions, wrapping/paging, Finnish glyphs, both mode and the scaled preview.

### Plain-text transcript (accessibility)
`GET /api/sources/[sourceId]/transcript.txt|.html?start=&end=&runId=&title=&gap=&lang=` returns the spoken text without timings (route helper `src/app/api/_lib/transcript.ts`, pure builder + range selection in `src/lib/transcript-text.ts`). Range rule: a segment belongs to `[start, end)` when its **start** is inside (no repeats between adjacent ranges, no cut sentences). `runId` reads one run (also pending) instead of the active track. Paragraphs break at pauses > `gap` (default 2 s) and, after 600 characters, at the next sentence end; whitespace is normalised, nothing else is altered; speaker labels only if segments carry a `speaker`. The Transcription tab has a "Plain text" block (start/end, section picker from `definition.sections`, preview, Copy, Download .txt/.html). Composition-level (output timeline) text is not implemented. Tests: `src/lib/transcript-text.test.ts`, `e2e/transcript-text.e2e.test.ts`.

### Publishing (YouTube and Facebook)
`POST /api/projects/[id]/publish` takes `{ platform: "YOUTUBE"|"FACEBOOK", privacy }` and creates a `Publication`; `Publication.provider` (enum `PublicationProvider`, now `YOUTUBE | FACEBOOK`, in both prisma schemas) is the platform field. The worker's `processPublication` branches on it. The Download tab's `PublishPanel` (`src/components/PublishPanel.tsx`) picks platform and visibility and lists publications per platform (polls while one is running).
- **Facebook (one Page, env only):** `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` (never stored in the DB or logged; scrubbed from errors), optional `FACEBOOK_GRAPH_VERSION` (default `v24.0`), `FACEBOOK_GRAPH_BASE_URL`, `FACEBOOK_STATUS_POLL_MS`, `FACEBOOK_PROCESSING_TIMEOUT_MS`. `GET /api/integrations/facebook/status` reports configured + Page name. `PUBLIC` = published, `PRIVATE` = unpublished upload, `UNLISTED` = 400.
- **Upload:** `src/integrations/facebook.ts` (resumable start/transfer/finish with server-dictated chunk ranges, retries on 5xx/network, status polling, thumbnail, `video.<locale>.srt` captions, Graph error mapping such as code 190) and `src/worker/facebook-publish.ts` (orchestration: thumbnail and caption failures are WARN job logs, never fail the publication; upload/processing errors fail it with a readable `Publication.error`).
- **Tests:** `e2e/fake-graph-server.ts` is a fake Graph API with chunk accounting and an admin API; `src/integrations/facebook.test.ts` (unit/integration) and `e2e/facebook.e2e.test.ts`. `e2e/global-setup.ts` starts the fake server and points the worker and Next server at it (`inject("facebookUrl")`). Never verified against the real Graph API; see `docs/FACEBOOK_SETUP.md`.
- `src/lib/prisma.ts` now also strips `expiresAt` filters from `findFirst` (before, the publish route and the worker never found any output because expiry is cleared on write).

### Voiceover and podcast
Audio lives in the same asset library as images: `Asset.type = AUDIO` (label; `Asset.durationMs` is probed with ffprobe on upload, `src/integrations/audio-assets.ts`: mp3/m4a/wav/ogg/webm, `MAX_AUDIO_ASSET_SIZE_BYTES` default 200 MB). `POST /api/assets` and `POST /api/projects/[id]/assets` detect audio by MIME/extension and force type AUDIO (`readAudioUpload`/`storeAudioAsset` in `src/app/api/_lib/assets.ts`). Browser recordings (`audio/webm;codecs=opus`, no duration in the header) get their duration by decoding once. The `/assets` page shows audio tiles with a player.

- **Timeline item `audio-clip`** (`audioClipSchema`, `src/domain/project.ts`): `assetId`, trim `startSeconds`/`endSeconds` (of the audio file, so length is known without probing), `volume`, `mode`. `standalone` = a base item taking time in sequence (like a slate: `isBaseItem`/`baseItemDuration`; `layoutTimeline` and therefore soft/burned caption alignment include it, it carries no cues). `mix` = layered from `atSeconds` (video-timeline seconds), takes no time, `duckSourceVolume` lowers the source audio during it. Optional `graphicId`/`backgroundImage`/`data` give a standalone clip's video picture (built as a slate; default = template background colour). Definitions are stored without schema defaults, so the renderer applies them itself.
- **Video render** (`buildCompositionRenderPlan`): standalone clip = slate-like picture + `audioClipFilter` (trim, pad/cut to exact length); mixes = `audioMixFilters` (`adelay` + `amix normalize=0`, ducking via `volume` with `eval=frame`) after the concat. Audio assets are found in `assetPaths` by **asset id** and, unlike images, are loaded from the whole library by the worker (`referencedAudioAssetIds`), not only project-linked assets.
- **Podcast**: `definition.podcast` (`podcastSettingsSchema`: `introAssetId`, `outroAssetId`, `format` mp3|m4a, `channels`, `crossfadeSeconds`, tags) is saved with the project (optional, old definitions unchanged). `POST /generate {type:"PODCAST", podcast?}` creates a `MediaJob` of type `PODCAST` (no thumbnail job); the worker (`runPodcastJob`, `src/worker/index.ts`) runs `buildPodcastRenderPlan` (`src/renderer/podcast.ts`) twice: a loudnorm measure pass and a linear second pass to -16 LUFS / -1.5 dBTP, output `Output.type = AUDIO` (`audio/mpeg` or `audio/mp4`, extension via `outputExtension(type, mimeType)`). Body = base items in order minus standalone slates (silent, skipped); mixes are moved earlier by the slate time removed before them. Intro/outro are podcast-only: `[intro] acrossfade [body] acrossfade [outro]` (0 = concat), downmixed to mono (default) or stereo, 44.1 kHz, libmp3lame 96k/128k or AAC. Tags via `-metadata` with `-map_metadata -1` (title = project title, artist = preacher, comment = gospelRef, date = today, album from settings), cover art = latest THUMBNAIL output as attached picture (skipped, with an INFO log, when none exists yet). No RSS feed.
- **UI**: tabs `Voiceover` (`VoiceoverPanel.tsx`: MediaRecorder record/stop/preview/re-record/save, file upload, project audio list with "Add as section" / "Mix over video") and `Podcast` (`PodcastPanel.tsx`: intro/outro pickers from the library, format, channels, crossfade, tags, generate, player + download). `CompositionEditor` shows audio in the resource bin: drop between sections = standalone clip, drop into a section = mix at that section's start.
- **Tests**: unit `src/domain/audio-clip.test.ts`, `src/renderer/podcast.test.ts`, `caption-timeline.test.ts`, `ffmpeg.test.ts`, `src/worker/podcast.test.ts`, `src/integrations/audio-assets.test.ts`; `e2e/voiceover-podcast.e2e.test.ts` (sine-tone fixtures, segment order by Goertzel, duration, ID3 tags, cover art, ebur128 loudness, caption alignment, ducking).

### Template System
Projects reference templates by key (e.g., "sermon"). Templates define:
- Default visual styling (colors, fonts, layout)
- Overlay/slate placement and animation
- Composition structure
- Resolution and aspect ratio

### Generation Pipeline Phases
1. **ACQUIRING_SOURCE** - Download/verify source media
2. **PROCESSING** - Parse composition and build FFmpeg commands
3. **RENDERING** - Execute FFmpeg, generate video and thumbnail
4. **COMPLETED/FAILED** - Store outputs or log errors

---

## Key Features Implemented

✅ **Core Rendering**
- Source range selection and cutting
- Timeline-based composition
- Overlay rendering (text, rectangles, images)
- Slate generation (opening/closing cards)
- Transition effects (cut, fade, crossfade)
- FFmpeg-based MP4 output
- Thumbnail generation

✅ **Project Management**
- Create, read, update, delete projects
- Persistent storage with Prisma
- Template-based configuration
- Project duplication

✅ **Source Management**
- Local file upload
- YouTube URL reference (metadata stored)
- Source expiration and cleanup

✅ **Media Assets**
- Custom image upload (overlays, backgrounds) and audio upload/recording (voiceovers, jingles)
- Asset type classification
- Global asset library linked to projects (no longer per-project storage)

✅ **Generation & Publishing**
- Async job queue with status tracking
- Worker process for background rendering
- Job logging and error tracking
- YouTube OAuth authentication flow
- Publication queuing

✅ **Development Environment**
- Docker Compose stack
- SQLite for rapid iteration
- PostgreSQL for production
- Automated Prisma setup

---

## API Routes Summary

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/[id]` - Get project details
- `PUT /api/projects/[id]` - Update project
- `DELETE /api/projects/[id]` - Delete project
- `POST /api/projects/[id]/duplicate` - Clone project
- `POST /api/projects/[id]/generate` - Queue generation job (`type`: VIDEO, PREVIEW, THUMBNAIL or PODCAST)
- `POST /api/projects/[id]/publish` - Queue YouTube publication

### Sources
- `POST /api/projects/[id]/source` - Add source to project
- `DELETE /api/projects/[id]/source/[sourceId]` - Remove source
- `GET /api/sources/[sourceId]` - Get source details
- `DELETE /api/sources/[sourceId]` - Delete source directly

### Asset library (global)
- `GET /api/assets` - List all library assets (with `projectCount`) and folders
- `POST /api/assets` - Upload an image into the library (multipart: `file`, `assetKey`, optional `type`, `folderId`)
- `GET /api/assets/[id]` - Serve the image file
- `PATCH /api/assets/[id]` - Move to a folder (`folderId`) or rename (`assetKey`)
- `GET/POST /api/assets/folders` - List / create folders (`name`, `parentId`)
- `PATCH /api/assets/folders/[id]` - Rename or move a folder (cycle-checked)
- `DELETE /api/assets/folders/[id]` - Delete a folder; its assets and subfolders move to the parent

### Project assets
- `GET /api/projects/[id]/assets` - List assets linked to the project
- `POST /api/projects/[id]/assets` - Upload an image and link it to the project (deduplicated into the library)
- `GET /api/projects/[id]/assets/[assetId]` - Serve a linked asset (this URL is what graphics store as image `src`)
- `POST /api/projects/[id]/assets/[assetId]` - Link an existing library asset to the project
- `DELETE /api/projects/[id]/assets/[assetId]` - Unlink; deletes the asset and file when no other project uses it

### Jobs
- `GET /api/projects/[id]/jobs/[jobId]` - Get job status (the 10 latest jobs come with `GET /api/projects/[id]`)
- `POST /api/projects/[id]/jobs/[jobId]/cancel` - Cancel running job

### Outputs
- `GET /api/outputs/[id]` - Download generated video

### Integrations
- `GET /api/integrations/youtube/connect` - Start OAuth flow
- `GET /api/integrations/youtube/callback` - OAuth callback handler

---

## Development Workflow

### Setup
```bash
# Install dependencies
npm install

# Initialize database
npx prisma generate
npx prisma db push

# Start PostgreSQL (if using containerized)
docker compose up postgres
```

### Running Locally
```bash
# Development server
npm run dev          # Next.js on http://localhost:3000

# In another terminal: generation worker
npm run worker       # Processes queued jobs

# Tests
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

### Commands
- `npm run lint` - Check code style
- `npm run build` - Production build
- `npm run start` - Serve production build
- `npm run db:push` - Apply schema migrations
- `npm run db:generate` - Regenerate Prisma client

### Testing
- `npm test` runs unit tests. Database-backed tests need a pushed schema (`npx prisma db push`).
- `npm run test:e2e` runs `e2e/*.e2e.test.ts`. The global setup generates fixtures with FFmpeg, pushes the SQLite schema into a temp DB, starts `next dev` and the worker, and drives the real HTTP API. It needs `ffmpeg`/`ffprobe` with a default font for `drawtext`, and a SQLite-generated Prisma client. Set `E2E_VERBOSE=1` for server/worker logs and `E2E_KEEP=1` to keep the temp dir.
- Unit tests use **Vitest** 
- Test files follow `*.test.ts` naming
- Mock FFmpeg output in renderer tests
- Fixture videos stored in test resources

---

## Important Patterns

### Validation
All domain schemas use **Zod** for runtime validation:
```typescript
export const compositionSchema = z.object({ /* ... */ });
export type Composition = z.infer<typeof compositionSchema>;
```

### Error Handling
- Prisma queries handle database errors
- FFmpeg execution captures exit codes and stderr
- Job logs record all processing steps
- Errors stored in GenerationJob.error

### File Expiration
- NOTE: media is currently persistent (`src/lib/prisma.ts` clears `expiresAt`); the worker no longer runs an expiry cleanup (the old one deleted everything each minute, see git history). The retention bullets below describe the earlier design.
- Sources expire after 7 days by default (configurable via PROJECT_EXPIRATION_DAYS)
- Outputs expire after 7 days
- Expired files auto-cleanup via worker background task

### Type Safety
- Full TypeScript coverage (no `any` without reason)
- Zod schemas derive types for compile-time checking
- React components typed with React.FC or explicit return types

---

## Next Implementation Phases

**Phase 3** (In Progress)
- Rich transcription integration
- AI-powered timestamp suggestions
- Enhanced overlay rendering system

**Phase 4**
- Advanced template customization UI
- Preset management
- Batch generation

**Phase 5**
- Analytics and metrics
- Team collaboration
- API v2 with GraphQL

---

## Common Debugging

### Worker Not Processing Jobs
1. Check worker is running: `npm run worker`
2. Verify database connection and environment variables
3. Check job status: `GET /api/projects/[id]/jobs/[jobId]`
4. Review job logs in database: `GenerationJob.logs`

### FFmpeg Failures
1. Verify FFmpeg installed: `which ffmpeg`
2. Check source file exists and is readable
3. Review FFmpeg command in job logs
4. Test FFmpeg command directly in terminal

### Media Upload Issues
1. Check file permissions and disk space
2. Verify MIME type is supported (video/audio)
3. Review upload size limits in `src/app/api/projects/upload`
4. Check storage path configuration

### Database Issues
1. Verify PostgreSQL running: `docker compose ps`
2. Check DATABASE_URL environment variable
3. Reset with: `npx prisma db push --skip-generate --force-reset` (dev only)
4. Review Prisma logs: `DEBUG=* npm run dev`

---

## File Size Notes
- Large media files are temporary by default (7-day retention)
- Outputs stored in `MEDIA_OUTPUT_PATH` (usually `/tmp/saarnavideo-outputs`)
- Sources cached during job processing, cleaned up after completion
- Asset images and audio are stored permanently as content-addressed files in the library

---

## Contact & Maintenance
- See `docs/plan.md` for roadmap
- See `docs/technical-phase-plan.md` for implementation strategy
- Review `docs/API.md` for endpoint details
