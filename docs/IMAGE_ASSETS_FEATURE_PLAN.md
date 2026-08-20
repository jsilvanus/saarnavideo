# Image Assets Feature Plan

## Overview
Add support for image uploads (PNG, JPEG, WebP) for use in slates, overlays, and theme assets, with full transparency/alpha channel support.

## Goals
1. Enable custom image backgrounds for slates (logos, backgrounds with alpha)
2. Enable image overlays on videos (transparent PNGs)
3. Support theme-level image assets (logos, fonts, backgrounds)
4. Provide simple asset management API
5. Validate and optimize images for video rendering

## Design

### Database Schema Changes
Add `Asset` model to `prisma/schema.prisma`:
```prisma
model Asset {
  id                String   @id @default(cuid())
  projectId         String
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assetKey          String   // e.g., "logo", "background", "overlay-gospel"
  type              String   // "OVERLAY", "BACKGROUND", "LOGO", "FONT"
  storagePath       String
  mimeType          String   // image/png, image/jpeg, image/webp
  width             Int?     // image dimensions
  height            Int?
  sizeBytes         BigInt
  hasAlpha          Boolean  @default(false) // true if PNG with transparency
  expiresAt         DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([projectId])
  @@index([projectId, assetKey])
}
```

Add relation to Project:
```prisma
model Project {
  // ... existing fields ...
  assets            Asset[]
}
```

### Project Definition Schema Extensions

#### Slate with image background:
```typescript
{
  type: "slate",
  template: "opening",
  durationSeconds: 3,
  backgroundImage: "background-asset-key",  // references Asset.assetKey
  data: { title: "Service", subtitle: "Sunday" }
}
```

#### Overlay with image:
```typescript
{
  type: "overlay",
  template: "gospel-overlay",
  startSeconds: 0,
  endSeconds: 30,
  imageAsset: "gospel-overlay-key",  // PNG with transparency
  data: { title: "Gospel Reading" }
}
```

#### Theme with image assets:
```typescript
{
  key: "church-branding",
  assets: {
    logo: "logo-asset-key",
    background: "bg-asset-key",
    font: "custom-font.ttf"
  },
  width: 1920,
  height: 1080,
  backgroundColor: "black"
}
```

### API Endpoints

#### Upload Asset
```
POST /api/projects/[id]/assets
Content-Type: multipart/form-data

Form fields:
  - file: File (image)
  - assetKey: string (e.g., "logo", "gospel-overlay")
  - type: "OVERLAY" | "BACKGROUND" | "LOGO" | "FONT"

Response:
  {
    id: string,
    assetKey: string,
    type: string,
    mimeType: string,
    width: number,
    height: number,
    sizeBytes: string,
    hasAlpha: boolean,
    createdAt: string
  }
```

#### List Assets
```
GET /api/projects/[id]/assets

Response:
  {
    assets: [
      {
        id: string,
        assetKey: string,
        type: string,
        mimeType: string,
        width: number,
        height: number,
        hasAlpha: boolean,
        createdAt: string
      }
    ]
  }
```

#### Delete Asset
```
DELETE /api/projects/[id]/assets/[assetId]

Response: 204 No Content
```

### Image Validation & Storage

**Supported Formats:**
- PNG (with transparency support)
- JPEG (no alpha)
- WebP (with transparency support)

**Size Limits:**
- Max 10 MB per image
- Max 4096x2160 resolution
- Min 100x100 resolution

**Storage:**
- Images stored in `$MEDIA_ROOT/assets/$projectId/`
- Filename: `${assetKey}-${hash}.${ext}`
- Alpha channel detection for PNGs

**Validation Steps:**
1. Check MIME type (whitelist)
2. Check file size against MAX_ASSET_SIZE_BYTES
3. Probe image metadata (dimensions, alpha channel)
4. Store metadata in database
5. Validate resolution constraints

### FFmpeg Integration

**For Image Overlays (PNG with transparency):**
```bash
# Overlay image at position on video
[video][image]overlay=x=10:y=10[out]

# Scale image to specific size
[image]scale=w=200:h=100[scaled]

# Alpha blending
[video][image]overlay=x=10:y=10:enable='between(t,start,end)'[out]
```

**For Image-Based Slates:**
```bash
# Use image as background (scaled to output dimensions)
[image]scale=w=1920:h=1080,setpts=PTS-STARTPTS[bg]

# Overlay text on image if needed
[bg]drawtext=text='Title'[final]
```

**For Image Overlays with Text:**
```bash
# Combine image overlay with text
[video][image]overlay=x=10:y=10[overlay]
[overlay]drawtext=text='Gospel'[final]
```

### Implementation Steps

1. **Database**: Add Asset model to schema, run migration
2. **API**: Create upload, list, delete endpoints with validation
3. **Validation**: Image format detection, size/dimension checks, alpha channel detection
4. **Storage**: Asset file handling with safe paths
5. **FFmpeg**: Extend renderer to support image references
6. **Project Schema**: Update TimelineItem types to include image options
7. **Tests**: Unit tests for validation, FFmpeg filter generation
8. **Docs**: Update TEMPLATE_CREATION.md and API.md

### Backwards Compatibility
- Slates without backgroundImage continue to work (text-only mode)
- Overlays without imageAsset continue to work (text-only mode)
- Existing projects unaffected

### Performance Considerations
- Image metadata cached in database
- Alpha channel detection done once at upload
- Lazy FFmpeg filter generation (only when needed)
- Asset cleanup follows same 7-day retention as videos
- Consider image optimization (convert to WebP, resize if too large)

### Security Considerations
- Validate file types strictly
- Sanitize asset keys (alphanumeric + hyphen/underscore)
- Store images outside web root
- Verify project ownership before asset operations
- Rate limit uploads per project
