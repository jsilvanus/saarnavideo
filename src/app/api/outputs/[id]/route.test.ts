import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, PATCH } from "./route";

describe("/api/outputs/[id] label and download name", () => {
  let dir: string;
  let projectId: string;
  let outputId: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "output-route-"));
    const file = path.join(dir, "video.mp4");
    await writeFile(file, "fake mp4 bytes");
    const project = await prisma.project.create({ data: { title: "Output label test", definition: {} } });
    projectId = project.id;
    const output = await prisma.output.create({ data: { projectId, type: "VIDEO", storagePath: file, mimeType: "video/mp4", sizeBytes: BigInt(14) } });
    outputId = output.id;
  });

  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const patch = (id: string, body: unknown) => PATCH(new Request(`http://localhost/api/outputs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const download = (id: string) => GET(new Request(`http://localhost/api/outputs/${id}`), { params: Promise.resolve({ id }) });

  it("uses the default download name until a label is set", async () => {
    const response = await download(outputId);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="saarnavideo-video.mp4"`);
  });

  it("renames the output (trimmed) and the download uses the label with the video extension", async () => {
    const response = await patch(outputId, { label: "  Sunnuntai 14.6. klo 10  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: outputId, label: "Sunnuntai 14.6. klo 10", type: "VIDEO" });
    const stored = await prisma.output.findUniqueOrThrow({ where: { id: outputId } });
    expect(stored.label).toBe("Sunnuntai 14.6. klo 10");
    const download_ = await download(outputId);
    expect(download_.headers.get("Content-Disposition")).toContain(`filename="Sunnuntai 14.6. klo 10.mp4"`);
    expect(download_.headers.get("Content-Disposition")).not.toContain("filename*");
  });

  it("keeps Finnish letters in the UTF-8 download name", async () => {
    await patch(outputId, { label: "Pääsiäisen jumalanpalvelus" });
    const response = await download(outputId);
    expect(response.headers.get("Content-Disposition")).toContain("filename*=UTF-8''P%C3%A4%C3%A4si%C3%A4isen%20jumalanpalvelus.mp4");
  });

  it("clears the label with an empty string", async () => {
    await patch(outputId, { label: "Joku nimi" });
    const response = await patch(outputId, { label: "   " });
    expect(response.status).toBe(200);
    expect((await response.json()).label).toBeNull();
    expect((await prisma.output.findUniqueOrThrow({ where: { id: outputId } })).label).toBeNull();
  });

  it("refuses a label longer than 120 characters", async () => {
    const response = await patch(outputId, { label: "x".repeat(121) });
    expect(response.status).toBe(400);
    expect((await prisma.output.findUniqueOrThrow({ where: { id: outputId } })).label).toBeNull();
    expect((await patch(outputId, { label: "x".repeat(120) })).status).toBe(200);
  });

  it("answers 404 for an unknown output and 400 for a body without a label", async () => {
    expect((await patch("does-not-exist", { label: "x" })).status).toBe(404);
    expect((await patch(outputId, { name: "x" })).status).toBe(400);
    expect((await patch(outputId, "not json")).status).toBe(400);
  });
});
