import { describe, expect, it } from "vitest";
import { parseJobLimits } from "./job-limits";

describe("parseJobLimits", () => {
  it("is empty when unset", () => {
    expect(parseJobLimits(undefined)).toEqual({});
    expect(parseJobLimits("  ")).toEqual({});
  });
  it("reads TYPE=count pairs", () => {
    expect(parseJobLimits("TRANSCRIBE=2, VIDEO=4")).toEqual({ TRANSCRIBE: 2, VIDEO: 4 });
  });
  it.each(["TRANSCRIBE", "TRANSCRIBE=0", "TRANSCRIBE=1.5", "TRANSCRIBE=x", "NOPE=2", "VIDEO=1=2"])("rejects %s", value => {
    expect(() => parseJobLimits(value)).toThrow(/JOB_LIMITS/);
  });
});
