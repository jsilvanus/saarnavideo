import { describe, expect, it } from "vitest";
import { formatRenderTime, groupOutputsByRender } from "@/domain/output-groups";

const out = (id: string, jobId: string | null, createdAt: string) => ({ id, jobId, createdAt });

describe("groupOutputsByRender", () => {
  it("puts every output of one render together, newest render first", () => {
    const groups = groupOutputsByRender([
      out("v1", "jobA", "2026-10-17T12:00:05.000Z"),
      out("t1", "jobA", "2026-10-17T12:00:06.000Z"),
      out("v2", "jobB", "2026-10-18T14:32:00.000Z"),
      out("s2", "jobB", "2026-10-18T14:32:01.000Z"),
      out("c2", "jobB", "2026-10-18T14:31:59.000Z"),
    ]);
    expect(groups.map(g => g.jobId)).toEqual(["jobB", "jobA"]);
    expect(groups[0].outputs.map(o => o.id)).toEqual(["c2", "v2", "s2"]);
    expect(groups[0].producedAt).toBe("2026-10-18T14:32:01.000Z");
    expect(groups[1].outputs.map(o => o.id)).toEqual(["v1", "t1"]);
  });

  it("keeps an output without a job as its own group", () => {
    const groups = groupOutputsByRender([out("legacy", null, "2026-01-01T00:00:00.000Z"), out("v", "j", "2026-02-01T00:00:00.000Z")]);
    expect(groups.map(g => g.key)).toEqual(["job:j", "output:legacy"]);
    expect(groups[1].jobId).toBeNull();
  });

  it("accepts Date objects, and puts groups of unknown time last", () => {
    const groups = groupOutputsByRender([
      { id: "nodate", jobId: "x", createdAt: null },
      { id: "d", jobId: "y", createdAt: new Date("2026-03-01T10:00:00.000Z") },
    ]);
    expect(groups.map(g => g.key)).toEqual(["job:y", "job:x"]);
    expect(groups[0].producedAt).toBe("2026-03-01T10:00:00.000Z");
    expect(groups[1].producedAt).toBeNull();
  });

  it("returns nothing for no outputs", () => {
    expect(groupOutputsByRender([])).toEqual([]);
  });
});

describe("formatRenderTime", () => {
  const now = new Date(2026, 9, 18, 16, 0); // 18 October 2026, local time

  it("says Today with the time on the same day, and the date and time otherwise", () => {
    expect(formatRenderTime(new Date(2026, 9, 18, 14, 32).toISOString(), now, "en-GB", "Today")).toBe("Today 14:32");
    expect(formatRenderTime(new Date(2026, 9, 17, 9, 5).toISOString(), now, "en-GB", "Today")).toBe("17/10/2026 09:05");
    // Finnish writes the time with a dot (Intl's fi-FI pattern).
    expect(formatRenderTime(new Date(2026, 9, 18, 14, 32).toISOString(), now, "fi-FI", "Tänään")).toBe("Tänään 14.32");
  });
});
