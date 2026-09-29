# Consider

Cleanups found by the `/simplify` review of #23 that were **not** done in #25, because they are larger refactors, change behaviour, or could not be verified in the environment where the review ran. Each entry says where the issue is, what it costs, and the suggested fix.

## Structural

### 1. One timeline layout for video, podcast and captions
- **Where:** `src/renderer/ffmpeg.ts` (`buildCompositionRenderPlan`, the base-item transition loop), `src/renderer/podcast.ts` (body loop with `startsBySlot`, `podcastTime`), `src/renderer/caption-timeline.ts` (`layoutTimeline`, whose doc comment says it must mirror the renderer).
- **Cost:** the cut/fade/crossfade offset math exists three times. A change to transitions has to be made in all three, or captions, ducking and podcast mixes drift away from the picture. No test ties the copies together.
- **Fix:**
  - Move `layoutTimeline` to a neutral module (for example `src/domain/timeline.ts`) and make it the only source of offsets, returning `{ item, outputStart, duration, transition, overlap }`.
  - Build the xfade/acrossfade/concat chains in both render plans from those slots.
  - The podcast runs `layoutTimeline` on the items minus standalone slates, and maps a mix's `atSeconds` through the two layouts instead of the hand-written `startsBySlot`.
  - The worker's progress `totalMs` in `src/worker/index.ts`, which uses `sourceEndSeconds - sourceStartSeconds`, and `compositionDurationSeconds` in `src/app/page.tsx` should use `timelineDuration` (currently used only by its test).
- **Size:** medium, about 100 lines. Unit tests and the caption-alignment and ducking e2e tests cover it.

### 2. One rule for which assets a render may use
- **Where:** `src/worker/index.ts` (`runFfmpegJob` asset map, `runPodcastJob`), `src/worker/podcast.ts` (`referencedAudioAssetIds`), `src/domain/asset-usage.ts` (`findAssetUsage`/`refersToAsset`).
- **Cost:** images come only from assets linked to the project, keyed three ways, and an unlinked one is silently skipped. Audio comes from the whole library, by id. The reference forms and places are listed in three spots, so each new reference site needs a new special case in the worker.
- **Fix:** add a `collectAssetRefs(definition)` next to `findAssetUsage` and one worker `resolveAssetPaths(definition, project)` that loads every referenced asset and keys the map by the original ref strings. Pick one link policy for all types: either auto-link an asset when a project references it, or allow the whole library. Use it in the video job, the podcast job and the generate-route validation.
- **Size:** medium, about 60 lines. It changes behaviour for unlinked images.

### 3. Preview render built by the renderer, not by editing the argv afterwards
- **Where:** `src/worker/index.ts` (`runFfmpegJob`, the preview block that edits `plan.args`), `src/renderer/ffmpeg.ts` (the soft-caption `-i`/`-map` placement that keeps "the preview rewrite of the first `-map`" working).
- **Cost:** the worker and the renderer depend on each other's argument positions. Every new output option has to know about the worker's rewrite.
- **Fix:** add `preview?: { width: number }` (and encode overrides) to the render plan options. The builder then appends the scale as the last video filter and picks `-preset ultrafast -crf 30` itself.
- **Size:** small to medium, about 40 lines.

### 4. Facebook publishing blocks the worker while Facebook processes the video
- **Where:** `src/worker/index.ts` (`processPublication` runs inside the single main loop), `src/worker/facebook-publish.ts`, `waitForFacebookVideo` in `src/integrations/facebook.ts`.
- **Cost:** after the upload, the worker polls every 5 s for up to 30 minutes (`FACEBOOK_PROCESSING_TIMEOUT_MS`). During that time no render, podcast or transcription job starts.
- **Fix:** after the upload finishes, store the video id and a processing state on the `Publication` and return. Check the state once per loop iteration, or run publications as a separate concurrent task. Upload the thumbnail and captions when the state becomes ready.
- **Size:** medium. It needs a publication state or column for "processing".

