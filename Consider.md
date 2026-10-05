# Consider

Cleanups found by the `/simplify` review of #23 that were **not** done in #25 (and not in the follow-up that did the small ones: WebM duration by remux, `GET /api/projects/[id]/publications` for polling, Range support for outputs and `?type=AUDIO` for the library, burn-only captions skipping SRT/VTT formatting, publications in their own worker lane (old #4), the duplicate-route retention leftover and most repeated e2e helpers), because they are larger refactors, change behaviour, or could not be verified in the environment where the review ran. Each entry says where the issue is, what it costs, and the suggested fix.

## Efficiency

### 5. Uploads are still parsed into memory by `request.formData()`
- **Where:** both upload routes (`src/app/api/assets/route.ts`, `src/app/api/projects/[id]/assets/route.ts`).
- **Done:** audio is no longer copied again: `readAudioUpload` streams the file into a temporary file while hashing it, and the library file is a rename (`src/app/api/_lib/assets.ts`).
- **Remaining cost:** `formData()` itself holds the whole multipart body, so a 200 MB upload still takes about 200 MB of heap per concurrent upload.
- **Fix:** parse the multipart stream incrementally (for example `busboy`, a new dependency) or accept a raw body (`PUT` with the file as body and the name in the query) for audio, and stream `request.body` into the temporary file.

## Consistency

### 8. Repeated e2e helpers
- **Where:** `e2e/captions-burned.e2e.test.ts` (its own `generate`, which also downloads the video), `e2e/voiceover-podcast.e2e.test.ts` (`ffprobeJson`, which overlaps `probe()` in `e2e/helpers.ts` but reads more fields).
- **Fix:** let the burned-captions `generate` call the shared one and download afterwards; extend `probe()` with format tags and attached-picture disposition and drop `ffprobeJson`.
