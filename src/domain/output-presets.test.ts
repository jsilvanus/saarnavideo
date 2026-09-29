import { describe, expect, it } from "vitest";
import { aspectLabel, evenDimension, OUTPUT_PRESETS, presetForSize } from "./output-presets";

describe("output presets", () => {
  it("has unique keys and even sizes accepted by the template schema", () => {
    expect(new Set(OUTPUT_PRESETS.map((preset) => preset.key)).size).toBe(OUTPUT_PRESETS.length);
    for (const preset of OUTPUT_PRESETS) {
      expect(evenDimension.safeParse(preset.width).success, preset.key).toBe(true);
      expect(evenDimension.safeParse(preset.height).success, preset.key).toBe(true);
    }
  });

  it("rejects odd and out-of-range sizes", () => {
    expect(evenDimension.safeParse(1081).success).toBe(false);
    expect(evenDimension.safeParse(64).success).toBe(false);
    expect(evenDimension.safeParse(9000).success).toBe(false);
  });

  it("finds the chosen preset among presets that share a size", () => {
    expect(presetForSize(1080, 1920, "tiktok")?.key).toBe("tiktok");
    expect(presetForSize(1080, 1920, "square")?.key).toBe("youtube-shorts");
    expect(presetForSize(999, 998)).toBeUndefined();
  });

  it("labels common aspect ratios", () => {
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectLabel(1080, 1350)).toBe("4:5");
    expect(aspectLabel(1000, 700)).toBe("1.43:1");
  });
});
