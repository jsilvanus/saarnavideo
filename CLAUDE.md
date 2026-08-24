# SaarnaVideo Codebase Documentation

## Project Overview

**SaarnaVideo** is a focused media composition tool for turning worship-service recordings into publishable videos with minimal manual editing. The application enables users to upload recordings, create compositions with overlays and slates, generate polished videos, and publish to YouTube.

### Core Vision
- Minimal manual editing required
- Template-driven composition system
- Multi-step video generation pipeline
- Support for overlays, slates, transitions, and image assets
- YouTube integration for source reference and publication

---

## Repository Structure

### Root Configuration Files
```
├── package.json              # Node.js dependencies and scripts
├── pnpm-workspace.yaml       # pnpm workspace configuration
├── tsconfig.json             # TypeScript configuration
├── .eslintrc.json            # ESLint rules
├── Dockerfile                # Container image definition
├── docker-compose.yml        # PostgreSQL + app development setup
└── .env.example              # Environment variable template
```

### Source Code Organization (`/src`)

#### `/src/app` - Next.js Application Layer
- **`layout.tsx`** - Root layout component
- **`page.tsx`** - Main application page
- **`globals.css`** - Global styles
- **`/api`** - API route handlers
  - **`/projects`** - Project CRUD and orchestration
    - `route.ts` - List/create projects
    - `[id]/` - Single project operations
      - `route.ts` - Get/update/delete project
      - `generate/` - Trigger video generation
      - `publish/` - YouTube publication
      - `duplicate/` - Clone a project
      - `source/` - Source management
      - `assets/` - Image asset upload/management
      - `jobs/` - Generation job status/control
  - **`/sources`** - Source direct operations (bypass project)
  - **`/outputs`** - Download generated videos
  - **`/integrations`** - External service integrations
    - **`/youtube`** - OAuth callback and connection

#### `/src/domain` - Business Logic & Validation
Core domain models using Zod for type-safe validation:
- **`project.ts`** - Project composition schema (timeline items: source-clips, overlays, slates)
- **`templates.ts`** - Template system and template resolution
- **`graphics.ts`** - Graphic elements and scene graphs
- **`transcription.ts`** - Transcription data structures
- **`validation.ts`** - Shared validation utilities
- **`*.test.ts`** - Unit tests for domain logic

#### `/src/components` - React UI Components
- **`CompositionEditor.tsx`** - Interactive composition editor
- **`GraphicEditor.tsx`** - Individual graphic editing
- **`GraphicsEditor.tsx`** - Scene graph editor
- **`SidebarToggle.tsx`** - UI toggle component
- **`/graphics-editor/`** - Graphics editor subcomponents
- **`graphicsEditor*.ts`** - Geometry and interaction logic

#### `/src/integrations` - External Service Integration
- **`youtube.ts`** - YouTube API client
- **`youtube-oauth.ts`** - OAuth authentication flow
- **`transcription.ts`** - Speech-to-text integration
- **`image-assets.ts`** - Image asset handling

#### `/src/renderer` - Video Generation
FFmpeg-based rendering pipeline:
- **`ffmpeg.ts`** - FFmpeg command execution and parsing
- **`composition.ts`** - Composition-to-FFmpeg translation
- **`layers.ts`** - Video layer composition and filtering
- **`*.test.ts`** - Renderer tests with fixtures

#### `/src/worker` - Async Job Processing
- **`index.ts`** - Worker entry point for generating videos
- **`source-resolution.ts`** - Download/acquire source media
- **`sources.ts`** - Source file operations and cleanup
- **`*.test.ts`** - Worker logic tests

#### `/src/lib` - Utilities
- **`prisma.ts`** - Prisma client singleton

#### `/src/types` - TypeScript Type Definitions
- **`youtube.d.ts`** - YouTube API types

### Database Schema (`/prisma`)
- **`schema.prisma`** - SQLite schema (development)
- **`schema.postgresql.prisma`** - PostgreSQL schema (production)

Models:
- **Project** - Composition project with template reference
- **Source** - Media input (upload or YouTube reference)
- **GenerationJob** - Async video generation task
- **Output** - Generated video or thumbnail artifact
- **Publication** - YouTube upload record
- **Asset** - User-uploaded image (overlay, background, logo, font)
- **JobLog** - Generation process logs

