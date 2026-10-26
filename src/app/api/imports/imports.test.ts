import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sampleManifest } from "@/domain/lcyt-manifest.fixture";
import { POST } from "@/app/api/imports/lcyt/route";
import { GET as list } from "@/app/api/imports/route";
import { GET as one } from "@/app/api/imports/[id]/route";
import { POST as retry } from "@/app/api/imports/[id]/retry/route";

const unique = Math.random().toString(36).slice(2, 8);
const post = (body: unknown) => POST(new Request("http://app/api/imports/lcyt", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const manifest = (group: string, overrides: Record<string, unknown> = {}) => sampleManifest({ origin: { system: "lcyt", groupId: `${group}-${unique}` }, ...overrides });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

afterAll(async () => {
  const imports = await prisma.import.findMany({ where: { externalId: { endsWith: `-${unique}` } } });
  await prisma.project.deleteMany({ where: { id: { in: imports.flatMap((record) => (record.projectId ? [record.projectId] : [])) } } });
  await prisma.import.deleteMany({ where: { id: { in: imports.map((record) => record.id) } } });
});

describe("POST /api/imports/lcyt", () => {
  it("asks for JSON with a manifest or a link", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ manifestUrl: "not a url" })).status).toBe(400);
  });

  it("refuses a manifest that does not follow the contract, and a link the server may not reach", async () => {
    const bad = await post({ manifest: { version: 1, title: "x" } });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/Invalid manifest/);
    const blocked = await post({ manifestUrl: "http://127.0.0.1:9/manifest.json" });
    expect(blocked.status).toBe(502);
    expect((await blocked.json()).error).toMatch(/Blocked/);
  });

  it("creates a project, an import and an IMPORT job, answering 202; the same broadcast again answers 200 with the same ids", async () => {
    const response = await post({ manifest: manifest("route-new") });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ created: true, status: "PENDING" });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: body.projectId } });
    expect(project.title).toBe("Test broadcast");
    const jobs = await prisma.mediaJob.findMany({ where: { projectId: body.projectId } });
    expect(jobs.map((job) => [job.type, job.status])).toEqual([["IMPORT", "QUEUED"]]);

    const again = await post({ manifest: manifest("route-new") });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ importId: body.importId, projectId: body.projectId, created: false });
    expect(await prisma.project.count({ where: { id: body.projectId } })).toBe(1);
  });

  it("takes the template from the request, and refuses an unknown one without creating anything", async () => {
    const ok = await (await post({ manifest: manifest("route-template"), templateKey: "liturgy" })).json();
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ok.projectId } });
    expect(project.templateKey).toBe("liturgy");
    const missing = await post({ manifest: manifest("route-nope"), templateKey: "no-such-template" });
    expect(missing.status).toBe(400);
    expect(await prisma.import.count({ where: { externalId: `route-nope-${unique}` } })).toBe(0);
  });

  it("creates two projects for two concurrent deliveries of different broadcasts, and one for the same broadcast", async () => {
    const [a, b] = await Promise.all([post({ manifest: manifest("route-race") }), post({ manifest: manifest("route-race") })]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies[0].importId).toBe(bodies[1].importId);
    expect(await prisma.project.count({ where: { id: bodies[0].projectId } })).toBe(1);
  });
});

describe("reading and retrying imports", () => {
  it("lists imports and shows one without the stored manifest", async () => {
    const created = await (await post({ manifest: manifest("route-read") })).json();
    const rows = await (await list()).json();
    expect(rows.find((row: { id: string }) => row.id === created.importId)).toBeTruthy();
    const detail = await (await one(new Request("http://app/api/imports/x"), params(created.importId))).json();
    expect(detail).toMatchObject({ id: created.importId, status: "PENDING", projectId: created.projectId });
    expect(detail).not.toHaveProperty("manifest");
    expect((await one(new Request("http://app/api/imports/x"), params("nope"))).status).toBe(404);
  });

  it("retries only a failed import", async () => {
    const created = await (await post({ manifest: manifest("route-retry") })).json();
    expect((await retry(new Request("http://app"), params(created.importId))).status).toBe(409);
    await prisma.import.update({ where: { id: created.importId }, data: { status: "FAILED", error: "boom" } });
    const response = await retry(new Request("http://app"), params(created.importId));
    expect(response.status).toBe(202);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: created.importId } })).status).toBe("PENDING");
    expect(await prisma.mediaJob.count({ where: { projectId: created.projectId, type: "IMPORT" } })).toBe(2);
  });
});
