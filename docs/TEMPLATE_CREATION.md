# Template Creation Guide

SaarnaVideo uses a template system to define reusable composition recipes and visual themes. This guide explains how to create and customize templates.

## Concepts

### Themes
A **Theme** defines visual styling: colors, typography, fonts, logos, and backgrounds. Themes are reusable across multiple templates.

### Templates
A **Template** defines a composition recipe: the structure of opening slates, overlays, source clips, and ending cards. Templates reference a theme for visual styling.

### Composition Factories
A **Composition Factory** is a function that converts semantic segments (gospel, sermon, etc.) into a concrete timeline of video items (slates, source clips, overlays).

## Default Templates

SaarnaVideo ships with three default templates:

### Sermon
- Opening slate (3 seconds)
- Gospel with text overlay
- Sermon source clip
- Ending slate (2 seconds)
- Suitable for: Sunday services with Gospel reading

### Divine Liturgy
- Opening slate (2 seconds)
- Continuous source range covering all marked segments
- No intermediate cards or overlays
- Suitable for: Complete liturgical services

### Vespers
- Opening slate with "Vespers" title (2 seconds)
- Continuous source range
- Suitable for: Evening services

## Creating a Custom Theme

Themes are registered in `src/domain/templates.ts`. To add a custom theme:

### 1. Define Theme Object

```typescript
import { Theme } from "@/domain/templates";

const myTheme: Theme = {
  key: "orthodox-gold",
  name: "Orthodox Gold",
  description: "Traditional Orthodox church theme",
  colors: {
    primary: "#1a472a",        // Deep green
    secondary: "#2d5f40",      // Medium green
    text: "#ffffff",           // White text
    background: "#000000",     // Black background
    accent: "#d4af37",         // Gold accent
  },
  typography: {
    fontFamily: "Georgia, serif",
    fontSize: {
      title: 56,
      subtitle: 40,
      body: 28,
    },
  },
  assets: {
    logo: "/assets/logo.png",           // Optional: path to logo image
    background: "/assets/bg.jpg",       // Optional: background image
    fontFile: "/fonts/georgia.ttf",     // Optional: custom font file
  },
};
```

### 2. Register Theme

In `src/domain/templates.ts`, add to `initializeDefaultTemplates()`:

```typescript
export function initializeDefaultTemplates(): TemplateRegistry {
  const registry = new TemplateRegistry();

  // Register your theme
  registry.registerTheme(myTheme);

  // ... rest of initialization
}
```

## Creating a Custom Template

### 1. Create Composition Factory

A composition factory converts semantic segments into timeline items. Example:

```typescript
import type { TimelineItem } from "@/domain/project";
import type { Theme } from "@/domain/templates";

export function myCustomComposition(
  sourceId: string,
  segments: Record<string, { startSeconds: number; endSeconds: number }>,
  theme: Theme
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Opening slate with custom design
  items.push({
    type: "slate",
    template: "custom-opening",  // References a slate template
    durationSeconds: 5,
    data: {
      title: "Divine Service",
      subtitle: "Streaming Live",
      logo: theme.assets?.logo,
      backgroundColor: theme.colors.primary,
      textColor: theme.colors.text,
    },
  });

  // Gospel with custom overlay
  if (segments.gospel) {
    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: segments.gospel.startSeconds,
      endSeconds: segments.gospel.endSeconds,
      transitionIn: { type: "fade", durationSeconds: 0.5 },
    });

    items.push({
      type: "overlay",
      template: "gospel-scroll",  // Custom Gospel display
      startSeconds: 0,
      endSeconds: segments.gospel.endSeconds - segments.gospel.startSeconds,
      data: {
        text: "Holy Gospel",
        scrollSpeed: "slow",
        textColor: theme.colors.accent,
      },
    });
  }

  // Sermon
  if (segments.sermon) {
    items.push({
      type: "source-clip",
      sourceId,
      startSeconds: segments.sermon.startSeconds,
      endSeconds: segments.sermon.endSeconds,
      transitionIn: { type: "crossfade", durationSeconds: 1.0 },
    });
  }

  // Credits slide
  items.push({
    type: "slate",
    template: "credits",
    durationSeconds: 3,
    data: {
      title: "Glory to God",
      subtitle: "In all things",
    },
  });

  return items;
}
```

### 2. Register Composition Factory

In `src/domain/templates.ts`, add to `COMPOSITION_FACTORIES`:

```typescript
const COMPOSITION_FACTORIES: Record<string, CompositionFactory> = {
  sermon: sermonComposition,
  myCustom: myCustomComposition,  // Add yours
};
```

### 3. Create Template Definition

