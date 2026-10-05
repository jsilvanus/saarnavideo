import { describe, expect, it } from "vitest";
import { accessSecret, isAuthorized, isPublicPath, safeEqual, safeNext, sessionToken } from "./access-gate";

describe("access gate", () => {
  it("is off without a secret and trims the one that is set", () => {
    expect(accessSecret({})).toBeNull();
    expect(accessSecret({ ACCESS_SECRET: "  " })).toBeNull();
    expect(accessSecret({ ACCESS_SECRET: " s3cret " })).toBe("s3cret");
  });

  it("derives a stable session token that changes with the secret", async () => {
    expect(await sessionToken("a")).toBe(await sessionToken("a"));
    expect(await sessionToken("a")).not.toBe(await sessionToken("b"));
    expect(await sessionToken("a")).not.toContain("a".repeat(8));
  });

  it("compares strings of different length without throwing", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
    expect(await safeEqual("", "abc")).toBe(false);
  });

  it("accepts the session cookie, the header or a bearer token, and nothing else", async () => {
    const secret = "correct horse";
    expect(await isAuthorized({ secret, cookie: await sessionToken(secret) })).toBe(true);
    expect(await isAuthorized({ secret, header: secret })).toBe(true);
    expect(await isAuthorized({ secret, authorization: `Bearer ${secret}` })).toBe(true);
    expect(await isAuthorized({ secret, authorization: `bearer ${secret}` })).toBe(true);
    expect(await isAuthorized({ secret })).toBe(false);
    expect(await isAuthorized({ secret, cookie: secret })).toBe(false); // the raw secret is not the cookie value
    expect(await isAuthorized({ secret, cookie: await sessionToken("other") })).toBe(false);
    expect(await isAuthorized({ secret, header: "wrong", authorization: "Bearer wrong" })).toBe(false);
  });

  it("leaves only the login routes public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/login")).toBe(true);
    expect(isPublicPath("/api/projects")).toBe(false);
    expect(isPublicPath("/api/integrations/youtube/callback")).toBe(false);
  });

  it("only redirects to same-site paths after login", () => {
    expect(safeNext("/assets?x=1")).toBe("/assets?x=1");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
  });
});
