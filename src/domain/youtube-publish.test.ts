import { describe, expect, it } from "vitest";
import { buildVideoResource, checkYouTubeOptions, limitTags, youtubePublishOptionsSchema } from "@/domain/youtube-publish";

describe("buildVideoResource", () => {
  it("defaults to the project title and a Finnish description", () => {
    expect(buildVideoResource({ title: "Messu", preacher: "A", gospelRef: "Joh. 1:1-5" }, "PUBLIC")).toEqual({
      snippet: { title: "Messu", description: "Saarnaaja: A\nEvankeliumi: Joh. 1:1-5", categoryId: "29" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true },
    });
  });
  it("fills variables and applies YouTube's limits", () => {
    const r = buildVideoResource({ title: "x", variables: [{ key: "p", value: "Pyhäpäivä" }] }, "PRIVATE", { title: `<b>{{p}}</b> ${"a".repeat(200)}`, description: "ä".repeat(3000), language: "fi", categoryId: "22" });
    expect(r.snippet.title.startsWith("bPyhäpäivä/b")).toBe(true);
    expect(r.snippet.title.length).toBe(100);
    expect(Buffer.byteLength(r.snippet.description)).toBeLessThanOrEqual(5000);
    expect(r.snippet).toMatchObject({ categoryId: "22", defaultLanguage: "fi", defaultAudioLanguage: "fi" });
  });
  it("uploads a scheduled video private with publishAt", () => {
    const r = buildVideoResource({ title: "x" }, "PUBLIC", { publishAt: "2030-01-05T09:00:00+02:00" });
    expect(r.status).toMatchObject({ privacyStatus: "private", publishAt: "2030-01-05T07:00:00.000Z" });
  });
});

describe("options", () => {
  it("limits tags to 500 characters as YouTube counts them", () => {
    const tags = limitTags(Array.from({ length: 60 }, (_, i) => `tag number ${i}`));
    expect(tags.reduce((n, t, i) => n + t.length + 2 + (i ? 1 : 0), 0)).toBeLessThanOrEqual(500);
    expect(limitTags(["a,b", "a b", " "])).toEqual(["a b"]);
  });
  it("checks scheduling", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(checkYouTubeOptions({ publishAt: "2026-11-08T11:00:00Z" }, "PRIVATE", now)).toMatch(/future/);
    expect(checkYouTubeOptions({ publishAt: "2026-11-09T11:00:00Z" }, "PUBLIC", now)).toMatch(/PRIVATE/);
    expect(checkYouTubeOptions({ publishAt: "2026-11-09T11:00:00Z" }, "PRIVATE", now)).toBeNull();
  });
  it("rejects unknown fields and bad playlist ids", () => {
    expect(youtubePublishOptionsSchema.safeParse({ playlistId: "PL abc" }).success).toBe(false);
    expect(youtubePublishOptionsSchema.safeParse({ other: 1 }).success).toBe(false);
  });
});
