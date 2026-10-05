import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DELETE, GET, PUT } from "@/app/api/integrations/youtube/cookies/route";
import { countCookies, parseCookiesText, withDownloadCookies, type CookieStore } from "./ytdlp-cookies";

const line = (name: string, value: string) => [".youtube.com", "TRUE", "/", "TRUE", "2000000000", name, value].join("\t");
const COOKIES = `# Netscape HTTP Cookie File\n${line("SID", "secret-sid-value")}\n${line("HSID", "secret-hsid-value")}\n`;
const put = (cookies: unknown) => PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ cookies }) }));

beforeEach(() => {
  process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  delete process.env.YTDLP_COOKIES_FILE;
});
afterEach(async () => {
  await prisma.ytDlpCookies.deleteMany();
  delete process.env.YTDLP_COOKIES_FILE;
});

describe("parseCookiesText", () => {
  it("counts cookie lines, HttpOnly lines included and plain comments excluded", () => {
    expect(countCookies(`# comment\n#HttpOnly_${line("A", "1")}\n${line("B", "2")}\n\nnot a cookie`)).toBe(2);
  });
  it("adds the Netscape header, normalises line endings and rejects non-cookie text", () => {
    expect(parseCookiesText(`${line("A", "1")}\r\n`).text).toBe(`# Netscape HTTP Cookie File\n${line("A", "1")}\n`);
    expect(() => parseCookiesText("hello world")).toThrow(/No cookies found/);
    expect(() => parseCookiesText("x".repeat(300 * 1024))).toThrow(/too large/);
  });
});

describe("cookies route", () => {
  it("stores encrypted, never returns the text, and replaces/deletes", async () => {
    expect(await (await GET()).json()).toMatchObject({ configured: false, source: "none" });
    const res = await put(COOKIES);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ configured: true, source: "db", cookieCount: 2 });
    expect(JSON.stringify(body)).not.toContain("secret-sid-value");
    const row = await prisma.ytDlpCookies.findFirstOrThrow();
    expect(row.encrypted).toMatch(/^enc:v1:/);
    expect(row.encrypted).not.toContain("secret-sid-value");
    expect((await (await put(`${line("ONLY", "x")}\n`)).json()).cookieCount).toBe(1);
    expect(await prisma.ytDlpCookies.count()).toBe(1);
    expect(await (await DELETE()).json()).toMatchObject({ configured: false });
  });
  it("rejects missing, invalid and unencryptable input", async () => {
    expect((await put(undefined)).status).toBe(400);
    expect((await put("nothing here")).status).toBe(400);
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = "";
    expect((await put(COOKIES)).status).toBe(503);
    expect(await prisma.ytDlpCookies.count()).toBe(0);
  });
  it("reports the env file as fallback", async () => {
    process.env.YTDLP_COOKIES_FILE = "/run/secrets/c.txt";
    expect(await (await GET()).json()).toMatchObject({ configured: true, source: "env", envFallback: true });
    await put(COOKIES);
    expect(await (await GET()).json()).toMatchObject({ source: "db", envFallback: true });
  });
});

describe("withDownloadCookies", () => {
  const memoryStore = (initial: string | null) => {
    const state = { text: initial, saves: 0 };
    const store: CookieStore = { get: async () => state.text, save: async (t) => { state.text = t; state.saves++; } };
    return { state, store };
  };

  it("uses the env file when nothing is stored, and no file when nothing is set", async () => {
    const { store } = memoryStore(null);
    expect((await withDownloadCookies(async (f, i) => [f, i.source], store)).result).toEqual([undefined, "none"]);
    process.env.YTDLP_COOKIES_FILE = " /run/secrets/c.txt ";
    const run = await withDownloadCookies(async (f) => f, store);
    expect(run.result).toBe("/run/secrets/c.txt");
    expect(run.cookies).toEqual({ source: "env", updated: false });
  });

  it("gives stored cookies to the run as a private temp file, removes it, and does not save an unchanged file", async () => {
    process.env.YTDLP_COOKIES_FILE = "/run/secrets/ignored.txt";
    const { state, store } = memoryStore(COOKIES);
    let seen = "";
    const run = await withDownloadCookies(async (file) => { seen = file!; expect(await readFile(file!, "utf8")).toBe(COOKIES); }, store);
    expect(seen).not.toBe("/run/secrets/ignored.txt");
    expect(existsSync(seen)).toBe(false);
    expect(run.cookies).toEqual({ source: "db", updated: false });
    expect(state.saves).toBe(0);
  });

  it("saves cookies that yt-dlp rewrote, ignores an emptied file, and cleans up when the run fails", async () => {
    const refreshed = `# Netscape HTTP Cookie File\n${line("SID", "rotated")}\n`;
    const a = memoryStore(COOKIES);
    expect((await withDownloadCookies(async (f) => writeFile(f!, refreshed), a.store)).cookies).toEqual({ source: "db", updated: true });
    expect(a.state.text).toBe(refreshed);
    const b = memoryStore(COOKIES);
    await withDownloadCookies(async (f) => writeFile(f!, ""), b.store);
    expect(b.state.text).toBe(COOKIES);
    const c = memoryStore(COOKIES);
    let seen = "";
    await expect(withDownloadCookies(async (f) => { seen = f!; throw new Error("boom"); }, c.store)).rejects.toThrow("boom");
    expect(existsSync(seen)).toBe(false);
  });
});
