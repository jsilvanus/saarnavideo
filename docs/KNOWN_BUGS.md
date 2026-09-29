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

## Open

### Asset keys are shared between projects

Uploading identical image bytes reuses the existing library asset, including its
`assetKey`. If project B uploads the same file as "logo" but project A first
uploaded it as "blue", B's overlays that refer to `imageAsset: "logo"` do not
resolve and are silently skipped at render time (graphics that store the
project asset URL are unaffected). Decide whether keys should be per project
(a link-level alias) or the upload should report the existing key, and make an
unresolved key a visible warning. Found via test-order dependence in
`e2e/render.e2e.test.ts`.
