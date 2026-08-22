import { describe, expect, it } from "vitest";
import { materializeGraphics } from "@/renderer/composition";
import type { ProjectDefinition } from "@/domain/project";

const graphic = {
  id: "gospel",
  name: "Gospel",
  width: 1920,
  height: 1080,
  backgroundColor: "#111111",
  layers: [{ id: "text", type: "text" as const, x: 100, y: 100, width: 1720, height: 300, text: "Gospel", style: {} }],
};

describe("materializeGraphics", () => {
  it("turns a standalone graphic reference into a slate", () => {
    const definition: ProjectDefinition = {
      version: 1,
      semanticSegments: [],
      graphics: [graphic],
      composition: {
        sourceStartSeconds: 0,
        sourceEndSeconds: 10,
        items: [{ type: "slate", graphicId: "gospel", durationSeconds: 5, data: {} }],
      },
    };
    const item = materializeGraphics(definition).composition.items[0];
    expect(item.type).toBe("slate");
    expect(item.template).toBe("rich");
    expect(item.data?.layers).toContain("Gospel");
  });

  it("keeps overlay placement and resolves its layers", () => {
    const definition: ProjectDefinition = {
      version: 1,
      semanticSegments: [],
      graphics: [graphic],
      composition: {
        sourceStartSeconds: 0,
        sourceEndSeconds: 10,
        items: [{ type: "overlay", graphicId: "gospel", startSeconds: 2, endSeconds: 7, data: {} }],
      },
    };
    const item = materializeGraphics(definition).composition.items[0];
    expect(item.type).toBe("overlay");
    expect(item.graphicId).toBe("gospel");
    expect(item.data?.layers).toContain("Gospel");
  });

  it("fails clearly when a referenced graphic is missing", () => {
    const definition: ProjectDefinition = {
      version: 1,
      semanticSegments: [],
      graphics: [],
      composition: {
        sourceStartSeconds: 0,
        sourceEndSeconds: 10,
        items: [{ type: "slate", graphicId: "missing", durationSeconds: 5, data: {} }],
      },
    };
    expect(() => materializeGraphics(definition)).toThrow("Missing graphic definition: missing");
  });
});
