import { describe, expect, it } from "vitest";
import { recoverStalePublications, STOPPED_ERROR, type PublicationRecoveryDb } from "@/worker/publication-recovery";

function db(rows: Array<{ id: string; provider: string; uploadUrl: string | null }>) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const fake: PublicationRecoveryDb = {
    publication: {
      findMany: async () => rows,
      updateMany: async (args) => { updates.push(args); return { count: 1 }; },
    },
  };
  return { fake, updates };
}

describe("recoverStalePublications", () => {
  it("requeues a YouTube upload with a session and fails the rest", async () => {
    const { fake, updates } = db([{ id: "a", provider: "YOUTUBE", uploadUrl: "https://up/s" }, { id: "b", provider: "YOUTUBE", uploadUrl: null }, { id: "c", provider: "FACEBOOK", uploadUrl: null }]);
    const now = new Date("2026-11-08T12:00:00Z");
    expect(await recoverStalePublications(fake, now)).toEqual({ requeued: 1, failed: 2 });
    expect(updates[0].data).toMatchObject({ status: "QUEUED" });
    expect(updates[1].data).toMatchObject({ status: "FAILED", error: STOPPED_ERROR });
    // Each update repeats the staleness condition, so a worker that just beat its heartbeat keeps the row.
    expect(updates[0].where).toMatchObject({ id: "a", status: "UPLOADING" });
  });
});
