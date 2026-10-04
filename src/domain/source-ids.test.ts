import { describe, expect, it } from "vitest";
import { remapSourceIds } from "./source-ids";

describe("remapSourceIds", () => {
  const definition = {
    version: 1,
    semanticSegments: [{ id: "a", sourceId: "old1" }, { id: "b" }],
    sections: [{ id: "s", sourceId: "old2" }, { id: "t", sourceId: "unmapped" }],
    composition: { sourceStartSeconds: 0, items: [{ type: "source-clip", sourceId: "old1" }, { type: "slate" }, { type: "audio-clip", assetId: "old1" }] },
    graphics: [{ id: "g" }],
  };

  it("translates source ids in clips, sections and segments only", () => {
    const next = remapSourceIds(definition, new Map([["old1", "new1"], ["old2", "new2"]]));
    expect(next.semanticSegments).toEqual([{ id: "a", sourceId: "new1" }, { id: "b" }]);
    expect(next.sections).toEqual([{ id: "s", sourceId: "new2" }, { id: "t", sourceId: "unmapped" }]);
    expect(next.composition.items).toEqual([{ type: "source-clip", sourceId: "new1" }, { type: "slate" }, { type: "audio-clip", assetId: "old1" }]);
    expect(next.graphics).toBe(definition.graphics);
  });

  it("does not modify its input and tolerates empty or malformed definitions", () => {
    const before = JSON.stringify(definition);
    remapSourceIds(definition, new Map([["old1", "x"]]));
    expect(JSON.stringify(definition)).toBe(before);
    expect(remapSourceIds(null, new Map([["a", "b"]]))).toBeNull();
    expect(remapSourceIds({}, new Map([["a", "b"]]))).toEqual({});
    expect(remapSourceIds(definition, new Map())).toBe(definition);
  });
});
