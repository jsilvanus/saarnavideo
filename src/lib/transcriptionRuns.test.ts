import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyRunWithStrategy, createTranscriptionRun } from "@/lib/transcriptionRuns";

// Integration tests against the local sqlite dev database (DATABASE_URL=file:./dev.db) -
// there is no existing mocking convention for Prisma-backed code in this codebase (every
// route imports the singleton directly), so this exercises the real schema. Each test
// creates its own Source and relies on the schema's onDelete: Cascade to clean up its
// TranscriptionRun/TranscriptSegment rows when that Source is deleted in afterEach.
describe("transcriptionRuns", () => {
  let sourceId: string;

  beforeEach(async () => {
    const source = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE" } });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => undefined);
  });

  describe("createTranscriptionRun", () => {
    it("auto-applies the first run for a source with no active segments", async () => {
      const run = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 0,
        rangeEndSeconds: 10,
        segments: [{ startSeconds: 1, endSeconds: 4, text: "hello" }],
      });

      expect(run.status).toBe("APPLIED");
      expect(run.appliedStrategy).toBe("replace_overlap");
      expect(run.appliedAt).not.toBeNull();
      expect(run.segments).toHaveLength(1);
      expect(run.segments[0].isActive).toBe(true);

      const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true } });
      expect(active).toHaveLength(1);
    });

    it("leaves a second run PENDING even when its range does not overlap anything active", async () => {
      await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 0,
        rangeEndSeconds: 10,
        segments: [{ startSeconds: 1, endSeconds: 4, text: "first" }],
      });

      const second = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 100,
        rangeEndSeconds: 110,
        segments: [{ startSeconds: 101, endSeconds: 104, text: "second, non-overlapping" }],
      });

      expect(second.status).toBe("PENDING");
      expect(second.segments[0].isActive).toBe(false);

      const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true } });
      expect(active).toHaveLength(1);
      expect(active[0].text).toBe("first");
    });
  });

  describe("applyRunWithStrategy", () => {
    it("replace_overlap deactivates only overlapping active segments and activates the run's own", async () => {
      await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 0,
        rangeEndSeconds: 20,
        segments: [
          { startSeconds: 0, endSeconds: 5, text: "keep-me (outside new range)" },
          { startSeconds: 10, endSeconds: 15, text: "replace-me (inside new range)" },
        ],
      });

      const secondRun = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 8,
        rangeEndSeconds: 20,
        segments: [{ startSeconds: 10, endSeconds: 16, text: "new version" }],
      });
      expect(secondRun.status).toBe("PENDING");

      const outcome = await prisma.$transaction((tx) => applyRunWithStrategy(tx, secondRun, "replace_overlap"));
      expect(outcome.ok).toBe(true);

      const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
      expect(active.map((s) => s.text)).toEqual(["keep-me (outside new range)", "new version"]);
    });

    it("append activates the run's segments when there is no overlap", async () => {
      await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 0,
        rangeEndSeconds: 10,
        segments: [{ startSeconds: 0, endSeconds: 5, text: "first" }],
      });

      const secondRun = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 20,
        rangeEndSeconds: 30,
        segments: [{ startSeconds: 21, endSeconds: 25, text: "second" }],
      });

      const outcome = await prisma.$transaction((tx) => applyRunWithStrategy(tx, secondRun, "append"));
      expect(outcome.ok).toBe(true);

      const active = await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } });
      expect(active.map((s) => s.text)).toEqual(["first", "second"]);
    });

    it("append refuses with the conflicting active segment ids and changes nothing", async () => {
      const firstRun = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 0,
        rangeEndSeconds: 10,
        segments: [{ startSeconds: 0, endSeconds: 5, text: "first" }],
      });
      const activeConflict = await prisma.transcriptSegment.findFirstOrThrow({ where: { runId: firstRun.id } });

      const secondRun = await createTranscriptionRun({
        sourceId,
        origin: "SERVICE",
        language: "fi",
        rangeStartSeconds: 3,
        rangeEndSeconds: 10,
        segments: [{ startSeconds: 3, endSeconds: 6, text: "overlaps first" }],
      });

      const outcome = await prisma.$transaction((tx) => applyRunWithStrategy(tx, secondRun, "append"));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.conflicts).toEqual([activeConflict.id]);

      // Nothing should have changed: the second run's segment stays inactive and the run stays PENDING.
      const secondRunSegment = await prisma.transcriptSegment.findFirstOrThrow({ where: { runId: secondRun.id } });
      expect(secondRunSegment.isActive).toBe(false);
      const runAfter = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: secondRun.id } });
      expect(runAfter.status).toBe("PENDING");
    });
  });
});
