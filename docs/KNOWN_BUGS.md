# Known Bugs

## Fixed

- **Project delete never cleaned up sources** (`src/app/api/projects/[id]/route.ts`).
  The "still used" check was not scoped to the source being checked. Unlinked
  sources are now deleted, and a file is removed only when no Source row
  references its `storagePath` any more (duplicated projects share files).
  Assets are library items and are only unlinked, never deleted, with a project.
- **Page-level `<style jsx>` did not reach child components** (`src/app/page.tsx`).
  The block is now `<style jsx global>`, so CompositionEditor,
  TranscriptionEditor, SourcePlayer and SectionManager get their styles while
  the page is mounted.
- **"Render fast preview" queued a full render.** The UI sends `{ preview: true }`
  but the generate route only read `type`. Covered by `e2e/render.e2e.test.ts`.
- **Renderer and worker bugs found by the e2e suite** (`e2e/render.e2e.test.ts`):
  - Multi-clip renders failed: `concat` inputs were ordered video, video, audio,
    audio instead of interleaved per segment (`src/renderer/ffmpeg.ts`).
  - The worker crashed on every render: FFmpeg's first progress line is
    `out_time_ms=N/A`, and `BigInt(NaN)` threw inside a stream handler.
  - Overlays saved without `opacity` rendered `aa=undefined`; defaults are now applied.
  - Image overlays and slate background images never terminated (looped input);
    rich-graphic image layers passed unsupported `w`/`h` options to `overlay`.
- **Asset library was not reachable from inside a project.** New `AssetPicker`
  (`src/components/AssetPicker.tsx`) browses the library (folders, search, image/audio
  filter, thumbnails and audio players, "In this project" badges) and links with one click.
  Used as "Add from library" in the Graphics tab, "Choose from library" in the graphics
  editor's image layer picker and "Add from library" in the Voiceover tab. The library page
  can now rename (validated, 409 on a duplicate name) and delete assets (409 while linked).
- **Removing an asset from a project could delete it from the library.**
  `DELETE /api/projects/[id]/assets/[assetId]` now only unlinks. It answers 409 with a
  `usage` list while the project's definition still refers to the asset (`?force=1` to
  unlink anyway); the Graphics tab has a "Remove from project" action with that warning.
- **Graphics editor styles missing** (`GraphicsEditor.tsx`): the scoped `<style jsx>` no
  longer reached the extracted sub-components (canvas and property panel rendered
  unstyled); it is now `<style jsx global>`.
- **Asset keys shared between projects.** Identical image bytes reuse the library asset and its key, so a
  second project's overlays that named the file differently did not resolve and were silently skipped. The
  upload response now says `reused: true` and `requestedKey` (the UI tells the uploader which name to use), the
  generate route returns `assetWarnings` for image references that name no linked asset, and the worker writes
  a WARN job log for each. (`src/domain/asset-usage.ts`, `findUnresolvedImageRefs`; `e2e/asset-library.e2e.test.ts`.)
- **Duplicated projects pointed at the original's sources.** The duplicate got its own source rows but kept
  the original source ids in clips, sections and segments, so rendering the copy failed with a missing source
  path. The ids are translated (`src/domain/source-ids.ts`, `e2e/render.e2e.test.ts`).
- **A rejected YouTube thumbnail failed a published video.** The video was already on YouTube, so the
  publication read FAILED and a retry would have uploaded it twice. The thumbnail is now best effort (WARN job log).

## Open

None known.
