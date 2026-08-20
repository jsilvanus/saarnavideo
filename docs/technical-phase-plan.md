# SaarnaVideo Technical Phase Plan

The implementation is divided into five phases. Each phase should leave the repository in a usable, tested state and should avoid introducing infrastructure that is not yet needed.

## Phase 1 — Core model and deterministic renderer

### Goal

Build the smallest end-to-end rendering engine without relying on the web UI or AI.

### Implement

- Initialize the TypeScript project structure.
- Define the project schema with:
  - source;
  - metadata;
  - semantic source segments;
  - composition timeline/template;
  - output configuration.
- Define timeline item types:
  - `SourceClip`;
  - `SourceClipWithOverlay`;
  - `GeneratedSlate`;
  - future extensible generated items.
- Implement local-file source input first.
- Implement FFmpeg command generation/execution.
- Support:
  - source-range selection;
  - concatenating separated source clips;
  - continuous source ranges without unnecessary cutting;
  - generated opening slate;
  - Gospel text overlay;
  - final MP4 output.
- Implement deterministic thumbnail generation from the same visual template data.
- Add representative fixture media and automated renderer tests.

### Explicitly defer

- YouTube OAuth/upload.
- Web UI.
- Transcription.
- Persistent job infrastructure.
- AI timestamp suggestions.

### Exit criteria

A checked-in project definition can be rendered from a local source video into a finished MP4 and thumbnail entirely from the command line, with tests covering timeline resolution and FFmpeg argument construction.

---

## Phase 2 — Application, projects, and job execution

### Goal

Turn the renderer into a usable application with persistent projects and asynchronous generation.

### Implement

- Next.js application with TypeScript and React.
- PostgreSQL + Prisma.
- Project CRUD sufficient for the generation workflow.
- Database-backed `GenerationJob` model.
- Node.js worker that polls/claims pending jobs safely.
- Job states such as:
  - queued;
  - downloading;
  - processing;
  - rendering;
  - completed;
  - failed;
  - expired.
- Temporary media directory layout per job/project.
- Seven-day retention metadata and cleanup worker/task.
- Local-file upload as an alternative source.
- Basic generation status API/UI.
- Tests for job claiming, retry/failure behavior, and cleanup.

### Exit criteria

A user can create a project, upload a local source file, generate a video asynchronously, observe progress, and retrieve the generated MP4/thumbnail. Expired large files are removed automatically.

---

## Phase 3 — YouTube input and output

### Goal

Make YouTube the normal end-to-end source and publishing path.

### Implement

- YouTube OAuth connection.
- Secure storage of the minimum required OAuth credentials/tokens.
- YouTube URL validation and source-provider abstraction.
- Download YouTube source into the job's temporary working directory.
- Handle download errors, unavailable videos, authentication limitations, and cancellation safely.
- YouTube publishing integration using the YouTube Data API.
- Upload generated MP4 with:
  - title;
  - description when supported by the project/template;
  - thumbnail;
  - privacy state.
- Default upload state: `private`.
- Store resulting YouTube video ID and upload status.
- UI controls for:
  - source URL;
  - connect YouTube;
  - upload after generation;
  - private/unlisted choice where appropriate.
- End-to-end tests using mocks/stubs for YouTube APIs; do not require real credentials in CI.

### Exit criteria

The complete manual workflow works:

`YouTube URL -> temporary source -> render -> thumbnail -> optional private YouTube upload`

No manual source download is required.

---

## Phase 4 — Transcription and assisted composition

### Goal

Use transcription to reduce timestamp-entry work while keeping the human in control.

### Implement

- Add a transcription interface independent of the web application.
- Implement a local Python/faster-whisper transcription worker/tool.
- Extract audio from the source using FFmpeg for transcription.
- Store transcript segments with timestamps.
- Add a service boundary so the main Node application consumes a stable transcript result rather than depending on Python implementation details.
- Add assisted section detection for likely:
  - Gospel;
  - sermon;
  - Creed;
  - other configured semantic sections.
- Present suggestions in the UI as editable/confirmable timestamps.
- Preserve manually entered timestamps as authoritative user decisions.
- Add confidence/error states rather than pretending automatic detection is always correct.

### Exit criteria

Given a supported worship recording, SaarnaVideo can produce suggested semantic timestamps from a transcript, the user can correct them, and the confirmed result feeds the same deterministic renderer used in earlier phases.

---

## Phase 5 — Template system and production hardening

### Goal

Make the composition engine reusable across different publishing formats while keeping the UI simple.

### Implement

- Formalize reusable templates for:
  - opening slates;
  - Gospel overlays;
  - ending cards;
  - thumbnails;
  - composition recipes.
- Support multiple templates without hard-coding Gospel/sermon logic into the renderer.
- Allow templates to combine:
  - continuous source ranges;
  - separate source clips;
  - overlays;
  - replacement/generated slates.
- Add theme/branding assets such as logo, fonts, backgrounds, and typography.
- Improve thumbnail generation and validation.
- Add robust cancellation and cleanup behavior.
- Add resource limits and validation for very large/long jobs.
- Add observability through structured job logs and useful error messages.
- Add full end-to-end test coverage for the main publishing workflow.
- Document deployment, YouTube OAuth setup, retention behavior, template creation, and troubleshooting.

### Exit criteria

SaarnaVideo supports multiple reusable composition templates and can reliably produce and optionally publish videos from worship recordings without requiring manual video-editing software.

---

## Cross-phase technical rules

1. **Keep source semantics separate from composition.** A segment named `gospel` is data; what the template does with it is composition logic.
2. **Do not require intermediate video files.** Render directly from source ranges when practical. Intermediate files are temporary implementation details.
3. **Keep FFmpeg explicit.** Prefer generated, testable FFmpeg command/filter definitions over a large opaque abstraction.
4. **Keep YouTube isolated.** Source acquisition and publishing should be replaceable integrations.
5. **Keep transcription isolated.** Python/faster-whisper is a service/tool implementation, not the application's core language.
6. **Keep the job system simple.** PostgreSQL-backed jobs are sufficient initially; add Redis/another queue only if real workload demonstrates a need.
7. **Keep large media temporary.** Default retention is seven days and cleanup must be idempotent.
8. **Keep human confirmation in the loop.** Automatic transcription and section detection may suggest edits but should not silently publish or make irreversible final decisions.
9. **Prefer deterministic rendering.** Given the same source, project definition, template, and renderer version, the output should be reproducible as far as practical.
10. **Avoid general editor scope.** The UI should remain a structured publishing workflow, not become a manual timeline editor.
