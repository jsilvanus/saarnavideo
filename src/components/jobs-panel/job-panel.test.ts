import { describe, expect, it } from "vitest";
import { makeT } from "@/i18n/translate";
import { formatJobAge, jobDetail, jobPercent, pollInterval } from "./job-panel";

const t = makeT("en");
const now = Date.parse("2026-10-18T12:00:00Z");

describe("job panel helpers", () => {
  it("polls fast while open or active and slowly when idle", () => {
    expect(pollInterval(true, 0)).toBe(3000);
    expect(pollInterval(false, 2)).toBe(3000);
    expect(pollInterval(false, 0)).toBe(15000);
  });
  it("writes ages", () => {
    expect(formatJobAge("2026-10-18T11:59:30Z", now, t)).toBe("30 s ago");
    expect(formatJobAge("2026-10-18T11:55:00Z", now, t)).toBe("5 min ago");
    expect(formatJobAge("2026-10-18T09:00:00Z", now, t)).toBe("3 h ago");
    expect(formatJobAge("2026-10-16T12:00:00Z", now, t)).toBe("2 d ago");
    expect(formatJobAge(null, now, t)).toBe("");
  });
  it("clamps progress and fixes the ends", () => {
    expect(jobPercent({ status: "RUNNING", progress: 42.4 })).toBe(42);
    expect(jobPercent({ status: "RUNNING", progress: 140 })).toBe(100);
    expect(jobPercent({ status: "QUEUED", progress: 30 })).toBe(0);
    expect(jobPercent({ status: "COMPLETED", progress: 0 })).toBe(100);
  });
  it("shows the error of a failed job and the message otherwise", () => {
    expect(jobDetail({ status: "FAILED", error: "boom", message: "x", phase: "y" })).toBe("boom");
    expect(jobDetail({ status: "RUNNING", error: null, message: "STT: position 2", phase: "queued" })).toBe("STT: position 2");
    expect(jobDetail({ status: "RUNNING", error: null, message: null, phase: "ENCODING" })).toBe("ENCODING");
  });
});
