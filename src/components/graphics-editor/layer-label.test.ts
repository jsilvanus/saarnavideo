import { describe, expect, it } from "vitest";
import { layerAssetId, layerLabel } from "./layer-label";
import type { Asset, Layer } from "./types";

const t = ((key: string) => key) as never;
const asset: Asset = { id: "a1", assetKey: "logo", type: "LOGO" };
const base = { x: 0, y: 0, width: 10, height: 10 };

describe("layer label", () => {
  it("reads the asset id from a project asset URL", () => {
    expect(layerAssetId("/api/projects/p1/assets/a1")).toBe("a1");
    expect(layerAssetId("/api/projects/p1/assets/a1?x=1")).toBe("a1");
    expect(layerAssetId(undefined)).toBeUndefined();
  });
  it("names an image after its asset, an empty one by kind", () => {
    expect(layerLabel({ ...base, id: "i", type: "image", src: "/api/projects/p1/assets/a1" }, [asset], t)).toBe("logo");
    expect(layerLabel({ ...base, id: "i", type: "image" }, [asset], t)).toBe("ge.layerName.imageEmpty");
  });
  it("names text after its content, shortened", () => {
    const long: Layer = { ...base, id: "x", type: "text", text: "a".repeat(60) };
    expect(layerLabel(long, [], t)).toHaveLength(28);
    expect(layerLabel({ ...base, id: "r", type: "rect" }, [], t)).toBe("ge.layerName.rect");
  });
});
