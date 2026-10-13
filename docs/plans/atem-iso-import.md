# Import of ATEM Mini Extreme ISO recordings: every ISO feed plus program

**Status:** plan only, nothing built (2026-10-13). Study and plan; written in parallel with `docs/plans/lcyt-import.md`, whose shape it reuses (`Import`, `feedGroupId`, `syncOffsetMs`, `IMPORT` job, feed swap, auto sync). Build it after the LCYT import has landed S1 and S2, so the two share one implementation of the common parts.

## Goal

A worship service recorded on a Blackmagic ATEM Mini Extreme ISO shows up in SaarnaVideo as one project holding **all eight camera (ISO) recordings and the program recording**, in sync, with the isolated audio available. The user can then cut the service from any angle, re-do the switching afterwards, and use the usual flow (sections, graphics, captions, podcast, publish). Today the only way in is to upload one file by hand, which throws away the other angles.

## What the ATEM records (study)

From the vendor's spec sheets (see Sources). Items marked **unverified** must be checked against a real recording before building; this repository has no real ATEM footage and fixtures must stay synthetic.

- **Video:** eight HDMI inputs recorded as separate ISO files, H.264 in `.mp4`, up to 70 Mb/s, AAC audio, plus one program file (H.264 `.mp4`, bit rate follows the streaming-quality setting).
- **Audio:** the 10 two-channel audio inputs (8 HDMI embedded + 2 analogue) are also recorded as separate 24-bit 48 kHz `.wav` files.
- **Project file:** the switching is saved as a DaVinci Resolve project (`.drp`) that restores the show as a multi-cam timeline.
- **Media:** USB-C drive formatted exFAT (or HFS+), or network storage over the Ethernet port.
- **Sync:** one recording session starts all files together; the switcher has an internal timecode generator but no external timecode or reference input.
- **Unverified:** folder layout and file names (per recording folder? per input name?), whether files carry a `tmcd` timecode track or `start_time`, whether all files have exactly equal duration, frame rate/resolution per file (inputs are re-synced, so a common rate is expected), whether program audio is the mixed or a separate track, behaviour when the disk fills or the recording is split into several files, what the `.drp` contains (zip? DB? XML?) and whether it is parseable without Resolve.

## Reuse from the LCYT import plan

| Piece | LCYT import | ATEM import |
|---|---|---|
| `Import` table (`system`, `externalId`, status, `projectId`, `error`) | `system = "lcyt"` | `system = "atem"`, `externalId` = hash of the sorted file list (names, sizes, mtimes) so the same recording is not imported twice |
| `Source.feedGroupId`, `feedRole`, `syncOffsetMs`, `origin` | 3 roles (CLEAN/PROGRAM/DSK) | PROGRAM plus eight ISO sources. Needs one more enum value `ISO` and a free label column `Source.feedLabel` (`"Cam 1"`, input name); LCYT roles stay unchanged. **Coordination:** add `ISO` and `feedLabel` in the LCYT import's migration or in a small shared PR first, so the two plans do not each edit the enum |
| `IMPORT` job type, claimed by any worker lane, resumable | fetch feeds from URLs | scan, probe, register, proxy (below) |
| Feed swap in a section/clip (LCYT S2) | clean to program | any angle of the group, many choices instead of two |
| Auto sync by audio cross-correlation (LCYT S5) | fallback for missing offsets | verification step for every file against program, always run (cheap) |
| Access gate, SSRF rules, scrubbing, personal-data notes | same | same; paths replace URLs (see Security) |

Not reused: manifest/captions/`dskEvents`/markers/variables. The ATEM delivers files only, so nothing is pushed by a system; a scanner builds the "manifest" (an internal Zod-validated `AtemRecordingSet`) from what it finds.

## Proposed design

### Getting the files in (three ways, one result)

1. **Browser upload of several files.** Extend the Lähde step: "Import ATEM recording" takes a multi-file selection (drag the whole recording folder). With S3 storage this reuses the direct presigned/multipart flow per file (`docs/LARGE_FILE_UPLOADS.md`); the files are grouped by one `Import` row created first, so a refresh resumes. With local storage the existing streamed upload route is used per file. Practical for small services, painful at ATEM sizes (below).
2. **Register in place (recommended for big sets).** `POST /api/imports/atem { path }` for a folder the worker host can read (the USB disk mounted, or the NAS share the ATEM wrote to). Allowed only inside `IMPORT_LOCAL_ROOTS` (new env, comma-separated absolute paths; unset = feature off). Sources get `storagePath` = the absolute path, which the media store already accepts for local references, so **no copy** is made and the originals stay where the switcher put them. Deleting a source never deletes a file outside `MEDIA_ROOT`/the store; that rule needs a test.
3. **S3 prefix.** `POST /api/imports/atem { s3Prefix }` when the ATEM's NAS or a sync tool already wrote the folder into the media bucket: sources point at `s3://bucket/key`, again without copying.

