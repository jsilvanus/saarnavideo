import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadToFile, fetchJson, fetchText, guardedGet, importNetworkRules, scrubUrl } from "@/lib/import-fetch";

let server: Server;
let base: string;
let dir: string;
const allow = { allow: ["127.0.0.1"] };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "import-fetch-"));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    if (url.pathname === "/json") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: true })); return; }
    if (url.pathname === "/text") { response.end("hello"); return; }
    if (url.pathname === "/big") { response.end(Buffer.alloc(5000, 1)); return; }
    if (url.pathname === "/redirect") { response.statusCode = 302; response.setHeader("location", "/text?token=secret"); response.end(); return; }
    if (url.pathname === "/loop") { response.statusCode = 302; response.setHeader("location", "/loop"); response.end(); return; }
    if (url.pathname === "/to-metadata") { response.statusCode = 302; response.setHeader("location", "http://169.254.169.254/latest/meta-data"); response.end(); return; }
    response.statusCode = 404; response.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

describe("guarded fetching", () => {
  it("refuses private and loopback targets unless they are allowed", async () => {
    await expect(fetchText(`${base}/text`, "thing", 100, { rules: {} })).rejects.toThrow(/Blocked/);
    expect(await fetchText(`${base}/text`, "thing", 100, { rules: allow })).toBe("hello");
  });

  it("reads JSON and rejects bad answers without leaking the query string", async () => {
    expect(await fetchJson(`${base}/json`, "manifest", 1000, { rules: allow })).toEqual({ ok: true });
    await expect(fetchJson(`${base}/text?token=abc`, "manifest", 1000, { rules: allow })).rejects.toThrow("manifest is not valid JSON");
    const error = await fetchText(`${base}/missing?token=abc`, "thing", 100, { rules: allow }).catch((e: Error) => e);
    expect((error as Error).message).toContain("answered 404");
    expect((error as Error).message).not.toContain("abc");
  });

  it("follows redirects but checks every hop and gives up on loops", async () => {
    const response = await guardedGet(`${base}/redirect`, { rules: allow });
    expect(await response.text()).toBe("hello");
    await expect(guardedGet(`${base}/to-metadata`, { rules: allow })).rejects.toThrow(/Blocked/);
    await expect(guardedGet(`${base}/loop`, { rules: allow })).rejects.toThrow(/Too many redirects/);
  });

  it("stops a body that is larger than allowed", async () => {
    await expect(fetchText(`${base}/big`, "thing", 1000, { rules: allow })).rejects.toThrow(/larger than/);
    const target = path.join(dir, "big.bin");
    await expect(downloadToFile(`${base}/big`, target, { rules: allow, maxBytes: 1000 })).rejects.toThrow(/larger than/);
    await expect(stat(target)).rejects.toThrow();
  });

  it("downloads a file and reports progress", async () => {
    const target = path.join(dir, "ok.bin");
    const seen: number[] = [];
    const size = await downloadToFile(`${base}/big`, target, { rules: allow, maxBytes: 10_000, onProgress: (bytes) => seen.push(bytes) });
    expect(size).toBe(5000);
    expect((await readFile(target)).length).toBe(5000);
    expect(seen.at(-1)).toBe(5000);
  });

  it("only accepts http(s) and takes extra allow rules from IMPORT_ALLOW", async () => {
    await expect(guardedGet("file:///etc/passwd", { rules: allow })).rejects.toThrow(/Unsupported protocol/);
    expect(importNetworkRules({ CONNECTOR_ALLOW: "a.example", IMPORT_ALLOW: "10.0.0.5, b.example", IMPORT_DENY: "evil.example" })).toEqual({ allow: ["a.example", "10.0.0.5", "b.example"], deny: ["evil.example"] });
  });

  it("scrubs the query string and credentials from addresses", () => {
    expect(scrubUrl("https://user:pw@lcyt.example/api/v1/handoff/g/files/a.mp4?token=secret")).toBe("https://lcyt.example/api/v1/handoff/g/files/a.mp4");
    expect(scrubUrl("not a url")).toBe("(invalid URL)");
  });
});