Enums:
- SourceType (UPLOAD, YOUTUBE)
- OutputType (VIDEO, THUMBNAIL)
- JobStatus (QUEUED → ACQUIRING_SOURCE → PROCESSING → RENDERING → COMPLETED/FAILED)
- AssetType (OVERLAY, BACKGROUND, LOGO, FONT)
- PublicationStatus (QUEUED → UPLOADING → COMPLETED/FAILED)

### Documentation (`/docs`)
- **`plan.md`** - High-level product roadmap
- **`technical-phase-plan.md`** - Five-phase implementation strategy
- **`API.md`** - API endpoint reference
- **`DEPLOYMENT.md`** - Deployment and environment setup
- **`YOUTUBE_OAUTH_SETUP.md`** - OAuth configuration guide
- **`TEMPLATE_CREATION.md`** - Template system documentation
- **`IMAGE_ASSETS_FEATURE_PLAN.md`** - Image asset feature details

### Python Worker (`/transcription`)
- **`transcribe.py`** - Speech-to-text processing script
- **`requirements.txt`** - Python dependencies

---

## Technology Stack

### Frontend & Backend
- **Next.js 15.5** - React framework with API routes
- **TypeScript 5.9** - Type-safe development
- **React 19.1** - UI components
- **Zod 4.0** - Runtime schema validation

### Database
- **SQLite** - Development database
- **PostgreSQL 17+** - Production database
- **Prisma 6.15** - ORM and migrations

### Media Processing
- **FFmpeg** - Video rendering and composition
- **Python (speech-to-text)** - Transcription pipeline

### Development & Testing
- **Vitest 3.2** - Unit test runner
- **ESLint 8.57** - Code linting
- **tsx 4.20** - TypeScript execution
- **pnpm** - Package manager

### Containerization
- **Docker** - Application container
- **Docker Compose** - Multi-service development

---

## Core Architecture

### Domain Model
```
Project
  ├── Source (uploaded video or YouTube reference)
  ├── Composition (timeline of source clips, overlays, slates)
  ├── GenerationJob (async rendering task)
  ├── Output (rendered video + thumbnail)
  ├── Publication (optional YouTube upload)
  └── Asset (image overlays, backgrounds, logos)
```

### Data Flow
1. **Source Acquisition** - Upload file or reference YouTube URL
2. **Project Definition** - Create composition with timeline items
3. **Asset Upload** - Add custom images for overlays/backgrounds
4. **Job Queue** - Submit for rendering (triggers worker)
5. **Rendering Pipeline**
   - Resolve source segments
   - Composite layers (source + overlays)
   - Apply transitions
   - Generate with FFmpeg
6. **Output Storage** - Download or publish video

### Template System
Projects reference templates by key (e.g., "sermon"). Templates define:
- Default visual styling (colors, fonts, layout)
- Overlay/slate placement and animation
- Composition structure
- Resolution and aspect ratio

### Generation Pipeline Phases
1. **ACQUIRING_SOURCE** - Download/verify source media
2. **PROCESSING** - Parse composition and build FFmpeg commands
3. **RENDERING** - Execute FFmpeg, generate video and thumbnail
4. **COMPLETED/FAILED** - Store outputs or log errors

---

## Key Features Implemented

✅ **Core Rendering**
- Source range selection and cutting
- Timeline-based composition
- Overlay rendering (text, rectangles, images)
- Slate generation (opening/closing cards)
- Transition effects (cut, fade, crossfade)
- FFmpeg-based MP4 output
- Thumbnail generation

✅ **Project Management**
- Create, read, update, delete projects
- Persistent storage with Prisma
- Template-based configuration
- Project duplication

✅ **Source Management**
- Local file upload
- YouTube URL reference (metadata stored)
- Source expiration and cleanup

✅ **Media Assets**
- Custom image upload (overlays, backgrounds)
- Asset type classification
- Per-project asset storage

✅ **Generation & Publishing**
- Async job queue with status tracking
- Worker process for background rendering
- Job logging and error tracking
- YouTube OAuth authentication flow
- Publication queuing

✅ **Development Environment**
- Docker Compose stack
- SQLite for rapid iteration
- PostgreSQL for production
- Automated Prisma setup

---

