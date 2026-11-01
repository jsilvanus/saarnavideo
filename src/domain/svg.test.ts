import { describe, expect, it } from "vitest";
import { checkSvg, layerRecolor, recolorSvg, svgColors } from "./svg";

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#00A94F"/><path d="M0 0h10" style="stroke:#fff;fill:none"/><circle r="5" fill='#ef453d'/></svg>`;

describe("checkSvg", () => {
  it("takes the size from the viewBox or from width and height", () => {
    expect(checkSvg(logo)).toMatchObject({ ok: true, width: 200, height: 100 });
    expect(checkSvg('<svg width="64px" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toMatchObject({ ok: true, width: 64, height: 32 });
    expect(checkSvg('<svg width="100" viewBox="0 0 50 25"><rect/></svg>')).toMatchObject({ ok: true, width: 100, height: 50 });
  });
  it("refuses what runs or fetches", () => {
    for (const bad of [
      '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 1 1"><foreignObject/></svg>',
      '<svg viewBox="0 0 1 1" onload="x()"></svg>',
      '<svg viewBox="0 0 1 1"><a href="javascript:x()"/></svg>',
      '<svg viewBox="0 0 1 1"><image href="https://example.com/a.png"/></svg>',
      '<svg viewBox="0 0 1 1"><rect style="fill:url(https://example.com/x)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>',
    ]) expect(checkSvg(bad).ok).toBe(false);
  });
  it("allows internal references and inline images", () => {
    expect(checkSvg('<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/><image href="data:image/png;base64,AAAA"/></svg>').ok).toBe(true);
  });
  it("refuses a file that is not an SVG or has no size", () => {
    expect(checkSvg("hello").ok).toBe(false);
    expect(checkSvg("<svg><rect/></svg>").ok).toBe(false);
  });
});

describe("svgColors and recolorSvg", () => {
  it("lists paint colours once, lower-cased and in order", () => {
    expect(svgColors(logo)).toEqual(["#00a94f", "#ffffff", "#ef453d"]);
  });
  it("replaces attribute and style colours, case-insensitively, and leaves the rest", () => {
    const out = recolorSvg(logo, { "#00a94f": "#0085cf", "#FFF": "#000000" });
    expect(out).toContain('fill="#0085cf"');
    expect(out).toContain("stroke:#000000");
    expect(out).toContain("fill='#ef453d'");
  });
  it("paints an SVG with only the implicit black", () => {
    const plain = '<svg viewBox="0 0 10 10"><path d="M0 0h5v5z"/></svg>';
    expect(svgColors(plain)).toEqual(["#000000"]);
    expect(recolorSvg(plain, { "#000000": "#823f8d" })).toContain('<svg fill="#823f8d"');
  });
  it("ignores an empty or invalid map", () => {
    expect(recolorSvg(logo, {})).toBe(logo);
    expect(recolorSvg(logo, { nope: "#fff" })).toBe(logo);
  });
});

describe("layerRecolor", () => {
  it("reads the JSON map from the style and drops invalid or identical entries", () => {
    expect(layerRecolor({ "svg-recolor": JSON.stringify({ "#000": "#ff0000", "#111111": "#111111", x: "#fff", "#222222": "red" }) })).toEqual({ "#000000": "#ff0000" });
    expect(layerRecolor({})).toEqual({});
    expect(layerRecolor({ "svg-recolor": "{broken" })).toEqual({});
  });
});
