import { describe, expect, it } from "vitest";
import { clockTime, sttQueueMessage } from "./stt-queue";

const base = { position: 2, seconds_ahead: 600, unknown_ahead: 0, estimated_start_seconds: 600, estimated_finish_seconds: 900, estimate_is_minimum: false };

describe("sttQueueMessage", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("shows position and the clock time the job should start", () => {
    expect(sttQueueMessage(base, now)).toBe(`STT: position 2, starts about ${clockTime(new Date(now.getTime() + 600_000))}`);
  });
  it("says so when the estimate is a minimum", () => {
    expect(sttQueueMessage({ ...base, estimate_is_minimum: true }, now)).toMatch(/starts about \d\d:\d\d or later \(live captions running\)$/);
  });
  it("shows only the position without an estimate", () => {
    expect(sttQueueMessage({ ...base, estimated_start_seconds: null, estimated_finish_seconds: null, unknown_ahead: 1 }, now)).toBe("STT: position 2");
  });
  it("is null without a queue block", () => {
    expect(sttQueueMessage(null)).toBeNull();
    expect(sttQueueMessage(undefined)).toBeNull();
  });
  it("starts soon for a short wait", () => {
    expect(sttQueueMessage({ ...base, position: 1, estimated_start_seconds: 5 }, now)).toBe("STT: position 1, starts soon");
  });
});
