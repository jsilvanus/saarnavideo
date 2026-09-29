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

## Caption layer (caption styles)

A layer of `"type": "caption"` marks a graphic as a **caption style** used for burned-in captions (`captions.mode` `burn`/`both` with `styleGraphicId`, see `docs/API.md`). It is a placeholder text box: `x`, `y`, `width`, `height` (in the graphic's own coordinate space, 1920x1080 by default; scaled to the video size on render) are the area the captions are laid out in, `text` is only preview sample text (`Esimerkkiteksti`), and `style` carries the look:

| key | meaning | default |
| --- | --- | --- |
| `font-family` | first family is used; generic names map to DejaVu Sans; the template font file wins when set | `DejaVu Sans` |
| `font-size` | e.g. `56px` (scaled with the video) | `56px` |
| `font-weight` | `bold` or >= 600 is bold | `700` |
| `color` | text colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, a few names) | `#ffffff` |
| `text-align` | `left` / `center` / `right` | `center` |
| `vertical-align` | `top` / `middle` / `bottom`: edge of the box the text is anchored to | `bottom` |
| `background` | box behind the text (rgba ok); empty or `transparent` = none. Drawn as one bar across the box width, as tall as the cue's lines | none |
| `padding` | px between box edge and text | `12px` |
| `text-shadow` | `0 2px 4px #000`: the second number is the shadow depth | none |
| `-webkit-text-stroke` | `2px #000`: text outline | none |
| `max-lines` | 1-6; also limited by the box height | `2` |
| `opacity` | multiplies text and box alpha | `1` |

Wrapping estimates text width as `font-size x 0.55` per character (`0.6` bold), an approximation for DejaVu Sans, so lines are slightly short rather than too long. The package format version stays `1`; caption layers are ordinary layers, but importers from before this change reject the unknown layer type. Graphics are still project-local: to reuse a caption style in another project, export it and import it there. A caption layer inside a graphic used as a slate or overlay is ignored.
