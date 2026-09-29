import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { api, averageColor, baseUrl, createProject, frameRgb, isBlue, isGreen, mediaRoot, render, setComposition, uploadSource } from "./helpers";

const execFileAsync = promisify(execFile);
const exists = (filePath: string) => access(filePath).then(() => true, () => false);

/** A solid blue PNG whose size makes its bytes (and content hash) unique to this test file. */
async function bluePng(name: string) {
  const file = path.join(mediaRoot, name);
  await execFileAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=213x217", "-frames:v", "1", file]);
  return readFile(file);
}

async function libraryUpload(bytes: Buffer, assetKey: string, expectedStatus?: number) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${assetKey}.png`);
  form.set("assetKey", assetKey);
  form.set("type", "OVERLAY");
  return api<{ id: string; assetKey: string; projectCount: number }>("/api/assets", { method: "POST", body: form }, expectedStatus);
}

const rawStatus = async (route: string, method: string, json?: unknown) => {
  const response = await fetch(`${baseUrl}${route}`, { method, ...(json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};

describe("asset library: link, render, unlink, rename, delete", () => {
  it("keeps library assets when a project unlinks them and only deletes them explicitly", async () => {
    const bytes = await bluePng("asset-library-blue.png");
    const filePath = path.join(mediaRoot, "assets", "library", `${createHash("sha256").update(bytes).digest("hex")}.png`);

    // Upload straight into the library; uploading identical bytes again reuses the row.
    const asset = await libraryUpload(bytes, "libblue", 201);
    expect(asset.assetKey).toBe("libblue");
    expect(await exists(filePath)).toBe(true);
    const again = await libraryUpload(bytes, "otherkey");
    expect(again.id).toBe(asset.id);

    // Link it to a project and render an image overlay with it.
    const project = await createProject("Library link");
    const green = await uploadSource(project.id, "green.mp4");
    await api(`/api/projects/${project.id}/assets/${asset.id}`, { method: "POST" });
    const linked = await api<{ assets: Array<{ id: string }> }>(`/api/projects/${project.id}`);
    expect(linked.assets.map(a => a.id)).toContain(asset.id);
    const listed = await api<{ assets: Array<{ id: string; projectCount: number }> }>("/api/assets");
    expect(listed.assets.find(a => a.id === asset.id)?.projectCount).toBe(1);

    await setComposition(project.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "image", imageAsset: "libblue", x: 100, y: 100, startSeconds: 0, endSeconds: 5 },
    ], 5);
    const withAsset = await render(project.id);
    expect(isBlue(averageColor(await frameRgb(withAsset.filePath, 2, { x: 150, y: 150, w: 100, h: 100 })))).toBe(true);

    // Delete is refused while linked.
    const refused = await rawStatus(`/api/assets/${asset.id}`, "DELETE");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("1 project");
    expect(await exists(filePath)).toBe(true);

    // Unlinking the only project keeps the asset (and its file) in the library, but the definition still uses it.
    const blocked = await rawStatus(`/api/projects/${project.id}/assets/${asset.id}`, "DELETE");
    expect(blocked.status).toBe(409);
    expect(blocked.body.usage).toEqual(["composition item 2 (overlay)"]);
    const unlinked = await rawStatus(`/api/projects/${project.id}/assets/${asset.id}?force=1`, "DELETE");
    expect(unlinked.status).toBe(204);
    const after = await api<{ assets: Array<{ id: string; projectCount: number }> }>("/api/assets");
    expect(after.assets.find(a => a.id === asset.id)?.projectCount).toBe(0);
    expect(await exists(filePath)).toBe(true);
    expect((await fetch(`${baseUrl}/api/assets/${asset.id}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/projects/${project.id}/assets/${asset.id}`)).status).toBe(404);

    // The render now skips the unlinked overlay image gracefully: the source stays visible.
    const without = await render(project.id);
    expect(isGreen(averageColor(await frameRgb(without.filePath, 2, { x: 150, y: 150, w: 100, h: 100 })))).toBe(true);

    // Rename validation.
    expect((await rawStatus(`/api/assets/${asset.id}`, "PATCH", { assetKey: "bad key!" })).status).toBe(400);
    expect((await rawStatus(`/api/assets/${asset.id}`, "PATCH", { assetKey: "" })).status).toBe(400);
    const redFile = path.join(mediaRoot, "asset-library-red.png");
    await execFileAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=219x211", "-frames:v", "1", redFile]);
    const other = await libraryUpload(await readFile(redFile), "libred", 201);
    const dup = await rawStatus(`/api/assets/${other.id}`, "PATCH", { assetKey: "libblue" });
    expect(dup.status).toBe(409);
    const renamed = await rawStatus(`/api/assets/${asset.id}`, "PATCH", { assetKey: "libblue-renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.assetKey).toBe("libblue-renamed");

    // Deleting an unreferenced asset removes the row and the file.
    expect((await rawStatus(`/api/assets/${asset.id}`, "DELETE")).status).toBe(204);
    expect(await exists(filePath)).toBe(false);
    expect((await fetch(`${baseUrl}/api/assets/${asset.id}`)).status).toBe(404);
    expect((await rawStatus(`/api/assets/${other.id}`, "DELETE")).status).toBe(204);
  });
});
