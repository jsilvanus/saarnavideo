import { z } from "zod";
import { graphicSchema, type Graphic } from "@/domain/graphics";

export const GRAPHIC_PACKAGE_FORMAT = "saarnavideo-graphic" as const;
export const GRAPHIC_PACKAGE_VERSION = 1 as const;

export const graphicPackageAssetSchema = z.object({
  sourceAssetId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  assetKey: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  hasAlpha: z.boolean(),
  dataBase64: z.string().min(1),
});

export const graphicPackageManifestSchema = z.object({
  format: z.literal(GRAPHIC_PACKAGE_FORMAT),
  version: z.literal(GRAPHIC_PACKAGE_VERSION),
  exportedAt: z.string().datetime(),
  graphic: graphicSchema,
  assets: z.array(graphicPackageAssetSchema),
});

export type GraphicPackage = z.infer<typeof graphicPackageManifestSchema>;

export function createGraphicPackage(graphic: Graphic, assets: GraphicPackage["assets"]): GraphicPackage {
  return graphicPackageManifestSchema.parse({ format: GRAPHIC_PACKAGE_FORMAT, version: GRAPHIC_PACKAGE_VERSION, exportedAt: new Date().toISOString(), graphic, assets });
}

export function parseGraphicPackage(input: unknown): GraphicPackage {
  return graphicPackageManifestSchema.parse(input);
}
