# SaarnaVideo Plan

## Purpose

SaarnaVideo is a small, focused media composition tool for turning worship-service recordings into publishable sermon and liturgical videos with minimal manual work.

The primary workflow is:

1. Provide a YouTube recording URL, or upload a local source file.
2. Create or reopen a project describing the source, metadata, semantic sections, and composition.
3. Provide or confirm semantic timestamps such as Gospel, sermon, Creed, and other useful sections.
4. Select a composition template.
5. Render the result automatically.
6. Generate a matching thumbnail.
7. Optionally upload the result to the user's YouTube account, initially as **private**.
8. Make generated files available for download.
9. Retain large working media temporarily (default seven days), then clean it up automatically.

The application should remove repetitive video-editing work rather than become a general-purpose video editor.

## Core concept

SaarnaVideo is a **declarative media composition engine**, initially specialized for worship-service publishing.

The central persistent object is a **Project**. A project is the recipe for producing media; generated media is an output of the project and is not the project itself.

A project consists of:

- a source;
- project metadata;
- semantic source selections/segments;
- a composition timeline/template;
- generation settings/status;
- generated outputs;
- optional publications.

The source material, semantic meaning, presentation, generated artifacts, and external publication are separate concerns.

## Project model

A project represents one intended media composition. It should remain small and inspectable, and it should be possible to reproduce it from its persisted definition while large source/output files are still retained.

Conceptually:

```text
Project
├── metadata
├── Source
├── semantic segments
├── composition/template
├── GenerationJobs
├── Outputs
└── Publications
```

Changing a project and generating again creates a new output; it does not mutate an already generated artifact.

## Source model and upload/download

A project has a source abstraction. The renderer must not care how the source was acquired.

Initial source types:

- **YouTube source** — identified by YouTube URL/video ID and downloaded to temporary local storage for processing;
- **uploaded file source** — a locally uploaded media file stored temporarily for processing.

Conceptually:

```text
Source
├── type: youtube | upload
├── original/reference information
├── stored working file
├── media metadata
└── lifecycle/retention information
```

Source acquisition should be isolated behind a source-provider abstraction. The same rendering pipeline must work regardless of whether the source came from YouTube or an upload.

The application should expose generated files as downloadable outputs. Download is a transport operation, not a separate editing model.

## Semantic source selections

A project may identify semantic ranges such as:

- Gospel;
- sermon;
- Creed;
- children's reading;
- announcement;
- any future user-defined section.

A section is primarily a named source range. It does not imply that a separate physical video file must be created.

For example:

```text
Gospel  = source 12:31–15:42
Sermon  = source 15:42–38:17
Creed   = source 39:02–41:15
```

If semantic ranges are adjacent, the renderer should normally preserve them as one continuous source range rather than unnecessarily cutting and re-encoding them.

## Composition timeline

Templates turn source selections into an output timeline. Timeline items may be:

- continuous source clips;
- separate source clips;
- source clips with overlays;
- generated/replacement slates;
- generated ending cards;
- other generated media in the future.

This supports both common cases:

- one continuous source range with a slate/overlay appearing at particular points;
- separate clips with generated material between them.

The composition is therefore more general than a simple list of cuts. It can contain a continuous source range and place generated material over, before, after, or between source material.

Intermediate video files are not required unless useful for implementation/debugging.

## Output model

Generated media is represented explicitly as an **Output** associated with a project/generation.

Initial output types include:

- generated MP4 video;
- generated thumbnail image.

Conceptually:

```text
Output
├── type
├── storage location
├── MIME type / size
├── generation metadata
├── createdAt
└── expiresAt
```

Outputs should be downloadable while retained. Large output files follow the same default seven-day retention policy as other working media.

Small project metadata should not depend on the continued existence of large output files.

## Publication model

Publishing is separate from generating an output.

A project/output may have zero or more **Publications**, initially supporting YouTube.

Conceptually:

```text
Publication
├── provider: youtube
├── external video ID
├── status
├── privacy state
├── published/uploaded timestamp
└── error information if applicable
```

The initial YouTube publication state should default to **private**, serving as the review/draft state. SaarnaVideo should not automatically make generated videos public in the first version.

## Initial output

The first important template is a sermon-video template that can produce approximately:

1. opening slate;
2. Gospel source material with a semi-transparent Gospel-text overlay;
3. sermon source material;
4. optional ending slate.

If Gospel and sermon are directly consecutive in the source, they should normally remain one continuous source range. If sections are separated, the composition can contain multiple source clips.

The Gospel overlay should preserve the original source audio/video while displaying the Gospel text using the selected visual theme.

