import { execFile, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createMediaStore, setMediaStore } from "@/lib/media-store";
import { openJobFiles } from "@/worker/media-io";
import { lcytManifestSchema } from "@/domain/lcyt-manifest";
import { projectDefinitionSchema } from "@/domain/project";
import { startLcytImport, requeue, loadManifest, ImportRequestError, serializeImport } from "@/lib/lcyt-import";
import { reconcileImports, runLcytImport, type ImportDeps } from "@/worker/lcyt-import";
import { buildJoinArgs, gapsBetween, probeVideo } from "@/worker/lcyt-feed";
import { sampleManifest } from "@/domain/lcyt-manifest.fixture";

const run = promisify(execFile);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const rules = { allow: ["127.0.0.1"] };

let dir: string;
let server: Server;
let base: string;
let mediaRoot: string;
const files = new Map<string, Buffer | string>();
const hits: string[] = [];

async function clip(name: string, seconds: number, color: string, audio = true) {
  const out = path.join(dir, name);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=25:d=${seconds}`, ...(audio ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", ...(audio ? ["-c:a", "aac", "-shortest"] : []), out]);
  return readFile(out);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "lcyt-import-"));
  mediaRoot = path.join(dir, "media");
  setMediaStore(createMediaStore({ mode: "local", root: mediaRoot }));
  if (hasFfmpeg) {
    files.set("clean-1.mp4", await clip("c.mp4", 4, "blue"));
    files.set("program-1.mp4", await clip("p.mp4", 4, "red"));
    files.set("dsk-1.mp4", await clip("d1.mp4", 2, "0x00B140", false));
    files.set("dsk-2.mp4", await clip("d2.mp4", 1, "0x00B140", false));
  }
  files.set("captions.fi.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nalku\n\n00:00:02.000 --> 00:00:03.500\nsaarna\n");
  files.set("dsk-events.json", JSON.stringify({ version: 1, events: [{ atMs: 500, kind: "overlay", data: { name: "lower-third" } }, { atMs: 2500, kind: "overlay", data: null }] }));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    hits.push(request.url ?? "");
    const name = url.pathname.split("/").pop() ?? "";
    if (url.searchParams.get("token") !== "t") { response.statusCode = 403; response.end("no"); return; }
    const body = files.get(name);
    if (body === undefined) { response.statusCode = 404; response.end("missing"); return; }
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/files`;
}, 60_000);

afterAll(async () => {
  server?.close();
  // The test database outlives the run: remove what the tests made.
  const imports = await prisma.import.findMany({ where: { externalId: { endsWith: `-${unique}` } } });
  await prisma.project.deleteMany({ where: { id: { in: imports.flatMap((record) => (record.projectId ? [record.projectId] : [])) } } });
  await prisma.source.deleteMany({ where: { feedGroupId: { in: imports.map((record) => record.id) } } });
  await prisma.import.deleteMany({ where: { id: { in: imports.map((record) => record.id) } } });
  setMediaStore(undefined);
  await rm(dir, { recursive: true, force: true });
});

const logs: string[] = [];
async function deps(jobId: string): Promise<ImportDeps> {
  const store = createMediaStore({ mode: "local", root: mediaRoot });
  return { files: await openJobFiles({ store, mediaRoot, jobId }), mediaRoot, maxFileBytes: 50 * 1024 * 1024, fetchOptions: { rules }, log: async (_level, message) => { logs.push(message); }, progress: async () => undefined };
}
const unique = Math.random().toString(36).slice(2, 8);
const manifestFor = (groupId: string, overrides: Record<string, unknown> = {}) => lcytManifestSchema.parse(sampleManifest({ origin: { system: "lcyt", groupId: `${groupId}-${unique}` }, ...overrides }, base));
const feeds = (extra: Record<string, unknown>[] = []) => [
  { role: "clean", parts: [{ ref: `${base}/clean-1.mp4?token=t`, startMs: 0, durationMs: 4000 }] },
  { role: "program", parts: [{ ref: `${base}/program-1.mp4?token=t`, startMs: 1500, durationMs: 4000 }] },
  { role: "dsk", key: { color: "#00B140" }, parts: [{ ref: `${base}/dsk-1.mp4?token=t`, startMs: 1500, durationMs: 2000 }, { ref: `${base}/dsk-2.mp4?token=t`, startMs: 4000, durationMs: 1000 }] },
  ...extra,
];

