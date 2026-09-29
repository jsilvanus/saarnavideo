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

## Open

### Asset library is not reachable from inside a project

The graphics editor's image picker only lists assets linked to the project.
`POST /api/projects/[id]/assets/[assetId]` links an existing library asset,
but no UI calls it. The only workaround is to upload the same file again in the
project's Graphics tab, which deduplicates by content hash and links it. The
library UI also has no way to delete or rename an asset, although
`PATCH /api/assets/[id]` supports renaming.

### Removing an asset from a project can delete it from the library

`DELETE /api/projects/[id]/assets/[assetId]` deletes the asset row and file
when this was the last linked project. An asset uploaded straight into the
library and then used by a single project disappears from the library. Nothing
in the UI calls this endpoint yet.
