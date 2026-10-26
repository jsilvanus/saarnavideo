# Consider

Cleanups found by the `/simplify` review of #23 that were **not** done in #25 (and not in the follow-up that did the small ones: WebM duration by remux, `GET /api/projects/[id]/publications` for polling, Range support for outputs and `?type=AUDIO` for the library, burn-only captions skipping SRT/VTT formatting, publications in their own worker lane (old #4), the duplicate-route retention leftover and most repeated e2e helpers), because they are larger refactors, change behaviour, or could not be verified in the environment where the review ran. Each entry says where the issue is, what it costs, and the suggested fix.

## Efficiency

### 5. Library asset uploads are still parsed into memory by `request.formData()`
- **Scope:** only library images and audio. Source videos no longer pass through the app on S3 storage (direct presigned and multipart uploads, `docs/LARGE_FILE_UPLOADS.md`); on local storage they still go through `POST /api/projects/[id]/source`.
- **Where:** both upload routes (`src/app/api/assets/route.ts`, `src/app/api/projects/[id]/assets/route.ts`).
- **Done:** audio is no longer copied again: `readAudioUpload` streams the file into a temporary file while hashing it, and the library file is a rename (`src/app/api/_lib/assets.ts`).
- **Remaining cost:** `formData()` itself holds the whole multipart body, so a 200 MB upload still takes about 200 MB of heap per concurrent upload.
- **Fix:** parse the multipart stream incrementally (for example `busboy`, a new dependency) or accept a raw body (`PUT` with the file as body and the name in the query) for audio, and stream `request.body` into the temporary file.

## Consistency

### 8. Repeated e2e helpers
- **Where:** `e2e/captions-burned.e2e.test.ts` (its own `generate`, which also downloads the video), `e2e/voiceover-podcast.e2e.test.ts` (`ffprobeJson`, which overlaps `probe()` in `e2e/helpers.ts` but reads more fields).
- **Fix:** let the burned-captions `generate` call the shared one and download afterwards; extend `probe()` with format tags and attached-picture disposition and drop `ffprobeJson`.

## LCYT import: not built (PR #68)

The hand-in (`POST /api/imports/lcyt`, feed groups, keyed graphics layer) is in. These parts of `docs/plans/lcyt-import.md` were left out on purpose; each is a separate piece of work.

### 9. Scoped import token
- **Now:** LCYT authenticates with the shared `ACCESS_SECRET` as Bearer, so the same secret that opens the whole app is stored in LCYT.
- **Fix:** a separate `IMPORT_TOKEN` (or per-sender tokens) accepted only on `/api/imports/lcyt`, checked in `src/middleware.ts` next to the access gate.

### 10. Pull page
- **Now:** only LCYT pushing a manifest link works.
- **Fix:** a page in Saarnavideo where the user pastes a manifest link (or picks from LCYT) and starts the import; the route and `startLcytImport` already take `manifestUrl`.

### 11. Graphics log to Saarnavideo graphics (S4)
- **Now:** the DSK event log is only stored in `Import.summary` (first 5000 events) and shown in the Lähde step. The graphics come back only as the keyed recording.
- **Fix:** map logged events (`overlay` name and data) to graphics of the project, so a lower third can be edited or retimed as a real graphic instead of cut out of the keyed picture.

### 12. Audio auto sync (S5)
- **Now:** the offset between feeds comes from the manifest (`syncOffsetMs`) and can be nudged by hand.
- **Fix:** cross-correlate the audio of clean/program/ISO files to find the offset when the manifest has none or is off.

### 13. `s3://` references in manifests
- **Now:** only `https` links in `parts[].ref`; `s3://` is rejected by the guarded fetcher.
- **Fix:** read the object straight from the shared bucket through the media store when LCYT and Saarnavideo use the same S3, so large recordings are not downloaded through the app.

### 14. Not verified against reality
- Never run against a real LCYT delivery, a real DSK recording or a real fleet; the Postgres path is covered by the CI unit job only (the e2e suite uses SQLite).
