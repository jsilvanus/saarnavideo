import { describe, expect, it } from "vitest";
import { validateRenderSettings } from "./render-settings";

describe("validateRenderSettings", () => {
  it("accepts a definition without size or reframe settings", () => {
    expect(validateRenderSettings({ composition: { items: [] } })).toEqual([]);
    expect(validateRenderSettings(undefined)).toEqual([]);
  });

  it("rejects odd or oversized output sizes", () => {
    expect(validateRenderSettings({ template: { width: 1081, height: 1920 } })[0]).toContain("width");
    expect(validateRenderSettings({ template: { width: 1080, height: 9000 } })[0]).toContain("height");
    expect(validateRenderSettings({ template: { width: 1080, height: 1920 } })).toEqual([]);
  });

  it("names the section or clip with an invalid reframe", () => {
    const issues = validateRenderSettings({
      template: { width: 1080, height: 1920, reframe: { mode: "custom" } },
      sections: [{ label: "Sermon", reframe: { mode: "custom", crop: { x: 0.9, y: 0, w: 0.5, h: 1 } } }],
      composition: { items: [{ type: "source-clip", reframe: { mode: "wide" } }] },
    });
    expect(issues).toHaveLength(3);
    expect(issues[1]).toContain('Section "Sermon"');
    expect(issues[2]).toContain("Clip 1");
  });
});
