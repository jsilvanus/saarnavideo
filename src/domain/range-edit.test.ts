import { describe, expect, it } from "vitest";
import { editRange, snapTime } from "./range-edit";

const bounds = { start: 10, end: 40 };
const range = { start: 20, end: 25 };

describe("editRange", () => {
  it("snaps to a tenth of a second", () => {
    expect(snapTime(12.34)).toBeCloseTo(12.3);
    expect(editRange(range, { edge: "start", to: 18.26 }, bounds)).toEqual({ start: 18.3, end: 25 });
    expect(editRange(range, { edge: "end", to: 31.04 }, bounds)).toEqual({ start: 20, end: 31 });
  });
  it("keeps the minimum length when an edge is dragged past the other", () => {
    expect(editRange(range, { edge: "start", to: 30 }, bounds)).toEqual({ start: 24.5, end: 25 });
    expect(editRange(range, { edge: "end", to: 5 }, bounds)).toEqual({ start: 20, end: 20.5 });
  });
  it("stays inside the clip", () => {
    expect(editRange(range, { edge: "start", to: 2 }, bounds)).toEqual({ start: 10, end: 25 });
    expect(editRange(range, { edge: "end", to: 99 }, bounds)).toEqual({ start: 20, end: 40 });
  });
  it("moves the block without changing its length and stops at the bounds", () => {
    expect(editRange(range, { edge: "move", by: 3.07 }, bounds)).toEqual({ start: 23.1, end: 28.1 });
    expect(editRange(range, { edge: "move", by: 100 }, bounds)).toEqual({ start: 35, end: 40 });
    expect(editRange(range, { edge: "move", by: -100 }, bounds)).toEqual({ start: 10, end: 15 });
  });
  it("cuts to a bounds shorter than the minimum", () => {
    expect(editRange({ start: 10, end: 10.3 }, { edge: "end", to: 11 }, { start: 10, end: 10.3 })).toEqual({ start: 10, end: 10.3 });
  });
});