## Templates

Templates define composition and presentation, not the meaning of source segments.

Examples may eventually include:

- sermon video;
- Gospel + sermon;
- Gospel-only;
- short sermon clip;
- full selected liturgical section;
- congregation-specific variants.

Templates should contain reusable visual definitions for:

- opening slates;
- Gospel text overlays;
- ending cards;
- thumbnails;
- branding/theme assets.

The first implementation should keep the template system small and deterministic rather than building a visual editor.

## YouTube integration

YouTube is a first-class integration from the beginning.

### Input

The preferred source workflow is:

`YouTube URL -> temporary local source -> project/composition -> render`

A local file upload should also be supported as a simple alternative for testing and non-YouTube recordings.

The renderer must not depend on the source being YouTube. Source acquisition should be isolated behind a source-provider abstraction.

### Output

Generated videos can optionally be uploaded to YouTube. The initial default should be **private**, which acts as the review/draft state. The application should not automatically publish videos publicly in the first version.

The YouTube account connection should use OAuth and retain only the credentials/tokens necessary for the integration.

## Transcription and assisted timestamping

Transcription is an important capability because it can eventually suggest Gospel, sermon, Creed, and other section boundaries.

The initial architecture should keep transcription separate from the main application:

- Next.js/Node.js remains the application and media-worker stack;
- Python + faster-whisper can provide local transcription;
- the application communicates with transcription through a small, stable interface/result model.

For the first usable version, manually supplied timestamps must remain fully supported. AI/transcription suggestions should be reviewable and never silently determine the final cut.

## Rendering

FFmpeg is the media rendering engine.

The application should build an explicit composition/timeline and translate it into FFmpeg operations. The preferred production path is to avoid unnecessary intermediate video encodes and render the final composition directly from the temporary source where practical.

Temporary audio extraction for transcription is acceptable.

## Retention and lifecycle

Large media is disposable.

Default retention is seven days.

Temporary/large data includes:

- downloaded source videos;
- uploaded source files;
- extracted audio;
- intermediate render files;
- generated MP4s;
- generated thumbnails and other large generated assets.

Each source/output should have lifecycle metadata such as creation and expiration times where practical. Cleanup must be automatic, safe to retry, and idempotent.

Small project metadata should be retained independently where useful, including timestamps, metadata, template selection, status, and resulting YouTube video ID.

## Suggested technology stack

- **Language:** TypeScript
- **Web application:** Next.js + React
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Media worker:** Node.js/TypeScript
- **Video processing:** FFmpeg
- **YouTube source acquisition:** yt-dlp, isolated behind a source-provider interface
- **YouTube publishing:** YouTube Data API + OAuth
- **Transcription:** Python + faster-whisper, initially invoked as a separate worker/tool rather than making Python the application stack
- **Deployment:** Docker Compose initially
- **Testing:** Vitest for application/renderer logic and Playwright for key UI flows
- **CI:** GitHub Actions

Avoid Redis, Kubernetes, cloud object storage, and other infrastructure until the actual workload requires them.

## Initial architecture

```text
                    +----------------------+
                    |       Next.js        |
                    | UI / API / OAuth     |
                    | projects / jobs      |
                    +----------+-----------+
                               |
                         PostgreSQL
                               |
                               v
                    +----------------------+
                    |     Node worker       |
                    |                      |
                    | source providers     |
                    | yt-dlp   FFmpeg      |
                    | rendering / cleanup  |
                    +----------+-----------+
                               |
                     optional transcription
                               |
                               v
                    +----------------------+
                    | Python / faster-     |
                    | whisper               |
                    +----------------------+

Project -> Source -> Composition -> GenerationJob -> Output -> optional Publication
                         |
                    Template/theme
```

The worker should initially use a database-backed job table rather than introducing a dedicated queue service.

## Scope boundaries

SaarnaVideo is not intended initially to be:

- a general-purpose video editor;
- a browser-based frame-accurate editing suite;
- a social-media publishing platform;
- a full media asset management system;
- an autonomous AI editor.

The first goal is a reliable, repeatable path from worship recording to finished sermon video.

## Success criteria

A first-time user should be able to:

1. create a project;
2. paste a YouTube recording URL or upload a source file;
3. enter or confirm a handful of timestamps;
4. enter title, preacher, and Gospel information;
5. choose the default template;
6. press Generate;
7. receive a finished MP4 and thumbnail as downloadable outputs;
8. optionally have the finished video uploaded privately to YouTube;
9. return later and see the project/output/publication status without keeping the large working files forever.
