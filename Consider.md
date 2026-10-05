# Consider

Cleanups found by the `/simplify` review of #23 that were **not** done in #25 (and not in the follow-up that did the small ones: WebM duration by remux, `GET /api/projects/[id]/publications` for polling, Range support for outputs and `?type=AUDIO` for the library, burn-only captions skipping SRT/VTT formatting, publications in their own worker lane (old #4), the duplicate-route retention leftover and most repeated e2e helpers), because they are larger refactors, change behaviour, or could not be verified in the environment where the review ran. Each entry says where the issue is, what it costs, and the suggested fix.

## Structural

### 2. One rule for which assets a render may use
- **Where:** `src/worker/index.ts` (`runFfmpegJob` asset map, `runPodcastJob`), `src/worker/podcast.ts` (`referencedAudioAssetIds`), `src/domain/asset-usage.ts` (`findAssetUsage`/`refersToAsset`).
- **Cost:** images come only from assets linked to the project, keyed three ways, and an unlinked one is silently skipped. Audio comes from the whole library, by id. The reference forms and places are listed in three spots, so each new reference site needs a new special case in the worker.
- **Fix:** add a `collectAssetRefs(definition)` next to `findAssetUsage` and one worker `resolveAssetPaths(definition, project)` that loads every referenced asset and keys the map by the original ref strings. Pick one link policy for all types: either auto-link an asset when a project references it, or allow the whole library. Use it in the video job, the podcast job and the generate-route validation.
- **Size:** medium, about 60 lines. It changes behaviour for unlinked images.

## Efficiency

### 5. Uploads are still parsed into memory by `request.formData()`
- **Where:** both upload routes (`src/app/api/assets/route.ts`, `src/app/api/projects/[id]/assets/route.ts`).
- **Done:** audio is no longer copied again: `readAudioUpload` streams the file into a temporary file while hashing it, and the library file is a rename (`src/app/api/_lib/assets.ts`).
- **Remaining cost:** `formData()` itself holds the whole multipart body, so a 200 MB upload still takes about 200 MB of heap per concurrent upload.
- **Fix:** parse the multipart stream incrementally (for example `busboy`, a new dependency) or accept a raw body (`PUT` with the file as body and the name in the query) for audio, and stream `request.body` into the temporary file.

### 6. The podcast reads the full source video twice
- **Where:** `buildPodcastRenderPlan` in `src/renderer/podcast.ts`, run twice by `runPodcastJob` (loudness measure pass and encode pass).
- **Cost:** multi-GB sermon videos are demuxed twice to get a few hundred MB of audio. `atrim` decodes audio from time 0 up to each clip's start.
- **Fix:**
  - Cheapest: add input-side `-ss`/`-t` per clip.
  - Better: render the body once to a temporary WAV or FLAC, then run the loudnorm measure and encode passes from that file.

## Consistency

### 8. Repeated e2e helpers
- **Where:** `e2e/captions-burned.e2e.test.ts` (its own `generate`, which also downloads the video), `e2e/voiceover-podcast.e2e.test.ts` (`ffprobeJson`, which overlaps `probe()` in `e2e/helpers.ts` but reads more fields).
- **Fix:** let the burned-captions `generate` call the shared one and download afterwards; extend `probe()` with format tags and attached-picture disposition and drop `ffprobeJson`.
