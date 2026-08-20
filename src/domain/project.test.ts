import { describe, expect, it } from "vitest";
import { migrateProjectDefinition, validateCompositionSources } from "./project";

describe("project definition multi-source validation", () => {
  it("migrates legacy single-source clips using fallback source id", () => {
    const migrated = migrateProjectDefinition({
      version: 1,
      semanticSegments: [],
      composition: {
        sourceStartSeconds: 10,
        sourceEndSeconds: 20,
        items: [{ type: "source-clip", startSeconds: 10, endSeconds: 20 }],
      },
    }, "source-a");

    expect(migrated.composition.items[0]).toMatchObject({
      type: "source-clip",
      sourceId: "source-a",
      startSeconds: 10,
      endSeconds: 20,
    });
  });

  it("rejects legacy source clips without a resolvable source id", () => {
    expect(() => migrateProjectDefinition({
      version: 1,
      semanticSegments: [],
      composition: {
        items: [{ type: "source-clip", startSeconds: 10, endSeconds: 20 }],
      },
    })).toThrow(/missing sourceId/i);
  });

  it("rejects composition references to missing sources", () => {
    const definition = migrateProjectDefinition({
      version: 1,
      semanticSegments: [],
      composition: {
        items: [{ type: "source-clip", sourceId: "source-a", startSeconds: 10, endSeconds: 20 }],
      },
    });

    expect(() => validateCompositionSources(definition, ["source-b"])).toThrow(/missing sources/i);
  });
});