All three create the same `Import` and `Source` rows. The scanner (`src/lib/atem/scan.ts`, pure over a file listing + ffprobe results) does the classification.

### Scanner

- Classify by extension: `.mp4` video, `.wav` audio, `.drp` project, everything else listed as ignored with a notice.
- Identify roles: program vs ISO and the input number from file names. Because names are unverified, the scanner tries known patterns first and otherwise asks: the import dialog lists every video file with ffprobe facts (duration, size, resolution, fps, a thumbnail at 1 s) and lets the user mark **Program** and name each angle; the choice is remembered per install as a name pattern.
- ffprobe each file: duration, fps, start time, timecode tag, resolution, audio streams. Build warnings (never block): durations differing more than 1 s, differing fps, missing files for an input that was named, a file that is still growing (recording in progress; refuse, ask to retry).
- Compute `syncOffsetMs` per source: 0 by default (the session starts all files together). If a `start_time` or timecode differs between files, use that difference. Then verify with audio cross-correlation of the first 30 s of each file against program (ffmpeg only, no extra dependency) and offer the measured offset when it disagrees by more than 2 frames.
- If a recording was split into several files per input (disk limits, unverified), join them as parts of one source in order (`concat` demuxer, no re-encode); same rule as LCYT "parts".

### Data and project creation

- `Source` rows: `feedRole` PROGRAM or ISO, `feedLabel`, `feedGroupId`, `syncOffsetMs`, `origin` `{ system: "atem", importId, fileName }`, status AVAILABLE once probed. No transcoding at import: the originals are the sources.
- Audio WAVs: **decided (Juha, 2026-10-13): library audio assets.** `audio-clip` already trims and mixes against library assets, so each WAV is stored as an `Asset` of type AUDIO (content-hash dedupe, `durationMs` probed), linked to the project and named `<recording>-<input>`; they stay out of the source list. Consequences to handle when building: library files are content-addressed under `MEDIA_ROOT/assets/library` (or the bucket), so WAVs are **copied**, not registered in place; 24-bit/48 kHz stereo is about 1 GB per hour per file, so the import path must bypass or raise `MAX_AUDIO_ASSET_SIZE_BYTES` (default 200 MB) with a separate import limit, stream the hash instead of buffering, and the browser-upload route needs the same streaming; optionally offer a 16-bit or compressed copy for editing and keep the original on request.
- Project: created with the chosen template (default none), title from the folder name or the user, dates from file mtime/probe `creation_time`. Opens on Lähde with program as the working source and an import notice list.
- One recording = one project; "add to existing project" can wait.

### Size and proxies (the main practical problem)

Nine streams at up to 70 Mb/s is up to about 280 GB per hour in the worst case (8 × 31.5 GB for ISO, plus program), and typical settings are lower but still several times a normal upload. Consequences:

- Never copy by default (register in place or S3 prefix); show the total size and a warning before an upload import. `MAX_UPLOAD_BYTES` is per request and does not apply to registered paths, so a separate `IMPORT_MAX_TOTAL_BYTES` guard is optional.
- **Proxies for editing.** The browser cannot play nine 70 Mb/s H.264 streams. For each ISO and program, a low-priority job (reuse the PREVIEW render type or a new `PROXY` type, fffleet-capable) makes a 640 px, low-rate, keyframe-dense MP4 for the editor. The editor plays proxies, the final render cuts the originals. Programs and the selected angles first, the rest in the background; Lähde shows per-source proxy progress.
- Transcription runs on one audio only: the program audio by default, or a chosen WAV (a clean mic ISO usually transcribes better). Offer the choice; do not transcribe all feeds.
- Render inputs: a render uses only the angles actually cut, so the fleet stages only those (existing S3/fffleet staging handles extra inputs). Local registered paths work for local ffmpeg; the fleet needs S3, so registering in place is for `RENDER_EXECUTOR=local`, and fleet users use the S3 prefix route.

### Editing (phased, each usable on its own)

