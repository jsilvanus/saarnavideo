# Consider

Cleanups found by the `/simplify` review of #23 that were **not** done in #25 (and not in the follow-up that did the small ones: WebM duration by remux, `GET /api/projects/[id]/publications` for polling, Range support for outputs and `?type=AUDIO` for the library, burn-only captions skipping SRT/VTT formatting, publications in their own worker lane (old #4), the duplicate-route retention leftover and most repeated e2e helpers), because they are larger refactors, change behaviour, or could not be verified in the environment where the review ran. Each entry says where the issue is, what it costs, and the suggested fix.

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

## Consistency

### 7. Leftovers from the retention removal
- **Where:** `src/lib/prisma.ts` (the `$extends` block that clears `expiresAt` on write and strips it from filters).
- **Cost:** nothing writes or filters `expiresAt` any more (the duplicate route no longer sets it), so the extension only hides the column.
- **Fix:** remove the `$extends` block, and optionally null the column once and then drop it from both schemas.

### 8. Repeated e2e helpers
- **Where:** `e2e/captions-burned.e2e.test.ts` (its own `generate`, which also downloads the video), `e2e/voiceover-podcast.e2e.test.ts` (`ffprobeJson`, which overlaps `probe()` in `e2e/helpers.ts` but reads more fields).
- **Fix:** let the burned-captions `generate` call the shared one and download afterwards; extend `probe()` with format tags and attached-picture disposition and drop `ffprobeJson`.
