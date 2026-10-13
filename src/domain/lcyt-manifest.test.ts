import { describe, expect, it } from "vitest";
import { feedOffsetMs, feedSpanMs, fileFeeds, lcytManifestSchema, manifestExternalId, manifestVariables } from "@/domain/lcyt-manifest";
import { VARIABLE_KEY_PATTERN } from "@/domain/variables";
import { sampleManifest } from "@/domain/lcyt-manifest.fixture";

const parse = (value: unknown) => lcytManifestSchema.parse(value);

describe("LCYT manifest v1", () => {
  it("accepts a manifest as LCYT serves it", () => {
    const manifest = parse(sampleManifest());
    expect(manifest.feeds.map((feed) => feed.role)).toEqual(["clean", "program", "dsk"]);
    expect(manifestExternalId(manifest)).toBe("g1");
    expect(fileFeeds(manifest)).toHaveLength(3);
  });

  it("treats program as an alias of clean when LCYT sends no second file", () => {
    const manifest = parse(sampleManifest({ feeds: [(sampleManifest().feeds as unknown[])[0], { role: "program", aliasOf: "clean" }] }));
    expect(fileFeeds(manifest).map((feed) => feed.role)).toEqual(["clean"]);
  });

  it("drops fields it does not know, so LCYT can add some", () => {
    const manifest = parse(sampleManifest({ somethingNew: { a: 1 } }));
    expect("somethingNew" in manifest).toBe(false);
  });

  it("rejects a manifest without a clean feed, with duplicate roles, a wrong version or relative refs", () => {
    const feeds = sampleManifest().feeds as Array<Record<string, unknown>>;
    expect(() => parse(sampleManifest({ feeds: feeds.slice(1) }))).toThrow(/clean feed/);
    expect(() => parse(sampleManifest({ feeds: [feeds[0], feeds[0]] }))).toThrow(/Duplicate/);
    expect(() => parse(sampleManifest({ version: 2 }))).toThrow();
    expect(() => parse(sampleManifest({ feeds: [{ role: "clean", parts: [{ ref: "clean-1.mp4", startMs: 0, durationMs: 1 }] }] }))).toThrow();
    expect(() => parse(sampleManifest({ feeds: [{ role: "clean", parts: [{ ref: "file:///etc/passwd", startMs: 0, durationMs: 1 }] }] }))).toThrow();
    expect(() => parse(sampleManifest({ feeds: [{ role: "clean" }] }))).toThrow(/parts or aliasOf/);
  });

  it("identifies the broadcast by group, then video", () => {
    expect(manifestExternalId(parse(sampleManifest({ origin: { system: "lcyt", videoId: 11 } })))).toBe("11");
    expect(() => manifestExternalId(parse(sampleManifest({ origin: { system: "lcyt" } })))).toThrow(/identify/);
  });

  it("computes where a feed starts on the clean timeline and how long its joined file is", () => {
    const feed = parse(sampleManifest({ feeds: [{ role: "clean", parts: [{ ref: "https://x/a.mp4", startMs: 2000, durationMs: 3000 }, { ref: "https://x/b.mp4", startMs: 9000, durationMs: 1000 }] }] })).feeds[0];
    expect(feedOffsetMs(feed)).toBe(2000);
    expect(feedSpanMs(feed)).toBe(8000);
  });

  it("keeps only variable names the project allows", () => {
    const manifest = parse(sampleManifest({ variables: { title: "A", "bad name": "B", date: 5 } }));
    const { variables, skipped } = manifestVariables(manifest, (key) => VARIABLE_KEY_PATTERN.test(key));
    expect(variables).toEqual([{ key: "title", value: "A" }, { key: "date", value: "5" }]);
    expect(skipped).toEqual(["bad name"]);
  });
});
