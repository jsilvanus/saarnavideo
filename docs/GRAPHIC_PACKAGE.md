# SaarnaVideo graphic package

A graphic belongs to a project. It is not part of the global asset library. Graphics can nevertheless be exported and imported between projects or SaarnaVideo installations.

## File format

The exported file uses the `.svgraphic` extension and is a UTF-8 JSON document. Every package starts with a versioned manifest:

```json
{
  "format": "saarnavideo-graphic",
  "version": 1,
  "assetMode": "embedded",
  "exportedAt": "2026-08-25T00:00:00.000Z",
  "graphic": { "...": "..." },
  "assets": []
}
```

`version` is the package schema version. Importers must reject unknown versions rather than guessing at the format.

## Asset modes

There are two package variants. Both use the same `.svgraphic` format and manifest version.

### Embedded

`assetMode` is `embedded`. Each asset contains `dataBase64`, so the package is self-contained and can be moved to another SaarnaVideo installation without first copying assets to its Asset Library.

```json
{
  "assetMode": "embedded",
  "assets": [{
    "sourceAssetId": "...",
    "contentHash": "sha256 hex",
    "assetKey": "logo",
    "mimeType": "image/png",
    "width": 100,
    "height": 100,
    "hasAlpha": true,
    "dataBase64": "..."
  }]
}
```

On import, the SHA-256 is verified. Matching assets are reused; missing assets are created in the global Asset Library.

### Referenced

`assetMode` is `referenced`. Assets contain their stable content hash and metadata but no file bytes.

```json
{
  "assetMode": "referenced",
  "assets": [{
    "sourceAssetId": "...",
    "contentHash": "sha256 hex",
    "assetKey": "logo",
    "mimeType": "image/png",
    "width": 100,
    "height": 100,
    "hasAlpha": true
  }]
}
```

The destination must already have matching assets in its Asset Library. The importer does not substitute an asset merely because its name matches; content hash and MIME type are used for resolution. Missing references are reported and the graphic is not imported.

## API

- `GET /api/projects/:projectId/graphics/:graphicId/export` downloads an embedded package.
- `GET /api/projects/:projectId/graphics/:graphicId/export?assetMode=referenced` downloads a lightweight referenced package.
- `POST /api/projects/:projectId/graphics/import` accepts either package variant and adds the graphic to the project.

Graphics remain project-local after import. Assets remain globally reusable.
