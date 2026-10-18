import { describe, expect, it } from "vitest";
import { makeT } from "@/i18n/translate";
import { canCancelJob, formatJobAge, jobDetail, jobPercent, modeSymbol, nextConfirm, pollInterval } from "./job-panel";

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
  it("offers cancel by status unless the row says otherwise", () => {
    const base = { status: "RUNNING", cancelRequested: false };
    expect(canCancelJob(base)).toBe(true);
    expect(canCancelJob({ ...base, status: "QUEUED" })).toBe(true);
    expect(canCancelJob({ ...base, status: "COMPLETED" })).toBe(false);
    expect(canCancelJob({ ...base, cancellable: false })).toBe(false);
    expect(canCancelJob({ ...base, cancellable: true })).toBe(true);
    expect(canCancelJob({ ...base, cancelRequested: true })).toBe(false);
    expect(canCancelJob(base, false)).toBe(false);
  });
  it("confirms a cancel in two steps", () => {
    let c: string | null = null;
    c = nextConfirm(c, "ask", "a");
    expect(c).toBe("a");
    c = nextConfirm(c, "ask", "b");
    expect(c).toBe("b");
    expect(nextConfirm(c, "no", "a")).toBe("b");
    expect(nextConfirm(c, "no", "b")).toBeNull();
    expect(nextConfirm(c, "yes", "b")).toBeNull();
  });
  it("shows a mode symbol with translated labels only when set", () => {
    expect(modeSymbol(undefined)).toBeNull();
    for (const mode of ["pull", "push"] as const) {
      const m = modeSymbol(mode)!;
      expect(m.key).toBe(`jobs.mode.${mode}`);
      expect(t(m.key)).not.toBe(m.key);
    }
    expect(modeSymbol("pull")!.symbol).not.toBe(modeSymbol("push")!.symbol);
  });
  it("has the confirm keys in every language", () => {
    for (const l of ["fi", "en", "sv"] as const) {
      const tl = makeT(l);
      for (const k of ["jobs.cancel", "jobs.cancelConfirm", "jobs.cancelYes", "jobs.cancelNo", "jobs.mode.pull", "jobs.mode.push"]) expect(tl(k as never)).not.toBe(k);
    }
  });
});
