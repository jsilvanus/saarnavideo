# Import from LCYT: finished streams as editable projects

**Status:** S1 (import), S2 (feed swap with offsets) and S3 (keyed DSK graphics layer) built 2026-10-13, see `docs/INTEGRATIONS.md`, "Import from LCYT". Not built: S4 (graphics log to SaarnaVideo graphics), S5 (audio sync), the pull page, the scoped import token. Differences from the text below: only the push route exists; project creation happens in the request (the job only fills it); partial deliveries resume instead of keeping a PARTIAL state; `Source.feedRole` also has `ISO` and `Source.feedLabel` exists for `docs/plans/atem-iso-import.md`; LCYT sends `https` links (no `s3://` references yet) and feeds in `parts`. Original plan: Companion plan in live-captions-yt: `docs/plans/plan_saarnavideo_handoff.md`, which owns the manifest contract (v1) described there.

## Goal

After a live stream made with LCYT, the broadcast shows up in SaarnaVideo as a project with the video, the captions and the metadata filled in, so the usual flow (sections, graphics, captions, podcast, publish) starts from the recording instead of from a manual upload. When the stream used DSK graphics, SaarnaVideo also gets the clean picture and the graphics separately, so on-air mistakes can be corrected.

## What LCYT will deliver

A manifest (JSON, `version: 1`) plus files, see the LCYT plan for the full shape:
- up to three feeds, as finished MP4 files: `clean` (camera or mixer, no graphics), `program` (what went out, clean plus DSK) and `dsk` (graphics only, either keyed on a colour or, later, with real alpha). `program` can be an alias of `clean`.
- captions as VTT per language, already aligned to the clean feed's time (`origin`: `stt` or `typed`).
- `dskEvents`: a timeline of graphics changes with their variable values.
- `markers` (optional, from LCYT's cue engine), and `variables` (key/value from the broadcast record).
- per feed an `offsetMs` to the clean feed. Refs are `s3://` URIs or HTTPS URLs. No credentials are inside.

## What exists here and can be reused

- Media store already resolves `s3://bucket/key` references and copies into its cache (`src/lib/media-store`), so a source can point at an object LCYT wrote when both share a bucket and endpoint; otherwise a worker job downloads it (like DOWNLOAD jobs, `src/worker/source-resolution.ts`).
- VTT becomes a transcript run (`POST /api/sources/[sourceId]/transcription-runs/upload`, `createTranscriptionRun`), exactly what the optional caption file at upload already does.
- Variables (`definition.variables`) and the `Source`/project model with several sources per project, templates (`applyTemplate`), `ApiConnector`/varfetch for service metadata.
- Reframe resolution, sections/sequences, graphics (`materializeGraphics`), burned and soft captions.
- The access gate: `ACCESS_SECRET` accepted as `x-access-secret` or `Authorization: Bearer`. It is one shared secret, so LCYT must hold it. Treat that as the weakest part of the design (see Security).

## Proposed design

### Data model (additive, both Prisma schemas, `prisma db push`)

- `Source.feedRole` (`CLEAN | PROGRAM | DSK`, null for normal sources), `Source.feedGroupId` (cuid shared by the sources of one import), `Source.syncOffsetMs` (offset to the clean feed), `Source.origin` (Json: `{ system: "lcyt", instance, broadcastId, videoId, manifestVersion }`) and, for the DSK feed, `Source.keyParams` (Json: colour, similarity, blend, or `hasAlpha`).
- New table `Import` (`id`, `system`, `externalId` = LCYT video group id, `manifestUrl`, `status` PENDING/DOWNLOADING/READY/FAILED, `projectId`, `error`, `createdAt`), unique on (`system`, `externalId`) so the same broadcast cannot create a second project by accident. Re-delivery of the same manifest returns the existing import.

### API

- `POST /api/imports/lcyt` `{ manifestUrl }` (or inline manifest): validates it with a Zod schema (`src/domain/lcyt-manifest.ts`, a copy of the LCYT schema, with shared fixtures), creates the `Import` row and a project, returns 202 and the import id. Idempotent.
- `GET /api/imports/[id]` for status; listed in the UI.
- An import worker job (new `MediaJobType` `IMPORT`, claimed like other jobs, runs on any worker lane, uses fffleet DOWNLOAD-style staging when remote): fetch each feed, store as `Source` rows via the media store, probe duration, import VTT runs, set variables, record offsets. Partial failures keep what arrived and mark the import FAILED with a readable error; retry resumes.
- Pull mode for hosts without shared storage: a global "LCYT connection" setting (base URL, token), a page listing available broadcasts (`GET` on LCYT's handoff API), and an Import button. Push and pull produce the same `Import` row.

### Project creation

- Template chosen in the connection settings (default: a project without template, or the saved template the user picks, e.g. a mass or sermon one); `title` and dates from the manifest; manifest `variables` merge into `definition.variables` after validation (`validateRenderSettings` key rules; invalid keys are skipped with a notice).
- The project opens on the Lähde step with the clean (or program) source selected, markers offered as suggested sections, and an import notice list (missing feed, offset used, alias).
- Which feed is the main source: `program` when the user wants the broadcast as aired, `clean` when they want to re-add graphics. Import setting `defaultFeed`, per project changeable.

### Editing with separate feeds

Phased, each phase usable on its own:

1. **S1 Import only.** One feed becomes the working source; the other feeds are stored as sibling sources of the same `feedGroupId` and shown in the sources list with their role. Captions and variables imported. This already replaces the manual upload.
2. **S2 Feed swap.** A section or clip can switch between the feeds of its group (`program`/`clean`) keeping the range; offsets (`syncOffsetMs`) are applied when computing the cut so the picture stays in sync. Reframe works on whichever feed is used.
3. **S3 Graphics layer from the DSK feed.** New timeline item or clip option "graphics from feed": overlays the DSK feed on the clean feed over a range, keyed with `keyParams` (colorkey filter, the same chain LCYT used) or with alpha when the feed has it. Result equals program but can be trimmed, delayed or removed per range, e.g. cut a wrong lower third out. `sourceVideoFilters`/`buildCompositionRenderPlan` get one extra input per range; the fffleet staging already handles extra inputs.
4. **S4 Replace graphics from events.** Map `dskEvents` entries to SaarnaVideo graphics (by name, via a mapping table the user confirms once per template) and place them as overlays, so a graphic can be fixed in the editor instead of masked. Optional and last; depends on how LCYT's DSK templates relate to `.svgraphic`, which is not yet checked.
5. **S5 Auto sync fallback.** If offsets are missing or wrong, estimate the offset between program and clean by audio cross-correlation (ffmpeg, a short window around the start) and let the user confirm.

### Sections from markers

Optional: `markers` of kind `cue` become suggested sections (names from the cue labels, positions on the clean timeline). This is the same idea as the unfinished "cue-phrase section suggestions"; reuse that UI rather than a new one.

### Captions

VTT is imported unchanged as a transcript run per language with origin `UPLOAD` (already supported) and a note `from LCYT`; STT-origin captions stay editable in the caption editor. If a run for the language exists, ask rather than overwrite. Captions sit on the clean time axis, so they stay correct for any feed when offsets are applied at cut time.

## Security and data protection

- Shared `ACCESS_SECRET` is the only credential today. v1 accepts it for `POST /api/imports/lcyt`; a dedicated import token (hashed, scoped to imports, revocable) is a small follow-up and should come before the LCYT auto-send is turned on in a real deployment.
- SSRF: manifest and media URLs are fetched server-side, so the fetcher follows the connector rules (`CONNECTOR_ALLOW`/`CONNECTOR_DENY` pattern, no redirects to private ranges unless allowed, size and type limits, `MAX_UPLOAD_BYTES`).
- Recordings of worship services and their transcripts are personal data, and can reveal religious belief; imports are explicit per project, nothing is fetched unless the user or an authenticated LCYT call asks, retention remains manual deletes. Note this in `docs/INTEGRATIONS.md`. Fixtures in the repository are synthetic.
- Never log signed URLs or tokens; scrub them from job errors as done for S3.

## Tests

Unit: manifest schema (shared fixtures with LCYT), offset arithmetic for cuts, key-parameter filter building, import idempotency (DB-backed, one test file per the shared database note). Worker: import with a disk "bucket" and the fake S3 server. E2E: generate three synthetic clips with ffmpeg (clean, green-keyed graphics, composite), import via the HTTP API, render a project that swaps feeds and one that overlays the keyed graphics, check pixels like `reframe.e2e`. Not covered: a real LCYT, real MediaMTX, real service footage.

## Documentation to update when built

`CLAUDE.md` (sections: data model, API routes, worker lanes, new "Import from LCYT"), `docs/INTEGRATIONS.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, and i18n keys in fi/en/sv for the import page.

## Open questions

- Alpha or key colour for the DSK feed (decided on the LCYT side after a benchmark); S3 can start with keyed colour only.
- Whether LCYT DSK graphics can be mapped to `.svgraphic` at all (S4); until then the event log is only displayed.
- One project per broadcast, or add imports to an existing project (e.g. two services in one video)? Proposed: new project by default, "add to project" in the pull page.
- Where the default feed and template choice live: per LCYT connection (proposed) or per import.
- Dedicated import token timing (see Security).

## Out of scope

Sending finished edits back to LCYT, importing during the stream, multi-camera editing beyond the three feed roles.