## Efficiency

### 5. Uploads are held fully in memory
- **Where:** `readAudioUpload` / `readImageUpload` in `src/app/api/_lib/assets.ts`, after `request.formData()` in both upload routes.
- **Cost:** an audio upload of up to 200 MB goes through a `File`, then an `ArrayBuffer`, and is hashed in memory: 200 to 400 MB of heap per concurrent upload.
- **Fix:** stream `file.stream()` into a temporary file under `MEDIA_ROOT` while updating a SHA-256 hash. Then rename it to `<hash>.<ext>`, or delete it when the hash already exists.

### 6. The podcast reads the full source video twice
- **Where:** `buildPodcastRenderPlan` in `src/renderer/podcast.ts`, run twice by `runPodcastJob` (loudness measure pass and encode pass).
- **Cost:** multi-GB sermon videos are demuxed twice to get a few hundred MB of audio. `atrim` decodes audio from time 0 up to each clip's start.
- **Fix:**
  - Cheapest: add input-side `-ss`/`-t` per clip.
  - Better: render the body once to a temporary WAV or FLAC, then run the loudnorm measure and encode passes from that file.

### 7. Cheaper WebM duration measurement
- **Where:** `probeAudioFile` in `src/integrations/audio-assets.ts`.
- **Cost:** when the header has no duration (MediaRecorder WebM), the whole recording is decoded inside the upload request.
- **Fix:** use `-map 0:a:0 -c copy -f null -` (remux only) instead of decoding. Verify that the reported `time=` matches the real duration before switching; this was not possible without ffmpeg.

### 8. Lighter polling of publications
- **Where:** `src/components/PublishPanel.tsx` together with `openProject` in `src/app/page.tsx`.
- **Cost:** every 3 s while a publication runs, the whole project is fetched (sources, jobs, outputs, assets, definition) only to update `publications`.
- **Fix:** add `GET /api/projects/[id]/publications` and poll that.

### 9. Seekable podcast audio and a filtered library request
- **Where:** `src/app/api/outputs/[id]/route.ts`, `src/components/PodcastPanel.tsx`.
- **Cost:**
  - The podcast `<audio>` player streams the output without Range support, so every seek restarts the download.
  - PodcastPanel loads the whole `/api/assets` library and filters for AUDIO in the browser.
- **Fix:**
  - Serve AUDIO outputs with `rangedFileResponse`, keeping the attachment `Content-Disposition` for downloads (for example only when a `Range` header is present, or with `?inline=1`).
  - Add a `?type=AUDIO` filter to `GET /api/assets`.

### 10. Minor
- `buildCaptionFiles` (`src/worker/captions.ts`) formats both the SRT and VTT strings even for burn-only captions, where only the cues are used.
- `prepareCaptions` loads every column of every active transcript segment of a source. Selecting only `sourceId`, `startSeconds`, `endSeconds` and `text` would be enough.

## Consistency

### 11. Retention setting left in project duplication
- **Where:** `src/app/api/projects/[id]/duplicate/route.ts` (`SOURCE_RETENTION_MS`, `expiresAt` on duplicated sources).
- **Cost:** it still writes a retention date, although media is persistent and `src/lib/prisma.ts` clears it on write. This was outside the diff under review.
- **Fix:** remove the constant and the `expiresAt` write. After that, consider removing the `$extends` block in `src/lib/prisma.ts` (and optionally nulling the column once), because nothing writes or filters `expiresAt` any more.

### 12. Repeated e2e helpers
- **Where:** `e2e/*.e2e.test.ts`.
- **Cost:**
  - `importVtt` is defined four times: in the captions, burned-captions, Facebook and transcript-text tests.
  - A `generate(projectId, body)` helper is defined three times.
  - `ffprobeJson` in the voiceover/podcast test overlaps `probe()` in `e2e/helpers.ts`.
- **Fix:** move `importVtt` and `generate` into `e2e/helpers.ts`, and reuse `probe()`.