```typescript
import { TemplateDefinition } from "@/domain/templates";

const myTemplate: TemplateDefinition = {
  key: "custom-service",
  name: "Custom Service",
  description: "Customized composition for our church",
  themeKey: "orthodox-gold",  // References theme from step 1
  version: 1,
  expectedSegments: ["gospel", "sermon", "creed"],
  renderSettings: {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: "5500k",      // Higher quality
    audioCodec: "aac",
    audioSampleRate: 48000,
  },
  compositionFactory: "myCustom",  // Must match factory key
  thumbnail: {
    factory: "custom-thumbnail",  // Optional: custom thumbnail factory
    height: 720,
    width: 1280,
  },
};
```

### 4. Register Template

In `initializeDefaultTemplates()`:

```typescript
registry.registerTheme(myTheme);
registry.registerTemplate(myTemplate);
```

## Slate Templates

Slates are generated title cards. Define them in FFmpeg rendering or as image templates.

### Example: Opening Slate

Slates are rendered by FFmpeg with colors and text specified in composition data:

```typescript
{
  type: "slate",
  template: "opening",
  durationSeconds: 3,
  data: {
    title: "Service Title",
    subtitle: "Preacher Name",
    // Additional data for the slate renderer
    textAlign: "center",
    textSize: "large",
  },
}
```

## Overlay Templates

Overlays are rendered on top of source video. Example:

```typescript
{
  type: "overlay",
  template: "gospel-text",  // Identifies overlay type
  startSeconds: 0,          // Start time within source clip
  endSeconds: 300,          // End time within source clip
  data: {
    text: "Gospel according to St. Matthew",
    position: "bottom",
    backgroundColor: "rgba(0,0,0,0.7)",
    textColor: "#ffffff",
  },
}
```

## Using Images in Slates and Overlays

SaarnaVideo supports uploading custom images (PNG, JPEG, WebP) for use in slates and overlays. This enables rich visual branding with transparency support.

### 1. Upload an Image Asset

First, upload an image to a project:

```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/assets \
  -F "file=@logo.png" \
  -F "assetKey=logo" \
  -F "type=LOGO"
```

**Asset Types:**
- `LOGO` - Standalone logo images
- `BACKGROUND` - Background images for slates
- `OVERLAY` - PNG images with transparency for overlays
- `FONT` - Custom font files (TTF, OTF)

**Image Requirements:**
- Supported formats: PNG (recommended with transparency), JPEG, WebP
- Max size: 10 MB
- Max dimensions: 4096x2160 (4K)
- Min dimensions: 100x100
- PNG with alpha channel (transparency) works best for overlays

### 2. Use Image in Slate (Background)

Reference the uploaded image as a background in a slate:

```typescript
{
  type: "slate",
  template: "opening",
  backgroundImage: "logo",  // References assetKey from upload
  durationSeconds: 3,
  data: {
    title: "Divine Service",
    subtitle: "St. John's Church",
    // Additional text will be rendered on top of the image
  },
}
```

**How it works:**
- The image is scaled to output dimensions (1920x1080 by default)
- Text from `data.title` and `data.subtitle` is rendered on top
- Preserves image transparency and color information

### 3. Use Image in Overlay

Reference a transparent PNG image as an overlay:

```typescript
{
  type: "overlay",
  template: "branding",
  imageAsset: "gospel-logo",  // References assetKey (use PNG with transparency)
  startSeconds: 0,
  endSeconds: 300,
  data: {
    // Additional text data is optional
    title: "Gospel Reading",
  },
}
```

**How it works:**
- PNG transparency is fully preserved
- Image is positioned at top-left (x=10, y=10)
- Consider using PNG with alpha channel for best results
- Overlay is applied only during specified time range

### 4. Complete Example: Custom Theme with Images

