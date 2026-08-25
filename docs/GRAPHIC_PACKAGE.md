# SaarnaVideo graphic package

A graphic belongs to a project. It is not part of the global asset library. Graphics can nevertheless be exported and imported between projects or SaarnaVideo installations.

## File format

The exported file uses the `.svgraphic` extension. It is a UTF-8 JSON document with media assets embedded as base64 data.

Every package starts with a manifest:

```json
{
  "format": "saarnavideo-graphic",
  "version": 1,
  "exportedAt": "2026-08-25T00:00:00.000Z",
  "graphic": { "...": "..." },
  "assets": []
}
```

`version` is the package schema version. Importers must reject unknown versions rather than guessing at the format.

Assets are identified by their SHA-256 content hash. Importing a package reuses an existing matching asset from the global Asset Library, otherwise it creates one. The imported graphic receives a new graphic ID, so it is independent of the source graphic.

## API

- `GET /api/projects/:projectId/graphics/:graphicId/export` downloads a `.svgraphic` package.
- `POST /api/projects/:projectId/graphics/import` accepts the package JSON and adds the graphic to the project.

Graphics remain project-local after import. Assets remain globally reusable.
