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
- **`page.tsx`** - Main application page: only wires `WorkspaceProvider`, `Sidebar`, `Workspace`, `Modals` and `WorkspaceStyles` together
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
- **`saved-templates.ts`** - Capture a project as a template and apply it again
- **`source-ids.ts`** - Translate source ids in a definition (project duplication)
- **`transcription.ts`** - Transcription data structures
- **`validation.ts`** - Shared validation utilities
- **`*.test.ts`** - Unit tests for domain logic

#### `/src/i18n` - Interface language (fi, en, sv)
- **`locales.ts`** (locale list, cookie name, `Accept-Language` parsing), **`translate.ts`** (`translate`, `makeT`, typed `MessageKey`), **`I18nProvider.tsx`** (`useT()`, `useLocale()`), **`server.ts`** (`getServerLocale()` for server components), **`messages/{fi,en,sv}.ts`**.

#### `/src/components` - React UI Components
- **`CompositionEditor.tsx`** - Interactive composition editor
- **`GraphicsEditor.tsx`** - Scene graph editor
- **`SidebarToggle.tsx`** - UI toggle component
- **`/graphics-editor/`** - Graphics editor subcomponents, geometry and types
- **`SourcePlayer.tsx`** - Shared YouTube/local source preview player hook
- **`TemplatePicker.tsx`** - Template list for the new-project dialog and the "save as template" block
- **`TimelineView.tsx`** - Read-only output timeline (Video / Grafiikat / Ääni), horizontal or vertical
- **`VariablesEditor.tsx`** - Project variables editor (`{{name}}` values for graphics)
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
- **MediaJob** - Async job (render, preview, thumbnail, podcast, download, transcribe) claimed by the worker
- **Output** - Generated video or thumbnail artifact
- **Publication** - YouTube or Facebook upload record
- **Asset** - Library image or audio file (overlay, background, logo, font; audio for voiceovers and podcast intro/outro, with `durationMs`)
- **JobLog** - Job process logs
- **TranscriptionRun / TranscriptSegment**, **AssetFolder**, **UserTemplate**, **ApiConnector / ApiRequest**, **YouTubeConnection** - see the sections below

