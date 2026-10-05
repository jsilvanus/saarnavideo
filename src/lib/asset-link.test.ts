import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetIdFromRef, collectImageRefs } from "@/domain/asset-usage";
import { linkReferencedAssets } from "@/lib/asset-link";
import { prisma } from "@/lib/prisma";

describe("image reference helpers", () => {
  it("collects every image reference once", () => {
    const definition = {
      graphics: [{ id: "g", layers: [{ type: "image", src: "/api/projects/p/assets/a1" }, { type: "text", src: "ignored" }] }],
      composition: { items: [{ type: "overlay", imageAsset: "logo" }, { type: "slate", backgroundImage: "logo" }, { type: "source-clip" }] },
    };
    expect(collectImageRefs(definition).sort()).toEqual(["/api/projects/p/assets/a1", "logo"]);
  });

  it("reads the asset id out of a project asset URL", () => {
    expect(assetIdFromRef("/api/projects/p/assets/abc123")).toBe("abc123");
    expect(assetIdFromRef("logo")).toBeUndefined();
  });
});

describe("linkReferencedAssets", () => {
  let projectId: string;
  const assetIds: string[] = [];
  const makeAsset = async (assetKey: string, type: "OVERLAY" | "AUDIO" = "OVERLAY") => {
    const asset = await prisma.asset.create({ data: { assetKey, type, storagePath: `/tmp/${assetKey}`, mimeType: "image/png", sizeBytes: BigInt(1) } });
    assetIds.push(asset.id);
    return asset;
  };

  beforeEach(async () => { projectId = (await prisma.project.create({ data: { title: "Auto link test", definition: {} } })).id; });
  afterEach(async () => {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await prisma.asset.deleteMany({ where: { id: { in: assetIds.splice(0) } } });
  });

  it("links library assets the definition refers to by key, by project URL and by audio id", async () => {
    const byKey = await makeAsset("autolink-logo");
    const byUrl = await makeAsset("autolink-bg");
    const audio = await makeAsset("autolink-voice", "AUDIO");
    await makeAsset("autolink-unused");
    const definition = { graphics: [{ id: "g", layers: [{ type: "image", src: `/api/projects/${projectId}/assets/${byUrl.id}` }] }], composition: { items: [{ type: "overlay", imageAsset: "autolink-logo" }] } };
    const linked = await linkReferencedAssets(prisma, projectId, definition, [], [audio.id]);
    expect(linked.map(a => a.id).sort()).toEqual([byKey.id, byUrl.id, audio.id].sort());
    const project = await prisma.project.findUnique({ where: { id: projectId }, include: { assets: true } });
    expect(project?.assets.map(a => a.assetKey).sort()).toEqual(["autolink-bg", "autolink-logo", "autolink-voice"]);
  });

  it("does nothing for assets that are already linked or not in the library", async () => {
    const asset = await makeAsset("autolink-linked");
    await prisma.project.update({ where: { id: projectId }, data: { assets: { connect: { id: asset.id } } } });
    const definition = { composition: { items: [{ type: "overlay", imageAsset: "autolink-linked" }, { type: "overlay", imageAsset: "no-such-asset" }] } };
    expect(await linkReferencedAssets(prisma, projectId, definition, [{ id: asset.id, assetKey: asset.assetKey }])).toEqual([]);
  });
});
