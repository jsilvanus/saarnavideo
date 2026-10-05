import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createMediaStore } from "@/lib/media-store";
import { createMemoryObjectClient } from "@/lib/media-store/memory-client";
import { keyForRef, migrateMedia, type MigrationDb } from "./media-migrate";

let root: string;
let projectId: string;
const db = prisma as unknown as MigrationDb;
const exists = (file: string) => stat(file).then(() => true, () => false);
const makeStore = (mode: "s3" | "local") => createMediaStore({ mode, root, s3: { client: memory.client, bucket: "b", prefix: "media" } });
const mine = (ref: string) => ref.startsWith(root) || ref.startsWith("s3://b/media/");
let memory: ReturnType<typeof createMemoryObjectClient>;

async function file(relative: string, content: string) {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "migrate-"));
  memory = createMemoryObjectClient();
  projectId = (await prisma.project.create({ data: { title: "Migrate test", definition: {} } })).id;
});
afterEach(async () => {
  await prisma.asset.deleteMany({ where: { contentHash: { startsWith: "migrate-" } } });
  await prisma.source.deleteMany({ where: { OR: [{ storagePath: { startsWith: root } }, { storagePath: { startsWith: "s3://b/media/" } }] } });
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe("keyForRef", () => {
  it("keeps the sources/, assets/library/ and outputs/ part and files loose outputs under their project", () => {
    expect(keyForRef("/data/media/sources/p1/a.mp4", "/data/media")).toBe("sources/p1/a.mp4");
    expect(keyForRef("s3://b/media/assets/library/h.png", "/x")).toBe("assets/library/h.png");
    expect(keyForRef("/data/media/p1-j1.mp4", "/data/media", "p1")).toBe("outputs/p1/p1-j1.mp4");
    expect(keyForRef("/elsewhere/odd.mp4", "/data/media")).toMatch(/^imported\/[0-9a-f]{12}\/odd\.mp4$/);
  });
});

describe("migrateMedia", () => {
  it("moves local files to s3, repoints every row sharing a file and keeps the old file until asked", async () => {
    const sourcePath = await file("sources/p/a.mp4", "source");
    const libPath = await file("assets/library/migrate-1.png", "png");
    const outPath = await file(`${projectId}-j1.mp4`, "video");
    const source = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: sourcePath, projects: { connect: { id: projectId } } } });
    const a1 = await prisma.asset.create({ data: { assetKey: "migrate-a1", type: "OVERLAY", storagePath: libPath, mimeType: "image/png", sizeBytes: BigInt(3), contentHash: "migrate-1" } });
    const a2 = await prisma.asset.create({ data: { assetKey: "migrate-a2", type: "OVERLAY", storagePath: libPath, mimeType: "image/png", sizeBytes: BigInt(3), contentHash: "migrate-2" } });
    const output = await prisma.output.create({ data: { projectId, type: "VIDEO", storagePath: outPath, mimeType: "video/mp4" } });

    const dry = await migrateMedia({ db, store: makeStore("s3"), mediaRoot: root, include: mine, to: "s3", dryRun: true });
    expect(dry.migrated).toBe(3);
    expect((await prisma.source.findUnique({ where: { id: source.id } }))!.storagePath).toBe(sourcePath);

    const report = await migrateMedia({ db, store: makeStore("s3"), mediaRoot: root, include: mine, to: "s3" });
    expect(report).toMatchObject({ migrated: 3, failed: [], missing: [] });
    expect((await prisma.source.findUnique({ where: { id: source.id } }))!.storagePath).toBe("s3://b/media/sources/p/a.mp4");
    expect((await prisma.asset.findUnique({ where: { id: a1.id } }))!.storagePath).toBe("s3://b/media/assets/library/migrate-1.png");
    expect((await prisma.asset.findUnique({ where: { id: a2.id } }))!.storagePath).toBe("s3://b/media/assets/library/migrate-1.png");
    expect((await prisma.output.findUnique({ where: { id: output.id } }))!.storagePath).toBe(`s3://b/media/outputs/${projectId}/${projectId}-j1.mp4`);
    expect(memory.objects.get("b/media/sources/p/a.mp4")?.toString()).toBe("source");
    expect(await exists(sourcePath)).toBe(true);

    const again = await migrateMedia({ db, store: makeStore("s3"), mediaRoot: root, include: mine, to: "s3" });
    expect(again.migrated).toBe(0);
  });

  it("deletes the old files with deleteOld and reports missing files without failing", async () => {
    const present = await file("sources/p/b.mp4", "bytes");
    await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: present, projects: { connect: { id: projectId } } } });
    await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: path.join(root, "sources/p/gone.mp4"), projects: { connect: { id: projectId } } } });
    const report = await migrateMedia({ db, store: makeStore("s3"), mediaRoot: root, include: mine, to: "s3", deleteOld: true });
    expect(report.migrated).toBe(1);
    expect(report.missing).toEqual([path.join(root, "sources/p/gone.mp4")]);
    expect(await exists(present)).toBe(false);
  });

  it("moves s3 files back to local disk", async () => {
    const s3 = makeStore("s3");
    const ref = await s3.put("sources/p/c.mp4", Buffer.from("remote"));
    const source = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: ref, projects: { connect: { id: projectId } } } });
    const report = await migrateMedia({ db, store: makeStore("local"), mediaRoot: root, include: mine, to: "local" });
    expect(report.migrated).toBe(1);
    expect((await prisma.source.findUnique({ where: { id: source.id } }))!.storagePath).toBe(path.join(root, "sources/p/c.mp4"));
  });

  it("leaves rows untouched when a copy fails", async () => {
    const present = await file("sources/p/d.mp4", "bytes");
    const source = await prisma.source.create({ data: { type: "UPLOAD", status: "AVAILABLE", storagePath: present, projects: { connect: { id: projectId } } } });
    const broken = createMediaStore({ mode: "s3", root, s3: { client: { ...memory.client, put: async () => { throw new Error("bucket unavailable"); } }, bucket: "b" } });
    const report = await migrateMedia({ db, store: broken, mediaRoot: root, include: mine, to: "s3", deleteOld: true });
    expect(report.failed).toHaveLength(1);
    expect((await prisma.source.findUnique({ where: { id: source.id } }))!.storagePath).toBe(present);
    expect(await exists(present)).toBe(true);
  });
});