Enums:
- SourceType (UPLOAD, YOUTUBE)
- OutputType (VIDEO, THUMBNAIL, CAPTIONS_SRT, CAPTIONS_VTT, AUDIO)
- MediaJobType (DOWNLOAD, THUMBNAIL, PREVIEW, VIDEO, PODCAST, TRANSCRIBE)
- MediaJobStatus (QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED)
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
  ├── MediaJob (async rendering task)
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
- **Lifetime:** library assets are never removed automatically. Deleting a project only unlinks its assets. Project removal (`DELETE /api/projects/[id]/assets/[assetId]`) only unlinks (409 with `usage` while the project's definition still uses the asset, `?force=1` overrides). They are removed only explicitly through `DELETE /api/assets/[id]` (409 while linked to projects, `?force=1` overrides; the file is deleted only when no other row shares its `storagePath`). Renaming is `PATCH /api/assets/[id]` (validated with `validateAssetKey`, 409 if another asset has the name). The `/assets` page has Rename/Delete with confirmation and shows "used in N projects".
- **Folders:** `AssetFolder` is a tree (`parentId`) used only for organisation. The library page supports drag-and-drop moves between folders and breadcrumbs.
- **Project link:** `Asset.projects` is a many-to-many relation. Uploading from a project's Graphics tab (`POST /api/projects/[id]/assets`) stores the file in the library and links it. `AssetPicker` (`src/components/AssetPicker.tsx`) browses the whole library and links on pick (`POST /api/projects/[id]/assets/[assetId]`); it is used by "Add from library" (Graphics and Voiceover tabs) and by "Choose from library" in the graphics editor's image layer. The editor's quick list shows only **linked** assets, and it stores the image `src` as `/api/projects/<projectId>/assets/<assetId>`.
- **Rendering:** one link policy for every asset type: a library asset that the definition refers to (by `assetKey`, by `id` or by its project URL; image layers, overlay `imageAsset`, slate `backgroundImage`, audio clips, podcast intro/outro) is **linked to the project automatically** (`linkReferencedAssets`, `src/lib/asset-link.ts`). `POST /generate` does it before queuing and returns `autoLinkedAssets` (keys); the worker does it again at render time and writes an INFO job log, so definitions edited after queuing are covered too. The worker then builds `assetPaths` from the project's linked assets, keyed by `assetKey`, by `id` and by that project URL (audio is also read by id from the whole library). A reference that matches nothing in the library is still skipped, and reported: `findUnresolvedImageRefs` (`src/domain/asset-usage.ts`) feeds `assetWarnings` in the generate response and a WARN job log. Because a referenced asset is relinked on the next render, unlinking it from a project only sticks once the definition no longer uses it (`DELETE .../assets/[assetId]` already answers 409 with `usage` until then). Uploading bytes that are already in the library reuses that asset and its key; the response says `reused: true` and `requestedKey` when the name asked for was not applied.
- **Types:** `OVERLAY | BACKGROUND | LOGO | FONT` is a label only; the renderer treats every type the same. `FONT` cannot actually be uploaded because uploads accept images and audio only. `AUDIO` is set automatically for audio files.

### Captions and export formats
Captions come from the active `TranscriptSegment`s of each source (see `docs/transcription-editor-contract.md`). Source-level export is `GET /api/sources/[id]/captions.vtt|.srt`. Composition-level (soft) captions are a render option:

- **Request:** `POST /api/projects/[id]/generate` accepts `captions: { mode: "none" | "soft" | "burn" | "both", language?, styleGraphicId? }` (Zod: `captionOptionsSchema` in `src/domain/captions.ts`; modes `none | soft | burn | both`, plus `styleGraphicId` for burned captions, see below). It is stored in `MediaJob.parameters.captions` and read by the worker (`readCaptionOptions`, `src/worker/captions.ts`). The UI selector is on the Generate panel.
- **Timing:** `mapCaptionsToTimeline` (`src/renderer/caption-timeline.ts`, pure) puts each source's segments on the output timeline: per source-clip it keeps overlapping segments, clips them to the clip range and shifts by the clip's output start (`layoutTimeline`, `src/domain/timeline.ts`, is the one layout that `buildCompositionRenderPlan` and `buildPodcastRenderPlan` also use: crossfades pull the next item back by the transition, standalone slates take time and carry no cues, overlays take none). Output cues never overlap (an earlier cue is cut where the next starts), because mov_text cannot hold overlapping cues.
- **Soft mode:** the worker writes `<output>.srt`/`.vtt`, passes the SRT to `buildCompositionRenderPlan(..., { captions: { path, language } })` (extra last `-i`, `-map N:0 -c:s mov_text -metadata:s:s:0 language=<iso639-2>` appended after the video/audio maps), and stores two extra `Output` rows of type `CAPTIONS_SRT` / `CAPTIONS_VTT` (with `Output.language`) beside the `VIDEO` row. Previews get them too (`preview = true`). No transcript in range = render without a track (WARN job log).
- **Downloads:** `GET /api/outputs/[id]` picks extension/mime from the output type (`outputExtension`, `CAPTION_MIME` in `src/domain/captions.ts`). A `Range` header or `?inline=1` returns a seekable `rangedFileResponse` (206, no attachment header); the podcast player uses `?inline=1`.
- **YouTube:** after a successful video upload `processPublication` uploads the job's SRT sidecar with `captions.insert` (`uploadCaptionToYouTube`, `src/worker/caption-publish.ts`). Fails soft (WARN JobLog + console). Needs the `youtube.force-ssl` OAuth scope, which `youtube-oauth.ts` now requests; connections made earlier must be reconnected for caption upload to work (the video upload is unaffected). `captions.insert` costs 400 API quota units.
- **Not covered:** captions in the legacy no-items render path.

#### Burned-in captions (`mode: "burn"` or `"both"`)
- **Caption style = a graphic with a `caption` layer.** `graphicLayerSchema.type` gained `"caption"` (`src/domain/graphics.ts`): a placeholder text box (sample text `Esimerkkiteksti`) whose x/y/width/height (graphic coordinates, 1920x1080 by default) is the area captions are laid out in, and whose `style` map holds the look: `font-family`, `font-size`, `font-weight`, `color`, `text-align`, `vertical-align` (top|middle|bottom; text is anchored to that edge of the box), `background` (box colour, rgba ok), `padding`, `text-shadow` (2nd number = depth), `-webkit-text-stroke` (outline), `max-lines`, `opacity`. `src/domain/caption-style.ts` holds the helpers (`isCaptionStyleGraphic`, `createCaptionGraphic`, `captionStyleFromGraphic` which scales to the video size, and the built-in default: bottom centre, 56 px bold white on `rgba(0,0,0,0.6)`, 2 lines, DejaVu Sans). No schema migration: old graphics/packages are unchanged and a graphic without a caption layer is simply not a caption style. A caption layer inside a graphic that is used as a slate/overlay is ignored by the renderer.
- **Reuse:** graphics stay project-local (`definition.graphics`), so a style is reused within a project by `styleGraphicId`, across projects with the existing graphic export/import routes (`.svgraphic`; import assigns a new id) and by project duplication. No new table or global library. Older SaarnaVideo versions reject packages containing a caption layer (their layer type enum does not know it).
- **Editor:** "＋ Caption" in the graphics toolbar and "New caption style" (Graphics tab and the Generate panel) create a graphic pre-filled with a caption layer. The Generate panel lists caption styles in a picker (default = built-in style); fast previews use the same selection.
- **Render:** the worker (`prepareCaptions`, `src/worker/index.ts`) maps transcript cues onto the output timeline (same `mapCaptionsToTimeline` as soft captions), wraps them (`src/renderer/caption-wrap.ts`: greedy word wrap by character budget, width estimated as `fontSize * 0.55` per character (`0.6` bold) - an approximation for DejaVu Sans, slightly conservative; a cue needing more than `max-lines` (also limited by box height) is split into consecutive pages whose times tile the cue in proportion to their length), writes `<output>.ass` (`src/renderer/ass.ts`, PlayRes = video size) and `buildCompositionRenderPlan(..., { burnedCaptions: { assPath, fontsDir } })` appends `ass=filename=...` after overlays and slates, before the preview downscale (the `preview: { width: 640 }` render option appends the downscale afterwards, so caption size scales with the picture). The ASS file is deleted after the render. libass is required (`ffmpeg -filters | grep ' ass '`; the Dockerfile.worker build checks it); there is no drawtext fallback. A background colour is one drawn rectangle (box width, height by line count, bottom/top anchored), not libass' per-line box.
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
- **YouTube e2e:** `e2e/fake-youtube-server.ts` fakes the Google token endpoint and the resumable video/caption/thumbnail uploads; the worker and server reach it through `YOUTUBE_API_BASE_URL` and `YOUTUBE_OAUTH_TOKEN_URL` (test-only overrides, defaults are Google). `e2e/youtube.e2e.test.ts` covers the OAuth round trip, token refresh, privacy mapping and the soft failure of thumbnail and caption uploads (the video is already on YouTube by then, so they never fail the publication). Never verified against real Google.
- Output lookups (publish route, worker thumbnail/sidecar) do not filter on `expiresAt`: media is persistent and `expiresAt` is unused, so such a filter matched nothing.

### Voiceover and podcast
Audio lives in the same asset library as images: `Asset.type = AUDIO` (label; `Asset.durationMs` is probed with ffprobe on upload, `src/integrations/audio-assets.ts`: mp3/m4a/wav/ogg/webm, `MAX_AUDIO_ASSET_SIZE_BYTES` default 200 MB). `POST /api/assets` and `POST /api/projects/[id]/assets` detect audio by MIME/extension and force type AUDIO (`readAudioUpload`/`storeAudioAsset` in `src/app/api/_lib/assets.ts`). Browser recordings (`audio/webm;codecs=opus`, no duration in the header) get their duration by decoding once. The `/assets` page shows audio tiles with a player.

- **Timeline item `audio-clip`** (`audioClipSchema`, `src/domain/project.ts`): `assetId`, trim `startSeconds`/`endSeconds` (of the audio file, so length is known without probing), `volume`, `mode`. `standalone` = a base item taking time in sequence (like a slate: `isBaseItem`/`baseItemDuration`; `layoutTimeline` and therefore soft/burned caption alignment include it, it carries no cues). `mix` = layered from `atSeconds` (video-timeline seconds), takes no time, `duckSourceVolume` lowers the source audio during it. Optional `graphicId`/`backgroundImage`/`data` give a standalone clip's video picture (built as a slate; default = template background colour). Definitions are stored without schema defaults, so the renderer applies them itself.
- **Video render** (`buildCompositionRenderPlan`): standalone clip = slate-like picture + `audioClipFilter` (trim, pad/cut to exact length); mixes = `audioMixFilters` (`adelay` + `amix normalize=0`, ducking via `volume` with `eval=frame`) after the concat. Audio assets are found in `assetPaths` by **asset id** and, unlike images, are loaded from the whole library by the worker (`referencedAudioAssetIds`), not only project-linked assets.
- **Podcast**: `definition.podcast` (`podcastSettingsSchema`: `introAssetId`, `outroAssetId`, `format` mp3|m4a, `channels`, `crossfadeSeconds`, tags) is saved with the project (optional, old definitions unchanged). `POST /generate {type:"PODCAST", podcast?}` creates a `MediaJob` of type `PODCAST` (no thumbnail job); the worker (`runPodcastJob`, `src/worker/index.ts`) renders the body once to a temporary WAV (`buildPodcastRenderPlan` with `bodyOnly`, `src/renderer/podcast.ts`: sources, voiceovers, mixes and range, no intro/outro; deleted afterwards), then builds a loudnorm measure pass and a linear second pass to -16 LUFS / -1.5 dBTP on that file (`bodyWav`), so the source video is decoded once, output `Output.type = AUDIO` (`audio/mpeg` or `audio/mp4`, extension via `outputExtension(type, mimeType)`). Body = base items in order minus standalone slates (silent, skipped); mixes are moved earlier by the slate time removed before them. Intro/outro are podcast-only: `[intro] acrossfade [body] acrossfade [outro]` (0 = concat), downmixed to mono (default) or stereo, 44.1 kHz, libmp3lame 96k/128k or AAC. Tags via `-metadata` with `-map_metadata -1` (title = project title, artist = preacher, comment = gospelRef, date = today, album from settings), cover art = latest THUMBNAIL output as attached picture (skipped, with an INFO log, when none exists yet). No RSS feed.
- **Range**: `podcast.startSeconds/endSeconds` are seconds of the podcast body (composition audio without slates, before intro/outro). `buildPodcastRenderPlan` trims the body (`atrim`) after the mixes and before intro/outro; `podcastBodyRange` clamps to the body and throws when nothing is left; `podcastBodySeconds`/`podcastDuration` (`src/lib/duration-report.ts`) account for it. The API keeps both optional (no range = whole body); the UI requires both before it queues a podcast, and intro/outro default to none.
- **UI**: the "Ääni" panel of step Rakenne (`VoiceoverPanel.tsx`: MediaRecorder record/stop/preview/re-record/save, file upload, project audio list with "Add as section" / "Mix over video") and the "Podcast" panel of step Julkaisu (`PodcastPanel.tsx`: required start/end, optional intro/outro from the library, format, channels, crossfade, tags, generate, player + download). `CompositionEditor` shows audio in the resource bin: drop between sections = standalone clip, drop into a section = mix at that section's start.
- **Tests**: unit `src/domain/audio-clip.test.ts`, `src/renderer/podcast.test.ts`, `caption-timeline.test.ts`, `ffmpeg.test.ts`, `src/worker/podcast.test.ts`, `src/integrations/audio-assets.test.ts`; `e2e/voiceover-podcast.e2e.test.ts` (sine-tone fixtures, segment order by Goertzel, duration, ID3 tags, cover art, ebur128 loudness, caption alignment, ducking).

### Output size, reframing and duration notices
- **Size:** `definition.template.width/height` (even, 128-7680; `evenDimension`, `src/domain/output-presets.ts`) is the rendered frame; nothing assumes 1080p. `OUTPUT_PRESETS` is the single table of presets (YouTube 1080p/720p/4K, Shorts, Reels, Facebook Reels, TikTok, Stories, square 1:1, portrait 4:5) with optional platform `maxSeconds`; `template.presetKey` records the choice (several presets share a size). Odd or out-of-range sizes and invalid reframes are rejected with 400 on `PATCH /api/projects/[id]` and on generate (`validateRenderSettings`, `src/domain/render-settings.ts`).
- **Design canvas:** graphics, caption styles and legacy overlay pixel values (`x`, `y`, `width`, `height`, `data.fontSize`) are authored at `DESIGN_CANVAS` (1920x1080). The renderer scales positions per axis (`sx`, `sy`) and sizes/fonts/image overlays by `min(sx, sy)`. At 1920x1080 nothing changes. Slate titles were already relative to the height. Caption styles scale through `captionStyleFromGraphic`.
- **Reframe** (`src/domain/reframe.ts`): `{ mode: "fill" | "fit" | "custom", crop?: {x,y,w,h} (0..1 of the source), fitBackground: "blur" | "color" }`. `fill` (default) covers the frame and cuts the overflow; `custom` crops the rectangle first and then covers (a rectangle with another aspect is still centre-cut, never stretched); `fit` shows the whole picture with a blurred enlarged copy (`blur`) or the template background colour (`color`) around it. Resolution order (`resolveReframe`): the clip's own `reframe` > the `reframe` of the section it was made from (same source, clip range inside the section range) > `template.reframe` > `fill`. `sourceVideoFilters` (`src/renderer/ffmpeg.ts`) builds it without probing the source (`iw`/`ih` expressions). Previews keep the aspect (`scale=640:-2`).
- **Segment format:** every base segment is passed through `fps=<template fps>,settb=AVTB,format=yuv420p` (labels `vnN`) before transitions, because `xfade` refuses inputs whose time base or frame rate differ (a source keeps e.g. 1/12800, a `concat` output is 1/1000000), which made any crossfade after an earlier cut or slate fail.
- **Duration notices** (`src/lib/duration-report.ts`, pure): `computeDurationReport(definition, audioDurations)` returns video and podcast length (podcast leaves out standalone slates and adds intro/outro minus crossfades) and warnings: `over-platform-limit` (preset `maxSeconds`), `off-target` (`template.targetSeconds`, tolerance max(3 s, 5 %)), `podcast-differs` (> 10 s). Warnings never block; `POST /generate` returns them as `durationWarnings`.
- **Tests:** unit `reframe.test.ts`, `output-presets.test.ts`, `render-settings.test.ts`, `duration-report.test.ts`, `ffmpeg.test.ts`; `e2e/reframe.e2e.test.ts` (fixture `split.mp4`: left half red, right half green) checks the crop, fit, section/clip override and exact sizes by pixel colour and ffprobe.

### Project workspace UI (quick publish and three steps)
`src/components/workspace/` (state and handlers in `useWorkspace.tsx`, one component per step: `SourceStep`, `StructureStep`, `PublishStep`; `OpenProject` has the header and step bar; `WorkspaceStyles` still holds the page's global `<style jsx global>` rules; self-contained pieces already use CSS modules: `TimelineView`, `VariablesEditor`, `FetchVariables` and the step bar of `OpenProject`, so new styles go into a `*.module.css` next to the component) groups the project into three steps (all interface text goes through `useT()`, see "Interface language"):
- **Pikajulkaisu** (`QuickStep.tsx`, step `quick`, first in the step bar and the landing step of a newly created project; existing projects open on Lähde): one page with five cards using the same handlers as the detailed steps: source (YouTube link or file), title plus `FetchVariables` and the variables editor, sections ("Käytä koko tallennetta" adds the whole source as one section via `addSegment`, with a manual duration field when the duration is unknown; otherwise a link to Rakenne), caption mode with preview/final render and job progress, and `PublishPanel`. `generate`/`previewRender` keep the user on this step when it is active (otherwise they jump to Julkaisu).
- **Lähde:** sources (one or more), transcriptions, output size (OutputSettings) and project info: title plus **project variables**.
- **Rakenne:** source sections (each root section has a source picker when the project has several sources, plus Reframe), graphics, voiceover audio, and the timeline: `TimelineView` (overview) above `CompositionEditor` (editing); composition sections are folded under "Koostuksen omat osiot".
- **Julkaisu:** render (captions mode, preview, final), outputs, publishing and podcast.
- **Section source change** (`changeSectionSource`) moves the section and its subsections, the matching `semanticSegments` and the source clips cut from them (same source + range) to the new source.
- **Timeline orientation:** horizontal at >= 760 px, vertical (lanes as columns) below; the viewer can switch and the choice is kept in `localStorage` (`saarnavideo.timelineOrientation`). Overlay blocks use the same placement as the renderer (`overlayOutputRange`, below).
- **Overlay timing:** an overlay dropped into a section in `CompositionEditor` stores `sectionId` and `startSeconds/endSeconds` in that section's **source** seconds. At render time `anchorSectionOverlays` (`src/renderer/overlay-timing.ts`, applied in `buildCompositionRenderPlan` after `materializeGraphics`) moves it onto the output timeline: it follows the source clip cut from the section (same source + range, else the first clip of that source containing its start), so it stays on the same moment when sections are reordered, and is cut to the clip; if the section or clip is gone it is left out. Overlays without `sectionId` (API, legacy) stay in output seconds. Voiceover mixes (`atSeconds`) are output seconds.
- Below 760 px the sidebar stacks above the workspace and the inner grids collapse to one column.

### Project variables
`definition.variables` (`[{ key, value }]`, `src/domain/variables.ts`) are user-defined; nothing about the service (preacher, Gospel reference) is predefined. Graphics write `{{name}}` in text layers; `materializeGraphics` (`src/renderer/composition.ts`) fills them in graphic layers, inline `data.layers` and plain `data` text (title/subtitle/text) at render time. Unknown names stay as written so a missing value shows. Keys: letters (incl. ä/ö/å), digits, `-`, `_`, max 40, unique; `PATCH /api/projects/[id]` rejects invalid ones (`validateRenderSettings`). The graphics editor shows the raw `{{name}}`.

### API connectors and fetched variables
`/settings` ("Asetukset" link in the root layout, `src/components/connectors/`) manages global `ApiConnector` / `ApiRequest` rows (Prisma, both schemas): base URL, auth (bearer, api key header, basic; the secret is stored but never returned, only `hasSecret`), free headers, and requests with `{{name}}` placeholders and JSONPath mappings to project variable names. Execution is `varfetch` (`fireRequest`; client code only imports its types). Domain helpers in `src/domain/connectors.ts` (Zod schemas, `mergeAuth`, masking, `networkRulesFromEnv` reading `CONNECTOR_ALLOW`/`CONNECTOR_DENY`), route helper `src/app/api/_lib/connectors.ts`. Nothing about a particular service is built in: "Lisää kirkkovuosipohja" adds a request preset for an anno-api style day endpoint (`/api/v1/date/{{paiva}}`, ASCII variable names `pyhapaiva`, `teema`, `evankeliumi`, `evankeliumiteksti`, `vari`, `jakso`, `aika`) to a connector whose address the user typed. The Lähde step's `FetchVariables` ("Hae muuttujat", service date default next Sunday as `paiva`) calls `POST /api/projects/[id]/fetch-variables`, shows old vs new values and saves only the accepted ones through `saveVariables`. Tests: `src/domain/connectors.test.ts`, `src/app/api/connectors/connectors.test.ts`.

### Rendering on an fffleet fleet
`RENDER_EXECUTOR=fffleet` (default `local`) makes the worker's `runFfmpegWithProgress` (and the thumbnail command) go through `src/worker/remote-ffmpeg.ts` instead of spawning ffmpeg. The render plans are unchanged and still use local `MEDIA_ROOT` paths: `translateFfmpegArgs` rewrites every staged path into fffleet placeholders (`{{input:inN}}`, `{{inputdir:font}}` for the template font's directory, `{{output:out}}`), `createRemoteExecutor` uploads the files to S3 (content/identity-keyed under `FFFLEET_S3_PREFIX/in/`, `.ass`/`.srt`/`.vtt` under `tmp/<jobId>/` and deleted after), submits a batch job with `requires` derived from the arguments (`deriveRequires`: `filter:ass`, `filter:drawtext`, `encoder:libmp3lame`, ...), maps fleet progress onto the job's progress range, and downloads the output back to the plan's local output path. A plan that still mentions `MEDIA_ROOT` after translation fails the job. The podcast loudness pass gets `-loglevel info` because the fleet's default (`warning`) hides loudnorm's JSON; the fleet returns ffmpeg's stderr tail for `parseLoudnormMeasurement`. Without `FFFLEET_URL` (or when the fleet is unreachable) the same job runs in an in-process fffleet runner with the same S3 staging. Config: `FFFLEET_URL`, `FFFLEET_TOKEN` or `FFFLEET_CLIENT_ID`/`FFFLEET_CLIENT_SECRET`, `FFFLEET_S3_BUCKET`, `FFFLEET_S3_PREFIX`, `FFFLEET_S3_ENDPOINT`, `AWS_*`. TRANSCRIBE and the audio ffprobe stay local; DOWNLOAD can go to the fleet separately, see below. Cancelling a running render stops ffmpeg (SIGTERM locally, `RemoteExecutor.cancel` on the fleet) and ends the job as CANCELLED (`watchCancel`, `JobCancelled` in `src/worker/index.ts`). Tests: `src/worker/remote-ffmpeg.test.ts` (translation, and real ffmpeg through an in-process fleet and a disk "bucket").

### yt-dlp downloads on an fffleet worker
`DOWNLOAD_EXECUTOR=fffleet` (default `local`: `downloadYouTubeSource` spawns yt-dlp in the worker, unchanged) sends a DOWNLOAD job's yt-dlp run to a fleet worker as a batch job of type `download`. Same fleet settings and S3 staging as renders (`FFFLEET_*`, `AWS_*`; `readRemoteConfig(env, "DOWNLOAD_EXECUTOR")`).
- **Executor:** `fleet/download-executor.mjs` is plain ESM with no dependencies (no build step), default-exporting `{ type: "download", run }`. Payload `spec.download = { url, format?, extraArgs? }` (http(s) only; `extraArgs` refuses `--exec`, `--output`, `--cookies`, config/plugin/file options). Optional input `cookies` is staged by the executor itself (s3:, http(s):, file:) and **copied into the job's work dir**, because yt-dlp rewrites the cookie file. Output `video` gets the mp4 (s3:, file: or http PUT); optional output `cookies-out` is uploaded only if the cookie file changed. Progress comes from yt-dlp's `[download] N%` lines; `rt.signal` abort sends SIGTERM (SIGKILL after 5 s). Cookie contents never reach logs or errors: `scrub` removes the cookie path, cookie values and tab-separated cookie lines from stderr, and the stderr tail is dropped on success. `YTDLP_PATH` overrides the binary (default `yt-dlp` on PATH). The generic fffleet repo must not mention this app; the executor lives here.
- **Worker image:** `Dockerfile.fleet-worker` = published `ghcr.io/jsilvanus/fffleet-worker` + python3 + yt-dlp + the executor, `FFFLEET_EXECUTORS` set (not built or pushed from CI yet). `Dockerfile.worker` also copies `fleet/` because the in-process fallback imports the executor.
- **App side:** `src/worker/remote-download.ts` (`createRemoteDownloader`): uploads nothing but the cookie file, submits the job, copies the video from S3 to the local `sources/<project>/<videoId>.mp4`, and deletes everything it staged under `FFFLEET_S3_PREFIX/tmp/<jobId>/` (cookie copy, `cookies-out`, temp video). Without `FFFLEET_URL`, or when the fleet is unreachable, the same executor runs in-process (`fallback: "local"`, needs yt-dlp on the worker host). Cancelling goes through `watchCancel` to `RemoteDownloader.cancel` and ends the job as CANCELLED.
- **Cookies:** stored in the `YtDlpCookies` table (singleton, AES-256-GCM via `youtube-token-crypto`, `cookieCount` kept so status needs no decrypt) and managed on `/settings` ("YouTube cookies", `YouTubeCookiesSettings`) through `GET/PUT/DELETE /api/integrations/youtube/cookies`; the text is write-only, only `{configured, source, cookieCount, updatedAt, envFallback}` comes back. `withDownloadCookies` (`src/integrations/ytdlp-cookies.ts`) wraps the download in `processDownload` for both executors: DB cookies are decrypted into a private temp file for the run, passed to yt-dlp (`--cookies` locally, staged copy on the fleet), saved back re-encrypted if yt-dlp rewrote them, and the temp file is always removed; `YTDLP_COOKIES_FILE` is the fallback when the DB has none (used in place, fleet write-back goes to that file). Needs `YOUTUBE_TOKEN_ENCRYPTION_KEY` (PUT answers 503 without it) and `prisma db push`. Tests: `src/integrations/ytdlp-cookies.test.ts`.
- **Tests:** `fleet/download-executor.test.ts` (fake runtime, fake `yt-dlp` on PATH from `fleet/fake-ytdlp.test-helper.mjs`: cookie copy, no leaks, updated cookies, abort kills, exit errors, payload validation) and `src/worker/remote-download.test.ts` (in-process fleet and disk bucket). Never run against a real fleet or real YouTube.

### Transcription staging in S3
`AUDITOR_STT_FETCH=s3` (default `upload`) changes only how a TRANSCRIBE job hands its audio to the auditor service: `src/worker/transcription-staging.ts` puts the 16 kHz mono WAV (the whole source is extracted too, not only partial ranges) in `FFFLEET_S3_BUCKET` under `<prefix>/tmp/<jobId>/`, `presignGetUrl` (`src/worker/s3-presign.ts`, SigV4 query auth) makes a one-hour URL, `AuditorSttClient.submitUrl` posts it as `source_url`, and the object is deleted as soon as the submit call returns (the service downloads before it answers). The service needs `AUDITOR_STT_SOURCE_URL_HOSTS`. Polling, resume and range-offset handling are unchanged. Tests: `s3-presign.test.ts` (AWS documentation vector), `transcription-staging.test.ts`, `auditorStt/client.test.ts`.

### Worker lanes
The worker loop (`main`, `src/worker/index.ts`) claims queued `MediaJob`s and runs up to `MAX_CONCURRENT_JOBS` at a time: default 1, or 4 when `RENDER_EXECUTOR=fffleet` (a local ffmpeg already uses the machine's cores, a fleet does not). Publications (`processPublication`) run in their own lane, so a slow Facebook upload cannot hold up renders.

### Template System
A template seeds a new project; afterwards the project is ordinary data and nothing refers back to the template. Details and the API are in `docs/TEMPLATE_CREATION.md`.
- **Built-in** (`src/domain/templates.ts`): `sermon` (Saarna), `liturgy` (Messu, 17 sections in the order of the Mass), `vespers` (Iltahartaus), `short-vertical` (Shorts size, 60 s target). Finnish content for the Evangelical Lutheran Church of Finland. A template is output settings (`OUTPUT_PRESETS` key, fps, target length, reframe), variable names, graphic specs (`title-card`, `lower-third`, `caption-style`), an opening and ending slate, `sectionOverlays` (graphic put on a new section whose name matches) and suggested section names. `applyTemplate` builds the `ProjectDefinition`; `applyTemplateByKey("basic")` is null (blank project).
- **Saved** (`UserTemplate` table, `src/domain/saved-templates.ts`): "Tallenna pohjaksi" in the Lähde step captures a project's structure without sources, clips or sections (`captureTemplate`); `applySavedTemplate` gives fresh graphic ids. `GET/POST /api/templates`, `DELETE /api/templates/[id]`; `POST /api/projects` takes `templateKey` or `userTemplateId`.
- **Section flow:** `addSourceSection` (`src/domain/templates.ts`) is what the Structure step calls when a section is added: it adds the section, its segment and clip (before `template.endingGraphicId` while that slate is still the last base item) and the template's overlay for that section name. `template.sectionNames` feeds the "Pohjan osiot" button of the section manager.
- The renderer does not know templates; it only sees the definition they produced.

### Job lifecycle
A `MediaJob` goes QUEUED → RUNNING → COMPLETED, FAILED or CANCELLED. While RUNNING the free-text `phase` and `progress` fields tell where it is (for example DOWNLOADING, EXTRACTING_RANGE, SUBMITTING, ANALYSING, ENCODING, COMPLETE); a render reports progress from ffmpeg's output. The worker claims QUEUED jobs, writes `JobLog` rows, stores `Output` rows on success and the error message on failure.

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
- Sources and outputs are persistent (no expiry)

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
- `PATCH /api/projects/[id]` - Update project
- `DELETE /api/projects/[id]` - Delete project
- `POST /api/projects/[id]/duplicate` - Clone project
- `POST /api/projects/[id]/generate` - Queue generation job (`type`: VIDEO, PREVIEW, THUMBNAIL or PODCAST)
- `POST /api/projects/[id]/publish` - Queue YouTube or Facebook publication
- `GET /api/projects/[id]/publications` - Publications only (polled by the publish panel)
- `GET/POST /api/templates`, `DELETE /api/templates/[id]` - Built-in and saved templates

### Sources
- `POST /api/projects/[id]/source` - Add source to project
- `DELETE /api/projects/[id]/source/[sourceId]` - Remove source
- `GET /api/sources/[sourceId]` - Get source details
- `DELETE /api/sources/[sourceId]` - Delete source directly

### Asset library (global)
- `GET /api/assets` - List all library assets (with `projectCount`) and folders
- `POST /api/assets` - Upload an image into the library (multipart: `file`, `assetKey`, optional `type`, `folderId`)
- `GET /api/assets/[id]` - Serve the image file
- `PATCH /api/assets/[id]` - Move to a folder (`folderId`) or rename (`assetKey`, validated; 400 invalid, 409 duplicate)
- `DELETE /api/assets/[id]` - Delete from the library; 409 while linked to projects unless `?force=1`
- `GET/POST /api/assets/folders` - List / create folders (`name`, `parentId`)
- `PATCH /api/assets/folders/[id]` - Rename or move a folder (cycle-checked)
- `DELETE /api/assets/folders/[id]` - Delete a folder; its assets and subfolders move to the parent

### Project assets
- `GET /api/projects/[id]/assets` - List assets linked to the project
- `POST /api/projects/[id]/assets` - Upload an image and link it to the project (deduplicated into the library)
- `GET /api/projects/[id]/assets/[assetId]` - Serve a linked asset (this URL is what graphics store as image `src`)
- `POST /api/projects/[id]/assets/[assetId]` - Link an existing library asset to the project
- `DELETE /api/projects/[id]/assets/[assetId]` - Unlink only (never deletes the library asset); 409 with `usage` if still referenced, `?force=1` overrides

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
- Errors stored in MediaJob.error

### Media retention
Project media (sources, outputs, assets) is persistent; nothing expires and the worker runs no cleanup. The `expiresAt` columns in the schema are legacy and unused; nothing reads or writes them. Files are removed only by explicit deletes (project, source, asset).

### Type Safety
- Full TypeScript coverage (no `any` without reason)
- Zod schemas derive types for compile-time checking
- React components typed with React.FC or explicit return types

---

## Open work
See `Consider.md` (refactor backlog), `docs/plan.md` (roadmap) and the "not implemented" notes in the sections above.

---

## Common Debugging

### Worker Not Processing Jobs
1. Check worker is running: `npm run worker`
2. Verify database connection and environment variables
3. Check job status: `GET /api/projects/[id]/jobs/[jobId]`
4. Review the job's `JobLog` rows

### FFmpeg Failures
1. Verify FFmpeg installed: `which ffmpeg`
2. Check source file exists and is readable
3. Review FFmpeg command in job logs
4. Test FFmpeg command directly in terminal

### Media Upload Issues
1. Check file permissions and disk space
2. Verify MIME type is supported (video/audio)
3. Review upload size limits in the upload routes (`src/app/api/_lib/assets.ts`, `src/app/api/projects/[id]/source`)
4. Check storage path configuration

### Database Issues
1. Verify PostgreSQL running: `docker compose ps`
2. Check DATABASE_URL environment variable
3. Reset with: `npx prisma db push --skip-generate --force-reset` (dev only)
4. Review Prisma logs: `DEBUG=* npm run dev`

---

## File Size Notes
- Large media files are persistent; plan disk space accordingly
- Sources, outputs and library assets live under `MEDIA_ROOT` (default `./data/media`)
- Asset images and audio are stored permanently as content-addressed files in the library

---

## Contact & Maintenance
- See `docs/plan.md` for roadmap
- See `docs/technical-phase-plan.md` for implementation strategy
- Review `docs/API.md` for endpoint details

---

## Interface language (fi, en, sv)
The whole UI is available in Finnish (default), English and Swedish. The language is the `saarnavideo-lang` cookie set by the switcher in the top bar (`LanguageSwitcher`); without it the browser's `Accept-Language` decides, Finnish when unsupported. `layout.tsx` reads it (`getServerLocale`), sets `<html lang>` and wraps the app in `I18nProvider`; client components call `const t = useT()` and `t("area.key", { name })`; server components use `makeT(await getServerLocale())`.
- **Messages:** `src/i18n/messages/fi.ts` is the source; `en.ts` and `sv.ts` are typed `Record<keyof typeof fi, string>`, so a missing key is a compile error. `MessageKey` is derived from `fi` (plural suffixes stripped). `{name}` placeholders are filled from the params; an unknown placeholder stays as written. Plurals: define `key_one` and `key_other` and pass `count`; the form comes from `Intl.PluralRules`. Missing text falls back to Finnish, then to the key.
- **Adding text:** add the key to all three files (same placeholders), then use it. `src/i18n/i18n.test.ts` checks key parity, placeholder parity and plural pairs.
- **Dynamic keys** (job status, publication status, animation names) are built as `` `jobStatus.${status}` `` and cast to `MessageKey`; check the key exists first when the value can be unknown (`jobStatusLabel`).
- **Not translated:** error text returned by API routes (`error` fields), server-side warnings (`assetWarnings`), job logs and the docs. `computeDurationReport` warnings carry `params` so the UI renders them itself (`DurationNotice`), the `message` stays English for API clients. Church and template content (built-in templates, church-year variable names) is Finnish by design and is not part of the UI language.
- **Output language is separate:** the language of captions/transcription is chosen per run (`tr.language`), not by the interface language.
