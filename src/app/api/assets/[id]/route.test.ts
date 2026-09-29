import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DELETE, PATCH } from "./route";
import { DELETE as UNLINK } from "../../projects/[id]/assets/[assetId]/route";

let dir: string;
let projectId: string;
const assetIds: string[] = [];

async function makeAsset(assetKey: string, file: string) {
  const storagePath = path.join(dir, file);
  await writeFile(storagePath, "x");
  const asset = await prisma.asset.create({ data: { assetKey, type: "OVERLAY", storagePath, mimeType: "image/png", width: 100, height: 100, sizeBytes: BigInt(1), contentHash: file, expiresAt: null } });
  assetIds.push(asset.id);
  return asset;
}
const exists = (p: string) => stat(p).then(() => true, () => false);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) => PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), ctx(id));
const del = (id: string, query = "") => DELETE(new Request(`http://localhost/x${query}`, { method: "DELETE" }), ctx(id));
const unlink = (assetId: string, query = "") => UNLINK(new Request(`http://localhost/x${query}`, { method: "DELETE" }), { params: Promise.resolve({ id: projectId, assetId }) });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "asset-route-"));
  projectId = (await prisma.project.create({ data: { title: "Asset route test", definition: {} } })).id;
});

afterEach(async () => {
  await prisma.asset.deleteMany({ where: { id: { in: assetIds.splice(0) } } });
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe("PATCH /api/assets/:id (rename)", () => {
  it("renames with a valid key and trims whitespace", async () => {
    const a = await makeAsset("logo", "a.png");
    const res = await patch(a.id, { assetKey: "  new-logo " });
    expect(res.status).toBe(200);
    expect((await res.json()).assetKey).toBe("new-logo");
  });

  it("rejects invalid keys with 400 and keeps the old name", async () => {
    const a = await makeAsset("logo", "a.png");
    for (const bad of ["", "   ", "has space", "logo@church", "x".repeat(65)]) expect((await patch(a.id, { assetKey: bad })).status).toBe(400);
    expect((await patch(a.id, { assetKey: 5 })).status).toBe(400);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).assetKey).toBe("logo");
  });

  it("answers 409 when another library asset already has the key, and 404 for unknown assets", async () => {
    const a = await makeAsset("logo", "a.png");
    await makeAsset("banner", "b.png");
    const res = await patch(a.id, { assetKey: "banner" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("banner");
    expect((await patch(a.id, { assetKey: "logo" })).status).toBe(200);
    expect((await patch("nope", { assetKey: "z" })).status).toBe(404);
  });
});

describe("DELETE /api/assets/:id", () => {
  it("refuses with 409 while linked, allows force, and removes the file", async () => {
    const a = await makeAsset("logo", "a.png");
    await prisma.asset.update({ where: { id: a.id }, data: { projects: { connect: { id: projectId } } } });
    const refused = await del(a.id);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.projectCount).toBe(1);
    expect(body.error).toContain("1 project");
    expect(await prisma.asset.count({ where: { id: a.id } })).toBe(1);
    expect((await del(a.id, "?force=1")).status).toBe(204);
    expect(await prisma.asset.count({ where: { id: a.id } })).toBe(0);
    expect(await exists(a.storagePath)).toBe(false);
  });

  it("deletes an unlinked asset and answers 404 afterwards", async () => {
    const a = await makeAsset("logo", "a.png");
    expect((await del(a.id)).status).toBe(204);
    expect(await exists(a.storagePath)).toBe(false);
    expect((await del(a.id)).status).toBe(404);
  });

  it("keeps the file while another row shares the storage path", async () => {
    const a = await makeAsset("logo", "a.png");
    const twin = await prisma.asset.create({ data: { assetKey: "twin", type: "LOGO", storagePath: a.storagePath, mimeType: "image/png", sizeBytes: BigInt(1), expiresAt: null } });
    assetIds.push(twin.id);
    expect((await del(a.id)).status).toBe(204);
    expect(await exists(a.storagePath)).toBe(true);
    expect((await del(twin.id)).status).toBe(204);
    expect(await exists(a.storagePath)).toBe(false);
  });
});

describe("DELETE /api/projects/:id/assets/:assetId (unlink)", () => {
  it("only unlinks: the last project unlinking does not delete the library asset or its file", async () => {
    const a = await makeAsset("logo", "a.png");
    await prisma.asset.update({ where: { id: a.id }, data: { projects: { connect: { id: projectId } } } });
    expect((await unlink(a.id)).status).toBe(204);
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: a.id }, include: { projects: true } });
    expect(row.projects).toHaveLength(0);
    expect(await exists(a.storagePath)).toBe(true);
    expect((await unlink(a.id)).status).toBe(404);
  });

  it("answers 409 with the usages while the definition refers to the asset, unless forced", async () => {
    const a = await makeAsset("logo", "a.png");
    await prisma.asset.update({ where: { id: a.id }, data: { projects: { connect: { id: projectId } } } });
    await prisma.project.update({ where: { id: projectId }, data: { definition: { graphics: [{ id: "g", name: "Title", layers: [{ type: "image", src: `/api/projects/${projectId}/assets/${a.id}` }] }] } } });
    const res = await unlink(a.id);
    expect(res.status).toBe(409);
    expect((await res.json()).usage).toEqual(['graphic "Title"']);
    expect((await unlink(a.id, "?force=1")).status).toBe(204);
    expect(await prisma.asset.count({ where: { id: a.id } })).toBe(1);
  });
});