## API Routes Summary

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/[id]` - Get project details
- `PUT /api/projects/[id]` - Update project
- `DELETE /api/projects/[id]` - Delete project
- `POST /api/projects/[id]/duplicate` - Clone project
- `POST /api/projects/[id]/generate` - Queue generation job
- `POST /api/projects/[id]/publish` - Queue YouTube publication

### Sources
- `POST /api/projects/[id]/source` - Add source to project
- `DELETE /api/projects/[id]/source/[sourceId]` - Remove source
- `GET /api/sources/[sourceId]` - Get source details
- `DELETE /api/sources/[sourceId]` - Delete source directly

### Assets
- `POST /api/projects/[id]/assets` - Upload image asset
- `GET /api/projects/[id]/assets/[assetId]` - Get asset
- `DELETE /api/projects/[id]/assets/[assetId]` - Delete asset

### Jobs
- `GET /api/projects/[id]/jobs` - List generation jobs
- `GET /api/projects/[id]/jobs/[jobId]` - Get job status
- `POST /api/projects/[id]/jobs/[jobId]/cancel` - Cancel running job

### Outputs
- `GET /api/outputs/[id]` - Download generated video

### Integrations
- `GET /api/integrations/youtube/connect` - Start OAuth flow
- `GET /api/integrations/youtube/callback` - OAuth callback handler

---

## Development Workflow

### Setup
```bash
# Install dependencies
npm install

# Initialize database
npx prisma generate
npx prisma db push

# Start PostgreSQL (if using containerized)
docker compose up postgres
```

### Running Locally
```bash
# Development server
npm run dev          # Next.js on http://localhost:3000

# In another terminal: generation worker
npm run worker       # Processes queued jobs

# Tests
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

### Commands
- `npm run lint` - Check code style
- `npm run build` - Production build
- `npm run start` - Serve production build
- `npm run db:push` - Apply schema migrations
- `npm run db:generate` - Regenerate Prisma client

### Testing
- Unit tests use **Vitest** 
- Test files follow `*.test.ts` naming
- Mock FFmpeg output in renderer tests
- Fixture videos stored in test resources

---

## Important Patterns

### Validation
All domain schemas use **Zod** for runtime validation:
```typescript
export const compositionSchema = z.object({ /* ... */ });
export type Composition = z.infer<typeof compositionSchema>;
```

### Error Handling
- Prisma queries handle database errors
- FFmpeg execution captures exit codes and stderr
- Job logs record all processing steps
- Errors stored in GenerationJob.error

### File Expiration
- Sources expire after 7 days by default (configurable via PROJECT_EXPIRATION_DAYS)
- Outputs expire after 7 days
- Expired files auto-cleanup via worker background task

### Type Safety
- Full TypeScript coverage (no `any` without reason)
- Zod schemas derive types for compile-time checking
- React components typed with React.FC or explicit return types

---

## Next Implementation Phases

**Phase 3** (In Progress)
- Rich transcription integration
- AI-powered timestamp suggestions
- Enhanced overlay rendering system

**Phase 4**
- Advanced template customization UI
- Preset management
- Batch generation

**Phase 5**
- Analytics and metrics
- Team collaboration
- API v2 with GraphQL

---

## Common Debugging

### Worker Not Processing Jobs
1. Check worker is running: `npm run worker`
2. Verify database connection and environment variables
3. Check job status: `GET /api/projects/[id]/jobs/[jobId]`
4. Review job logs in database: `GenerationJob.logs`

### FFmpeg Failures
1. Verify FFmpeg installed: `which ffmpeg`
2. Check source file exists and is readable
3. Review FFmpeg command in job logs
4. Test FFmpeg command directly in terminal

### Media Upload Issues
1. Check file permissions and disk space
2. Verify MIME type is supported (video/audio)
3. Review upload size limits in `src/app/api/projects/upload`
4. Check storage path configuration

### Database Issues
1. Verify PostgreSQL running: `docker compose ps`
2. Check DATABASE_URL environment variable
3. Reset with: `npx prisma db push --skip-generate --force-reset` (dev only)
4. Review Prisma logs: `DEBUG=* npm run dev`

---

## File Size Notes
- Large media files are temporary by default (7-day retention)
- Outputs stored in `MEDIA_OUTPUT_PATH` (usually `/tmp/saarnavideo-outputs`)
- Sources cached during job processing, cleaned up after completion
- Asset images stored permanently in database as files

---

## Contact & Maintenance
- See `docs/plan.md` for roadmap
- See `docs/technical-phase-plan.md` for implementation strategy
- Review `docs/API.md` for endpoint details