describe("joining the parts of a feed", () => {
  it("measures the quiet time between parts", () => {
    expect(gapsBetween([{ ref: "a", startMs: 0, durationMs: 1000 }, { ref: "b", startMs: 1000, durationMs: 1000 }, { ref: "c", startMs: 5000, durationMs: 1000 }])).toEqual([0, 3000]);
    expect(gapsBetween([{ ref: "a", startMs: 0, durationMs: 2000 }, { ref: "b", startMs: 1500, durationMs: 1000 }])).toEqual([0]);
  });

  it("fills a gap with the key colour for graphics and black for pictures, and gives a part without audio silence", () => {
    const parts = [{ file: "a.mp4", part: { ref: "a", startMs: 0, durationMs: 1000 }, hasAudio: false }, { file: "b.mp4", part: { ref: "b", startMs: 3000, durationMs: 1000 }, hasAudio: true }];
    const args = buildJoinArgs(parts, { width: 320, height: 180, fps: 25 }, "0x00B140", "out.mp4").join(" ");
    expect(args).toContain("color=c=0x00B140:s=320x180:r=25:d=2");
    expect(args).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=1");
    expect(args).toContain("concat=n=3:v=1:a=1");
  });
});

describe.skipIf(!hasFfmpeg)("LCYT import", () => {
  it("fetches the feeds, joins parts with the gap, moves captions and keeps the events", async () => {
    const manifest = manifestFor("g-full", { feeds: feeds(), markers: [{ atMs: 3000, kind: "cue", label: "Saarna" }], variables: { otsikko: "Pyhäpäivä", "bad key": "x" } });
    const started = await startLcytImport(manifest);
    expect(started).toMatchObject({ created: true, status: "PENDING" });
    const job = await prisma.mediaJob.findFirstOrThrow({ where: { projectId: started.projectId!, type: "IMPORT" } });
    expect(job.parameters).toMatchObject({ importId: started.importId });

    await runLcytImport(started.importId, await deps(job.id));

    const record = await prisma.import.findUniqueOrThrow({ where: { id: started.importId } });
    expect(record.status).toBe("READY");
    expect(record.manifest).toBeNull(); // the signed links are gone
    const sources = await prisma.source.findMany({ where: { feedGroupId: started.importId }, });
    expect(sources.map((s) => [s.feedRole, s.syncOffsetMs, s.status]).sort()).toEqual([["CLEAN", 0, "AVAILABLE"], ["DSK", 1500, "AVAILABLE"], ["PROGRAM", 1500, "AVAILABLE"]]);
    const dsk = sources.find((s) => s.feedRole === "DSK")!;
    expect(dsk.keyParams).toMatchObject({ hasAlpha: false, color: "#00B140" });
    // 2 s, a 0.5 s gap (parts at 1.5 s and 4.0 s), then 1 s: one file from the first part's start to the last part's end.
    expect((await probeVideo(dsk.storagePath!)).durationMs).toBeGreaterThan(3300);
    expect((await probeVideo(dsk.storagePath!)).durationMs).toBeLessThan(3800);
    expect(dsk.durationMs).toBe((await probeVideo(dsk.storagePath!)).durationMs);
    expect(await stat(sources.find((s) => s.feedRole === "CLEAN")!.storagePath!)).toBeTruthy();

    // The working source is the program feed; the marker (3.0 s on the clean clock) is 1.5 s into it.
    const project = await prisma.project.findUniqueOrThrow({ where: { id: started.projectId! }, include: { sources: true } });
    expect(project.sources).toHaveLength(3);
    const definition = projectDefinitionSchema.parse(project.definition);
    const program = sources.find((s) => s.feedRole === "PROGRAM")!;
    const clips = definition.composition.items.filter((i) => i.type === "source-clip");
    expect(clips.map((c) => c.type === "source-clip" && [c.sourceId, c.startSeconds, c.endSeconds])).toEqual([[program.id, 0, 1.5], [program.id, 1.5, program.durationMs! / 1000]]);
    expect(definition.sections?.map((s) => s.label)).toEqual(["Test broadcast", "Saarna"]);
    expect(definition.variables).toEqual([{ key: "otsikko", value: "Pyhäpäivä" }]);

    // Captions: on the clean clock for the clean file, moved 1.5 s earlier for the program file, none for the graphics.
    const segmentsOf = async (sourceId: string) => (await prisma.transcriptSegment.findMany({ where: { sourceId, isActive: true }, orderBy: { startSeconds: "asc" } })).map((s) => [s.startSeconds, s.endSeconds, s.text]);
    expect(await segmentsOf(sources.find((s) => s.feedRole === "CLEAN")!.id)).toEqual([[0, 1, "alku"], [2, 3.5, "saarna"]]);
    expect(await segmentsOf(program.id)).toEqual([[0.5, 2, "saarna"]]);
    expect(await segmentsOf(dsk.id)).toEqual([]);

    const summary = serializeImport(record, { events: true }).summary as { dskEvents: unknown[]; captionLanguages: string[]; notices: string[]; skippedVariables: string[] };
    expect(summary.dskEvents).toHaveLength(2);
    expect(summary.captionLanguages).toEqual(["fi"]);
    expect(summary.skippedVariables).toEqual(["bad key"]);
    expect(serializeImport(record).summary).not.toHaveProperty("dskEvents");
    expect(JSON.stringify(serializeImport(record))).not.toContain("token=t");
    expect(logs.join("\n")).not.toContain("token=t");
  }, 120_000);

  it("answers the same broadcast with the existing import, and a failed one resumes without fetching again", async () => {
    const manifest = manifestFor("g-resume", { feeds: [feeds()[0], { role: "program", parts: [{ ref: `${base}/missing.mp4?token=t`, startMs: 0, durationMs: 1000 }] }], captions: [], dskEvents: null });
    const first = await startLcytImport(manifest);
    expect(await startLcytImport(manifest)).toMatchObject({ importId: first.importId, created: false });
    const job = await prisma.mediaJob.findFirstOrThrow({ where: { projectId: first.projectId! } });
    await expect(runLcytImport(first.importId, await deps(job.id))).rejects.toThrow(/answered 404/);
    // The clean recording had arrived before the program one failed.
    expect(await prisma.source.count({ where: { feedGroupId: first.importId } })).toBe(1);
    await prisma.import.update({ where: { id: first.importId }, data: { status: "FAILED", error: "x" } });

    // LCYT delivers again with working links: the clean source is kept, only the program feed is fetched.
    hits.length = 0;
    const fixed = manifestFor("g-resume", { feeds: [feeds()[0], feeds()[1]], captions: [], dskEvents: null });
    expect(await startLcytImport(fixed)).toMatchObject({ importId: first.importId, created: false, status: "PENDING" });
    const jobs = await prisma.mediaJob.findMany({ where: { projectId: first.projectId!, type: "IMPORT" } });
    expect(jobs).toHaveLength(2);
    await runLcytImport(first.importId, await deps(jobs[1].id));
    expect(hits.some((h) => h.includes("clean-1.mp4"))).toBe(false);
    expect(hits.some((h) => h.includes("program-1.mp4"))).toBe(true);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: first.importId } })).status).toBe("READY");
    expect(await prisma.source.count({ where: { feedGroupId: first.importId } })).toBe(2);
  }, 120_000);

  it("treats program as the clean feed when it is an alias, and notes that no graphics were delivered", async () => {
    const manifest = manifestFor("g-alias", { feeds: [feeds()[0], { role: "program", aliasOf: "clean" }], captions: [], dskEvents: null });
    const started = await startLcytImport(manifest);
    const job = await prisma.mediaJob.findFirstOrThrow({ where: { projectId: started.projectId! } });
    await runLcytImport(started.importId, await deps(job.id));
    const record = await prisma.import.findUniqueOrThrow({ where: { id: started.importId } });
    expect((record.summary as { mainRole: string; notices: string[] }).mainRole).toBe("clean");
    expect((record.summary as { notices: string[] }).notices.join(" ")).toMatch(/program is the same picture as clean/);
    expect(await prisma.source.count({ where: { feedGroupId: started.importId } })).toBe(1);
  }, 60_000);

  it("keeps a wrong caption file from failing the import", async () => {
    files.set("bad.vtt", "not a caption file");
    const manifest = manifestFor("g-badcaps", { feeds: [feeds()[0]], captions: [{ language: "fi", ref: `${base}/bad.vtt?token=t` }], dskEvents: null });
    const started = await startLcytImport(manifest);
    const job = await prisma.mediaJob.findFirstOrThrow({ where: { projectId: started.projectId! } });
    await runLcytImport(started.importId, await deps(job.id));
    const record = await prisma.import.findUniqueOrThrow({ where: { id: started.importId } });
    expect(record.status).toBe("READY");
    expect((record.summary as { notices: string[] }).notices.join(" ")).toMatch(/fi captions/);
  }, 60_000);

  it("marks imports whose job is gone as failed, so they can be retried", async () => {
    const started = await startLcytImport(manifestFor("g-orphan", { feeds: [feeds()[0]] }));
    await prisma.mediaJob.updateMany({ where: { projectId: started.projectId! }, data: { status: "FAILED" } });
    expect(await reconcileImports()).toBeGreaterThanOrEqual(1);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: started.importId } })).status).toBe("FAILED");
    expect(await requeue(started.importId, started.projectId!, null)).toMatchObject({ status: "PENDING" });
    expect(await reconcileImports()).toBe(0);
  });

  it("reports a bad manifest as a request error", async () => {
    await expect(loadManifest({ manifest: { version: 1 } })).rejects.toBeInstanceOf(ImportRequestError);
    await expect(loadManifest({})).rejects.toMatchObject({ status: 400 });
    await expect(loadManifest({ manifestUrl: `${base}/missing.json?token=t` }, { rules })).rejects.toMatchObject({ status: 502 });
    const manifestFile = JSON.stringify(sampleManifest({ origin: { system: "lcyt", groupId: "g-url" } }, base));
    files.set("manifest.json", manifestFile);
    expect((await loadManifest({ manifestUrl: `${base}/manifest.json?token=t` }, { rules })).title).toBe("Test broadcast");
  });
});
