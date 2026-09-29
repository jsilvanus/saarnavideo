import { describe, expect, it } from "vitest";
import { findAssetUsage } from "./asset-usage";

const asset = { id: "a1", assetKey: "logo" };

describe("findAssetUsage", () => {
  it("finds graphic layers, composition items and podcast settings", () => {
    const definition = {
      graphics: [{ id: "g1", name: "Title", layers: [{ type: "image", src: "/api/projects/p/assets/a1" }, { type: "text" }] }, { id: "g2", name: "Other", layers: [{ type: "image", src: "/api/projects/p/assets/zzz" }] }],
      composition: { items: [{ type: "source-clip" }, { type: "overlay", imageAsset: "logo" }, { type: "slate", backgroundImage: "a1" }, { type: "audio-clip", assetId: "a1" }] },
      podcast: { introAssetId: "a1", outroAssetId: "other" },
    };
    expect(findAssetUsage(definition, asset)).toEqual(['graphic "Title"', "composition item 2 (overlay)", "composition item 3 (slate)", "composition item 4 (audio-clip)", "podcast intro"]);
  });

  it("returns nothing for unrelated or malformed definitions", () => {
    expect(findAssetUsage(null, asset)).toEqual([]);
    expect(findAssetUsage({ graphics: [{ layers: [{ src: "/api/projects/p/assets/a10" }] }] }, asset)).toEqual([]);
  });
});
