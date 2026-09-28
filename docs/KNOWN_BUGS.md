# Known Bugs

Found during the simplify pass on branch `claude/simplify-parallel-chunks-d96zry`.
Neither is fixed yet.

## 1. Project delete never cleans up shared sources and assets

**Where:** `src/app/api/projects/[id]/route.ts`, `DELETE` handler.

After deleting the project, the handler loops over the project's sources and
assets and deletes each one (file + row) only if no other project still uses
it. But the "still used" query is not filtered to the item being checked:

```ts
for (const source of project.sources) {
  const remaining = await prisma.source.count({
    where: { projects: { some: { id: { not: id } } } },
  });
  if (remaining === 0) { /* rm file, delete row */ }
}
```

This counts **every** source linked to any other project, not whether
`source` itself is linked elsewhere. The asset loop has the same shape.

**Effect:**
- As soon as any other project exists with at least one source (or asset),
  `remaining > 0` for every item, so nothing is cleaned up. Files stay on disk
  and rows stay in the database until the expiry cleanup (sources/outputs) —
  and assets, which do not expire, are leaked permanently.
- Only when the deleted project is the last project with sources/assets does
  cleanup happen at all.
- Each item also runs its own `count` query in sequence (N+1 queries).

**Fix:** scope the count to the item, e.g.

```ts
const remaining = await prisma.source.count({
  where: { id: source.id, projects: { some: {} } },
});
```

(after the project has been deleted, so its own link is already gone), and the
same for assets. Alternatively fetch all still-linked ids in one query with
`findMany({ where: { id: { in: ids }, projects: { some: {} } }, select: { id: true } })`
and delete the rest.

## 2. Page-level `<style jsx>` does not reach child components

**Where:** `src/app/page.tsx`, the `<style jsx>` block at the end of the page.

`<style jsx>` (styled-jsx) scopes its rules to elements rendered by the same
component: it adds a generated `jsx-…` class to that component's own JSX and
rewrites every selector to require it. Elements rendered inside child
components do not get that class.

The page's style block contains many rules for classes that only appear in
child components, for example:

- `.composition-editor`, `.resource-bin`, `.composition-item-card`,
  `.overlay-track`, … — rendered by `src/components/CompositionEditor.tsx`
- `.transcription-editor`, `.run-card`, `.segment-row`, `.add-line`, … —
  rendered by `src/components/TranscriptionEditor.tsx`
- `.picker-player` and related player classes — rendered by
  `src/components/SourcePlayer.tsx`
- section classes used by `src/components/SectionManager.tsx`

Those rules therefore most likely never apply, and the child components render
mostly unstyled (only `globals.css` reaches them). `GraphicsEditor.tsx` is not
affected because it has its own `<style jsx>` block.

**To confirm:** open the app, inspect e.g. `.composition-editor` in dev tools
and check whether the page's rules are matched.

**Fix options:**
- Move the shared rules to `src/app/globals.css` (or a CSS module), or
- mark the block `<style jsx global>` (quickest, but makes all of those
  selectors global), or
- give each child component its own `<style jsx>` block for its classes.
