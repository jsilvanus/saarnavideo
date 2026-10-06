# SaarnaVideo

SaarnaVideo turns worship-service recordings into publishable videos with as little manual editing as possible. You bring a recording (an uploaded file or a YouTube link), pick the sections you want, and the app renders a finished video (and, if you like, a podcast episode) with title cards, lower thirds, captions and your own graphics, then publishes it to YouTube or a Facebook Page.

It is built for the Evangelical-Lutheran Church of Finland: the built-in templates (Saarna, Messu, Iltahartaus, Shorts) follow the order of the service, and the church-year data (feast day, theme, Gospel text, colour) can be fetched into the graphics from an API such as anno-api. The interface is available in Finnish (default), English and Swedish.

## What it does

- **Sources:** upload a file, or give a YouTube link (downloaded with yt-dlp). A project can have several sources.
- **Sections and timeline:** cut the recording into sections, reorder them, add opening and closing cards, overlays, voiceovers and background audio. Cut, fade and crossfade transitions.
- **Templates:** start from a built-in template, or save any project as your own.
- **Graphics:** a scene-graph graphics editor, a shared graphics library (images, audio, folders), and project variables (`{{preacher}}`, `{{evankeliumi}}`) that fill the text of your graphics.
- **Output size:** 16:9, Shorts, Reels, TikTok, Stories, square and portrait presets, with fill, fit or custom crop.
- **Captions:** from a transcription of the recording, as a soft track, burned into the picture, or both. Plain-text transcript export.
- **Podcast:** an audio episode with intro and outro, loudness normalised, with tags and cover art.
- **Publishing:** YouTube (including thumbnail and captions) and one Facebook Page.
- **Rendering anywhere:** on the same machine, or on a pool of workers through [fffleet](https://github.com/jsilvanus/fffleet), with media in local disk or S3.

## Quick start (development)

You need Node.js 22 or newer. FFmpeg and yt-dlp are only needed on the machine that runs the worker (the Docker worker image has both).

```bash
npm install
cp .env.example .env          # edit if you like; the defaults use SQLite
npx prisma db push            # creates the SQLite database
npm run dev                   # web app on http://localhost:3000
npm run worker                # in a second terminal: renders and downloads
```

To run everything in containers (PostgreSQL, app, worker, speech-to-text), see [docs/INSTALL.md](docs/INSTALL.md).

Before anyone else can reach the app, set `ACCESS_SECRET` (a shared-secret login, see [docs/INSTALL.md](docs/INSTALL.md#access-secret-login)): the app has no other login.

## Documentation

| Document | What is in it |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | Install and first run: local, Docker Compose, production, every environment variable |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the app, worker, queue, storage and renderer fit together; module map |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Wiring up fffleet (rendering and downloads on workers), S3, varfetch connectors, speech-to-text, YouTube, Facebook |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production notes, checklist, scaling, backups, troubleshooting |
| [docs/API.md](docs/API.md) | HTTP API reference |
| [docs/TEMPLATE_CREATION.md](docs/TEMPLATE_CREATION.md), [docs/GRAPHIC_PACKAGE.md](docs/GRAPHIC_PACKAGE.md) | Templates and the `.svgraphic` graphic package format |
| [docs/YOUTUBE_OAUTH_SETUP.md](docs/YOUTUBE_OAUTH_SETUP.md), [docs/FACEBOOK_SETUP.md](docs/FACEBOOK_SETUP.md) | Publishing setup |
| [CLAUDE.md](CLAUDE.md) | Detailed behaviour of every feature, for contributors and coding assistants |
| [docs/plan.md](docs/plan.md), [docs/technical-phase-plan.md](docs/technical-phase-plan.md) | The original product plan (historical; parts have changed) |

## Tests

```bash
npm test                      # unit tests (run `npx prisma db push` first; some tests use the database)
npm run lint
npx tsc --noEmit
npm run test:e2e              # needs ffmpeg/ffprobe; starts next dev and the worker, drives the real HTTP API
```

## Related projects

[fffleet](https://github.com/jsilvanus/fffleet) (generic ffmpeg job runner), [varfetch](https://github.com/jsilvanus/varfetch) (API connector core), [liturgos-auditor](https://github.com/jsilvanus/liturgos-auditor) (speech-to-text service), [live-captions-yt](https://github.com/jsilvanus/live-captions-yt) (live captions).

## Licence

All rights reserved, except for parts that carry their own licence notice (EUPL-1.2).
