import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATE_COOKIE, sessionToken } from "@/lib/access-gate";
import { middleware } from "./middleware";

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost:3000${path}`, { headers });

describe("middleware", () => {
  beforeEach(() => {
    process.env.ACCESS_SECRET = "open sesame";
  });
  afterEach(() => {
    delete process.env.ACCESS_SECRET;
  });

  it("passes everything when no secret is configured", async () => {
    delete process.env.ACCESS_SECRET;
    const response = await middleware(request("/api/projects"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers API calls without the secret with 401 JSON", async () => {
    const response = await middleware(request("/api/projects"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("sends pages to the login page and remembers where they were going", async () => {
    const response = await middleware(request("/assets?folder=2"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/assets?folder=2");
    const home = await middleware(request("/"));
    expect(new URL(home.headers.get("location")!).searchParams.has("next")).toBe(false);
  });

  it("lets the login routes through", async () => {
    expect((await middleware(request("/login"))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("/api/auth/login"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("does not exempt the OAuth callback", async () => {
    expect((await middleware(request("/api/integrations/youtube/callback?code=x"))).status).toBe(401);
  });

  it("lets requests with the cookie, header or bearer token through", async () => {
    const cookie = `${GATE_COOKIE}=${await sessionToken("open sesame")}`;
    expect((await middleware(request("/api/projects", { cookie }))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("/api/projects", { "x-access-secret": "open sesame" }))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("/api/projects", { authorization: "Bearer open sesame" }))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("/api/projects", { cookie: `${GATE_COOKIE}=nope` }))).status).toBe(401);
  });
});
