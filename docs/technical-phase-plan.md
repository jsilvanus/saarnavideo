# SaarnaVideo Technical Phase Plan

The implementation is divided into five phases. Each phase should leave the repository in a usable, tested state and should avoid introducing infrastructure that is not yet needed.

The core domain model is:

```text
Project -> Source -> Composition -> GenerationJob -> Output -> optional Publication
                         |
                    Template/theme
```

Source acquisition and output download are transport/storage concerns around these persistent domain objects. YouTube publishing is represented separately as a Publication.

## Phase 1 — Core project model and deterministic renderer

### Goal

Build the smallest end-to-end rendering engine without relying on the web UI, YouTube, or AI, while defining the core Project/Source/Composition/Output model correctly from the beginning.

### Implement

- Initialize the TypeScript project structure.
- Define the project schema with:
  - project metadata;
  - `Source`;
  - semantic source segments;
  - composition timeline/template;
  - generation/output configuration.
- Define source types:
  - local uploaded file;
  - YouTube reference as a future/initial integration type.
- Define output model for:
  - generated video;
  - generated thumbnail.
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
- Make generated video and thumbnail explicit output artifacts.
- Add representative fixture media and automated renderer tests.

### Explicitly defer

- YouTube OAuth/upload.
- Web UI.
- Transcription.
- Persistent job infrastructure.
- AI timestamp suggestions.

### Exit criteria

A checked-in project definition can be rendered from a local source video into a finished MP4 and thumbnail entirely from the command line, with tests covering project parsing, semantic-to-composition timeline resolution, output creation, and FFmpeg argument construction.

---

## Phase 2 — Application, projects, uploads, downloads, and job execution

### Goal

Turn the renderer into a usable application with persistent Projects, explicit Source/Output lifecycle, asynchronous generation, local upload, and output download.

### Implement

- Next.js application with TypeScript and React.
- PostgreSQL + Prisma.
- Persistent models for:
  - `Project`;
  - `Source`;
  - `GenerationJob`;
  - `Output`.
- Project CRUD sufficient for the generation workflow.
- Source lifecycle metadata and local upload handling.
- Generated output metadata and secure download endpoints.
- Database-backed `GenerationJob` model.
- Node.js worker that polls/claims pending jobs safely.
- Job states such as:
  - queued;
  - acquiring-source;
  - processing;
  - rendering;
  - completed;
  - failed;
  - expired.
- Temporary media directory layout per project/job.
- Seven-day retention metadata and cleanup worker/task.
- Basic project editor for:
  - source upload;
  - title/preacher/Gospel metadata;
  - semantic timestamps;
  - template selection;
  - generation options.
- Basic generation status UI.
- Download links for retained generated outputs.
- Tests for project persistence, job claiming, retry/failure behavior, upload handling, output access, and cleanup.

### Exit criteria

A user can create a Project, upload a local Source file, define the composition, generate a video asynchronously, observe progress, and download the generated MP4/thumbnail. Expired large files are removed automatically while small project metadata remains available.

---

## Phase 3 — YouTube input and output publications

### Goal

Make YouTube the normal end-to-end source and publishing path while keeping YouTube isolated from the core renderer.

### Implement

- YouTube OAuth connection.
- Secure storage of the minimum required OAuth credentials/tokens.
- YouTube URL validation and `SourceProvider` abstraction.
- YouTube Source records linked to Projects.
- Download YouTube source into the job's temporary working directory.
- Update Source lifecycle/status during acquisition.
- Handle download errors, unavailable videos, authentication limitations, and cancellation safely.
- YouTube `Publication` model associated with an Output/project.
- YouTube publishing integration using the YouTube Data API.
- Upload generated MP4 with:
  - title;
  - description when supported by the project/template;
  - thumbnail;
  - privacy state.
- Default upload state: `private`.
- Store resulting YouTube video ID and publication status.
- UI controls for:
  - source URL;
  - connect YouTube;
  - upload after generation;
  - privacy choice where appropriate.
- End-to-end tests using mocks/stubs for YouTube APIs; do not require real credentials in CI.

### Exit criteria

The complete manual workflow works:

`YouTube URL -> Project/Source -> temporary source -> render -> Output -> optional private YouTube Publication`

No manual source download is required, and the generated Output remains independently downloadable while retained.

---

## Phase 4 — Transcription and assisted composition

### Goal

Use transcription to reduce timestamp-entry work while keeping the human in control.

### Implement

- Add a transcription interface independent of the web application.
- Implement a local Python/faster-whisper transcription worker/tool.
- Extract audio from the Source using FFmpeg for transcription.
- Store transcript segments with timestamps as project/job-related data.
- Add a service boundary so the main Node application consumes a stable transcript result rather than depending on Python implementation details.
- Add assisted section detection for likely:
  - Gospel;
  - sermon;
  - Creed;
  - other configured semantic sections.
- Present suggestions in the UI as editable/confirmable timestamps.
- Preserve manually entered timestamps as authoritative user decisions.
- Add confidence/error states rather than pretending automatic detection is always correct.
- Feed confirmed semantic segments into the same composition resolver and deterministic renderer from earlier phases.

### Exit criteria

Given a supported worship recording, SaarnaVideo can produce suggested semantic timestamps from a transcript, the user can correct them, and the confirmed result feeds the same Project composition and renderer used in earlier phases.

---

## Phase 5 — Template system and production hardening

### Goal

Make the composition engine reusable across different publishing formats while keeping the UI simple and the Project/Source/Output/Publication model stable.

### Implement

- Formalize reusable templates for:
  - opening slates;
  - Gospel overlays;
  - ending cards;
  - thumbnails;
  - complete composition recipes.
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
- Document deployment, YouTube OAuth setup, retention behavior, upload/download lifecycle, Project model, and template creation.

### Exit criteria

SaarnaVideo supports multiple reusable composition templates and can reliably produce, download, and optionally publish videos from worship recordings without requiring manual video-editing software.

---

## Cross-phase technical rules

1. **Keep Project, Source, Output, and Publication separate.** A Project is the recipe; a Source is input; an Output is generated media; a Publication represents an external destination such as YouTube.
2. **Keep source semantics separate from composition.** A segment named `gospel` is data; what the template does with it is composition logic.
3. **Treat upload/download as transport operations.** Source upload/acquisition and output download should not become separate editing models.
4. **Do not require intermediate video files.** Render directly from source ranges when practical. Intermediate files are temporary implementation details.
5. **Keep FFmpeg explicit.** Prefer generated, testable FFmpeg command/filter definitions over a large opaque abstraction.
6. **Keep YouTube isolated.** Source acquisition and publishing should be replaceable integrations.
7. **Keep transcription isolated.** Python/faster-whisper is a service/tool implementation, not the application's core language.
8. **Keep the job system simple.** PostgreSQL-backed jobs are sufficient initially; add Redis/another queue only if real workload demonstrates a need.
9. **Keep large media temporary.** Default retention is seven days and cleanup must be idempotent.
10. **Keep human confirmation in the loop.** Automatic transcription and section detection may suggest edits but should not silently publish or make irreversible final decisions.
11. **Prefer deterministic rendering.** Given the same source, project definition, template, and renderer version, the output should be reproducible as far as practical.
12. **Avoid general editor scope.** The UI should remain a structured publishing workflow, not become a manual timeline editor.
