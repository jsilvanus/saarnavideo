# SaarnaVideo Plan

## Purpose

SaarnaVideo is a small, focused media composition tool for turning worship-service recordings into publishable sermon and liturgical videos with minimal manual work.

The primary workflow is:

1. Provide a YouTube recording URL (with local file upload as an alternative source).
2. Provide or confirm semantic timestamps such as Gospel, sermon, Creed, and other useful sections.
3. Provide metadata such as title, preacher, Gospel reference, and Gospel text.
4. Select a composition template.
5. Render the result automatically.
6. Generate a matching thumbnail.
7. Optionally upload the result to the user's YouTube account, initially as **private**.
8. Retain working media temporarily (default seven days), then clean it up automatically.

The application should remove repetitive video-editing work rather than become a general-purpose video editor.

## Core concept

SaarnaVideo is a **declarative media composition engine**, initially specialized for worship-service publishing.

A project consists of:

- a source video;
- semantic source selections/segments;
- project metadata;
- a composition template;
- generated assets and outputs.

The source material and the presentation are separate concerns.

### Source selections

A project may identify semantic ranges such as:

- Gospel;
- sermon;
- Creed;
- children's reading;
- announcement;
- any future user-defined section.

A section is primarily a named source range. It does not imply that a separate physical video file must be created.

### Composition timeline

Templates turn source selections into an output timeline. Timeline items may be:

- continuous source clips;
- source clips with overlays;
- generated slates;
- generated ending cards;
- other generated media in the future.

This supports both common cases:

- one continuous source range with a slate/overlay appearing at particular points;
- separate clips with generated material between them.

Adjacent source ranges should be optimized into a continuous range where possible. Intermediate video files are not required unless useful for implementation/debugging.

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
- thumbnails.

The first implementation should keep the template system small and deterministic rather than building a visual editor.

## YouTube integration

YouTube is a first-class integration from the beginning.

### Input

The preferred source workflow is:

`YouTube URL -> temporary local source -> composition`

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

## Retention

Working media is disposable.

Default retention is seven days.

Temporary data includes:

- downloaded source videos;
- extracted audio;
- intermediate render files;
- generated MP4s;
- generated thumbnails and other large generated assets.

Small project metadata should be retained independently where useful, including timestamps, metadata, template selection, status, and resulting YouTube video ID.

Cleanup must be automatic and safe to retry.

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

1. paste a YouTube recording URL;
2. enter or confirm a handful of timestamps;
3. enter title, preacher, and Gospel information;
4. choose the default template;
5. press Generate;
6. receive a finished MP4 and thumbnail;
7. optionally have the finished video uploaded privately to YouTube;
8. return later and see the project status without keeping the large working files forever.