- **A1 Import, one angle working.** Scan, register all files as a group, probe, proxies, project created with program as working source. Replaces the manual upload and keeps the other angles available. Includes tests, docs, i18n.
- **A2 Angle switching.** A section/clip takes an `angle` (a source id in the same `feedGroupId`) keeping its range; `syncOffsetMs` is applied when computing the cut. Editor: an "Angles" strip (thumbnails of all angles at the playhead) in `CompositionEditor` and `SequenceTimeline`; click to switch the selected clip's angle. This is the same mechanism as LCYT S2, generalized from two feeds to N; build it once.
- **A3 As-aired cut list.** Reconstruct which angle was on program when, so a project starts as "the service as it aired" with sections per cut, ready to be fixed. Two candidate sources: (a) parse the `.drp` (needs a format study, may be proprietary or fragile; do this only if it turns out to be a readable archive), (b) derive from the files: compare downscaled program frames with each ISO's frames at sampled times (e.g. 2 fps, tiny grayscale, perceptual distance) and pick the best match; works without the `.drp` and does not break when Blackmagic changes the format, but graphics/transitions on program lower match scores. Plan (b) as the default with (a) as an optional enrichment. Output: a list of `{ startMs, endMs, angle }`, shown as a preview before it becomes clips.
- **A4 Multi-angle picture.** Picture-in-picture or split screen of two angles (the ISO feeds also make a "two-shot" cheap): one extra input per range in `buildCompositionRenderPlan`. Optional.
- **A5 Isolated audio mix.** Choose which WAV or ISO audio is used under the picture, ducking and levels per clip (the `audio-clip` mix machinery exists); mainly for podcast quality. Optional.

### Documentation, i18n, API when built

`CLAUDE.md` (data model additions, routes, a new "Import from ATEM" section), `docs/INTEGRATIONS.md`, `docs/API.md` (`POST /api/imports/atem`, status via `GET /api/imports/[id]`), `docs/INSTALL.md` (`IMPORT_LOCAL_ROOTS`, optional limits), `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` (mounting the USB/NAS share into the worker container and the app container; both need the same path), and fi/en/sv keys for the import dialog, angle strip and notices.

## Security and data protection

- **Path access** is the new risk: a server-side path parameter is a file-read primitive. Only absolute paths under `IMPORT_LOCAL_ROOTS`, resolved with `realpath` (no `..`, no symlink escape), extension allowlist (`.mp4`, `.wav`, `.drp`), no directory traversal beyond the chosen folder. Off unless the env is set; behind the access gate; in production the route answers 503 without `ACCESS_SECRET` (same rule as direct upload).
- Registered originals are never deleted by SaarnaVideo (only rows are); say so in the delete confirmation text.
- Recordings of worship services are personal data and can reveal religious belief; nothing is fetched or transcribed unless the user starts it; retention is manual. Note this in `docs/INTEGRATIONS.md`. Never commit real recordings, `.drp` files or transcripts with names; fixtures are synthetic.
- Never log S3 URLs or tokens; error messages show file names only relative to the chosen root.

## Tests

- Unit: scanner classification and role detection on listings (several name layouts), warnings (duration/fps mismatch, growing file), offset arithmetic with `syncOffsetMs`, path allowlist (traversal, symlink, unlisted root), idempotent import key, cut-list matching on synthetic frames, `.drp` parser only if built.
- DB-backed: `Import`/`Source` creation and resume (one test file, shared-database rule).
- E2E (`e2e/atem-import.e2e.test.ts`): ffmpeg generates a synthetic "recording folder": eight angle files (colour + big burned number, different tones in audio), a program file made by concatenating known angle ranges, WAVs; import through the HTTP API from a registered path and from the fake S3 server; render a project cutting angle 3 then 5 and check pixels and tones like `reframe.e2e`; check the as-aired cut list recovers the known switching; check proxies exist and play.
- Not covered: a real ATEM, real file naming/timecode, real 70 Mb/s volumes, fleet runs.

## Open questions

- File names, folder layout, timecode and `.drp` format from a real recording. **First task** of the build: Juha records a short test (a minute, all inputs, a few cuts) and shares file listings plus `ffprobe` output (no content needed); the plan's scanner is then adjusted.
- ~~WAV handling~~ Decided: library audio assets (see Data and project creation).
- Register in place vs copy into the store as the default for local installs (proposed: in place, with an explicit "copy to media storage" action).
- Proxies at import or on demand (proposed: program and cut angles first, others in background; storage cost of nine proxies is small).
- Is A3 (as-aired cut list) worth building without a readable `.drp`? Decide after the format study; the frame-matching route needs a threshold tuned on real footage.
- Whether LCYT should also use the ISO files (program/clean) instead of its own recorder when an ATEM is present: out of scope here, noted for the handoff plan.

## Out of scope

Control of the ATEM (live switching, macros), live ingest during the service, other ATEM models and other switchers (Mini Pro ISO records five streams; a later scanner variant), colour grading, sending edits back to Resolve.

## Sources

- Blackmagic Design, ATEM Mini tech specs: https://www.blackmagicdesign.com/products/atemmini/techspecs
- Retailer copies of the Extreme ISO spec (ISO .mp4 H.264 up to 70 Mb/s, WAV audio, `.drp` project, exFAT/HFS+): https://hannu-pro.ee/?p=21518 , https://www.adorama.com/bmdatemminie.html
- Folder and file naming were not found in public sources; check the ATEM Mini manual or a real recording.
