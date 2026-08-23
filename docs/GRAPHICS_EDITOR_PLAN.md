# Graphics Editor Roadmap

## Architecture

Keep the separation strict:

```text
Asset (SVG/image)
  -> Layer (SVG/image/text/shape)
  -> Graphic (collection of layers)
  -> Composition (graphic used as slate or overlay)
  -> Render
```

Raw assets are ingredients and are not directly compositable. Composition decides whether a Graphic is a standalone slate or an overlay.

## PR A — Assets & layers

- First-class project assets with stable IDs and metadata.
- SVG upload/gallery and SVG layers.
- Raster image upload/gallery and image layers.
- Reusable assets across multiple graphics.
- Proper layer panel: names, visibility, lock, drag reorder, select, duplicate, delete.

## PR B — Precise editing

- Position inspector (X/Y).
- Size inspector (width/height).
- Rotation and opacity.
- Aspect-ratio lock.
- Numeric editing.
- Keyboard nudging and layer shortcuts.
- Alignment and snapping tools.
- Multi-select and group movement.

## PR C — Production graphics

- Typography controls: font, size, weight, alignment, line height, letter spacing, color, opacity, outline and shadow.
- Safe-area guides, center guides and optional grid.
- Transparent/solid/gradient/image/SVG backgrounds.
- Layer groups and group transforms.

## PR D — Productivity & templates

- Copy/paste layers.
- Copy/paste style.
- Advanced keyboard shortcuts.
- Graphic templates/presets for common church-video graphics.

## Implementation order

Implement A first so the asset/layer model is stable before adding precision and production features. Keep GraphicsEditor as orchestration and put canvas, layer, toolbar, properties and geometry concerns into focused components/modules.
