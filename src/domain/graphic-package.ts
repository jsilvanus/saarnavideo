import { z } from "zod";
import { graphicSchema, type Graphic } from "@/domain/graphics";

export const GRAPHIC_PACKAGE_FORMAT = "saarnavideo-graphic" as const;
export const GRAPHIC_PACKAGE_VERSION = 1 as const;

const commonAssetSchema = z.object({
  sourceAssetId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  assetKey: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  hasAlpha: z.boolean(),
});

const embeddedAssetSchema = commonAssetSchema.extend({
  dataBase64: z.string().min(1),
});

const referencedAssetSchema = commonAssetSchema;

export const graphicPackageAssetSchema = z.discriminatedUnion("assetMode", [
  embeddedAssetSchema.extend({ assetMode: z.literal("embedded") }),
  referencedAssetSchema.extend({ assetMode: z.literal("referenced") }),
]);

export const graphicPackageManifestSchema = z.object({
  format: z.literal(GRAPHIC_PACKAGE_FORMAT),
  version: z.literal(GRAPHIC_PACKAGE_VERSION),
  exportedAt: z.string().datetime(),
  assetMode: z.enum(["embedded", "referenced"]),
  graphic: graphicSchema,
  assets: z.array(graphicPackageAssetSchema),
});

export type GraphicPackage = z.infer<typeof graphicPackageManifestSchema>;
export type GraphicPackageAsset = GraphicPackage["assets"][number];

export function createGraphicPackage(
  graphic: Graphic,
  assets: GraphicPackageAsset[],
  assetMode: "embedded" | "referenced" = "embedded",
): GraphicPackage {
  const normalizedAssets = assets.map((asset) => {
    if (assetMode === "embedded") {
      if (!("dataBase64" in asset) || !asset.dataBase64) throw new Error(`Embedded package asset is missing data: ${asset.assetKey}`);
      return { ...asset, assetMode: "embedded" as const };
    }
    const { dataBase64: _dataBase64, ...reference } = asset as GraphicPackageAsset & { dataBase64?: string };
    return { ...reference, assetMode: "referenced" as const };
  });

  return graphicPackageManifestSchema.parse({
    format: GRAPHIC_PACKAGE_FORMAT,
    version: GRAPHIC_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    assetMode,
    graphic,
    assets: normalizedAssets,
  });
}

export function parseGraphicPackage(input: unknown): GraphicPackage {
  return graphicPackageManifestSchema.parse(input);
}
