import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { libraryRef, storedFileExists, api, averageColor, baseUrl, createProject, frameRgb, isBlue, isGreen, mediaRoot, render, setComposition, uploadSource } from "./helpers";

const execFileAsync = promisify(execFile);
const exists = storedFileExists;

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
    const filePath = libraryRef(`${createHash("sha256").update(bytes).digest("hex")}.png`);

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

    // A render of a definition that still refers to the asset links it again: one policy, referenced library assets are auto-linked.
    const relinked = await render(project.id);
    expect(isBlue(averageColor(await frameRgb(relinked.filePath, 2, { x: 150, y: 150, w: 100, h: 100 })))).toBe(true);
    expect((await api<{ assets: Array<{ id: string; projectCount: number }> }>("/api/assets")).assets.find(a => a.id === asset.id)?.projectCount).toBe(1);

    // Once the reference is gone the project can unlink it for good, and the render no longer needs it.
    await setComposition(project.id, [{ type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 }], 5);
    expect((await rawStatus(`/api/projects/${project.id}/assets/${asset.id}`, "DELETE")).status).toBe(204);
    const without = await render(project.id);
    expect(isGreen(averageColor(await frameRgb(without.filePath, 2, { x: 150, y: 150, w: 100, h: 100 })))).toBe(true);
    expect((await api<{ assets: Array<{ id: string; projectCount: number }> }>("/api/assets")).assets.find(a => a.id === asset.id)?.projectCount).toBe(0);

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

describe("asset keys shared between projects", () => {
  it("tells the uploader that the existing key stays, and warns when a project refers to a key it does not have", async () => {
    const bytes = await bluePng("asset-key-collision.png");
    const upload = (projectId: string, key: string) => {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${key}.png`);
      form.set("assetKey", key);
      form.set("type", "OVERLAY");
      return api<{ id: string; assetKey: string; reused?: boolean; requestedKey?: string }>(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
    };
    const a = await createProject("Key owner");
    const first = await upload(a.id, "kcblue");
    expect(first).toMatchObject({ assetKey: "kcblue" });
    expect(first.reused).toBeUndefined();

    const b = await createProject("Key collision");
    const second = await upload(b.id, "kclogo");
    expect(second).toMatchObject({ id: first.id, assetKey: "kcblue", reused: true, requestedKey: "kclogo" });

    const green = await uploadSource(b.id, "green.mp4");
    await setComposition(b.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "image", imageAsset: "kclogo", startSeconds: 0, endSeconds: 3 },
      { type: "overlay", kind: "image", imageAsset: "kcblue", startSeconds: 0, endSeconds: 3 },
    ], 5);
    const job = await api<{ id: string; assetWarnings: string[] }>(`/api/projects/${b.id}/generate`, { method: "POST", json: { preview: true } });
    expect(job.assetWarnings).toHaveLength(1);
    expect(job.assetWarnings[0]).toContain('"kclogo"');

    // Using the key that exists leaves nothing to warn about.
    await setComposition(b.id, [
      { type: "source-clip", sourceId: green.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "image", imageAsset: "kcblue", startSeconds: 0, endSeconds: 3 },
    ], 5);
    const clean = await api<{ assetWarnings: string[] }>(`/api/projects/${b.id}/generate`, { method: "POST", json: { preview: true } });
    expect(clean.assetWarnings).toEqual([]);

    // A library asset that a project refers to but never linked is linked automatically when it renders.
    const c = await createProject("Auto link");
    const greenC = await uploadSource(c.id, "green.mp4");
    await setComposition(c.id, [
      { type: "source-clip", sourceId: greenC.id, startSeconds: 0, endSeconds: 5 },
      { type: "overlay", kind: "image", imageAsset: "kcblue", startSeconds: 0, endSeconds: 3 },
    ], 5);
    expect((await api<{ assets: Array<{ id: string }> }>(`/api/projects/${c.id}/assets`)).assets).toHaveLength(0);
    const linked = await api<{ assetWarnings: string[]; autoLinkedAssets: string[] }>(`/api/projects/${c.id}/generate`, { method: "POST", json: { preview: true } });
    expect(linked.assetWarnings).toEqual([]);
    expect(linked.autoLinkedAssets).toEqual(["kcblue"]);
    expect((await api<{ assets: Array<{ id: string }> }>(`/api/projects/${c.id}/assets`)).assets.map(x => x.id)).toEqual([first.id]);
  });
});