```typescript
import { Theme } from "@/domain/templates";

const churchTheme: Theme = {
  key: "church-branding-2024",
  name: "Church Branding 2024",
  description: "Official church branding with logo and colors",
  colors: {
    primary: "#1a472a",
    text: "#ffffff",
    background: "#000000",
    accent: "#d4af37",
  },
  typography: {
    fontFamily: "Georgia, serif",
    fontSize: { title: 56, subtitle: 40, body: 28 },
  },
  assets: {
    logo: "church-logo",        // References uploaded asset key
    background: "bg-pattern",   // References uploaded asset key
  },
};

export function brandedComposition(
  sourceId: string,
  segments: Record<string, { startSeconds: number; endSeconds: number }>,
  theme: Theme
): TimelineItem[] {
  return [
    // Opening with branding
    {
      type: "slate",
      template: "opening",
      backgroundImage: theme.assets?.logo,  // Use uploaded logo as background
      durationSeconds: 3,
      data: {
        title: "Sunday Divine Liturgy",
        subtitle: "August 20, 2024",
      },
    },

    // Gospel with overlay
    {
      type: "source-clip",
      sourceId,
      startSeconds: segments.gospel.startSeconds,
      endSeconds: segments.gospel.endSeconds,
    },
    {
      type: "overlay",
      template: "gospel",
      imageAsset: theme.assets?.logo,  // Overlay transparent logo
      startSeconds: 0,
      endSeconds: segments.gospel.endSeconds - segments.gospel.startSeconds,
    },

    // Sermon
    {
      type: "source-clip",
      sourceId,
      startSeconds: segments.sermon.startSeconds,
      endSeconds: segments.sermon.endSeconds,
    },

    // Closing with branding
    {
      type: "slate",
      template: "closing",
      backgroundImage: theme.assets?.background,  // Use background image
      durationSeconds: 2,
      data: {
        title: "Glory to God",
      },
    },
  ];
}
```

## Thumbnail Factory

Optional: Define custom thumbnail generation:

```typescript
export type ThumbnailFactory = (
  sourceFilePath: string,
  outputPath: string,
  template: TemplateDefinition,
  theme: Theme,
  projectMetadata: { title: string; preacher?: string }
) => Promise<void>;

const THUMBNAIL_FACTORIES: Record<string, ThumbnailFactory> = {
  "custom-thumbnail": async (sourcePath, outputPath, template, theme, metadata) => {
    // Use FFmpeg to generate a custom thumbnail with overlays
    // Example: Add title text and branding
  },
};
```

## Testing Your Template

### 1. Verify Template Loads

```typescript
import { getTemplateRegistry } from "@/domain/templates";

const registry = getTemplateRegistry();
const myTemplate = registry.getTemplate("custom-service");
console.log("Template loaded:", myTemplate);
```

### 2. Create a Test Project

Use the API to create a project with your template:

```json
POST /api/projects
{
  "title": "Test Service",
  "preacher": "Fr. John",
  "templateKey": "custom-service",
  "semanticSegments": [
    {"id": "gospel", "label": "Gospel", "startSeconds": 300, "endSeconds": 600},
    {"id": "sermon", "label": "Sermon", "startSeconds": 600, "endSeconds": 2400}
  ]
}
```

### 3. Upload Source and Generate

Complete the workflow to test your template rendering.

## Advanced: Custom FFmpeg Filters

For complex compositions, implement custom FFmpeg filter generation:

```typescript
// In ffmpeg.ts or separate filter builder

export function buildGospelOverlay(
  gospelText: string,
  startSeconds: number,
  endSeconds: number
): string {
  const escapedText = escapeFilterText(gospelText);
  return `drawtext=text='${escapedText}':x=(w-text_w)/2:y=h-100:fontsize=32:fontcolor=white:borderw=2:bordercolor=black`;
}
```

## Template Registry & Discovery

Templates are discovered and validated at startup:

```bash
npm run build  # Validates all templates
```

To list available templates programmatically:

```typescript
const registry = getTemplateRegistry();
const templates = registry.listTemplates();
templates.forEach(t => console.log(`${t.key}: ${t.name}`));
```

## Best Practices

1. **Keep templates focused** - One template per service type/style
2. **Reuse themes** - Share themes across templates to maintain consistency
3. **Document segments** - Clearly specify which semantic segments each template expects
4. **Test transitions** - Verify fade/crossfade durations work smoothly
5. **Consider mobile** - Text size, colors should be legible on small screens
6. **Version templates** - Increment version when changing composition or rendering
7. **Fallback gracefully** - If optional segments missing, composition should still work

## Troubleshooting

### Template Not Found
- Verify template key is registered in `initializeDefaultTemplates()`
- Check for typos in `templateKey` in project

### Composition Factory Error
- Verify factory function signature: `(sourceId, segments, theme) => TimelineItem[]`
- Check factory is registered in `COMPOSITION_FACTORIES`

### FFmpeg Rendering Error
- Check theme colors are valid hex: `#RRGGBB`
- Verify font files exist if specified
- Check segment times don't exceed source duration

### Overlay Not Appearing
- Verify overlay `startSeconds` and `endSeconds` are within source clip range
- Check overlay template name matches renderer expectations

## Contributing Templates

Share templates with the community:
1. Create theme + template in PR
2. Include tests and documentation
3. Provide example screenshot/output
4. Submit to GitHub

## Resources

- FFmpeg documentation: https://ffmpeg.org/documentation.html
- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
- Color picker: https://htmlcolorcodes.com
- Typography tools: https://www.fontpair.co
