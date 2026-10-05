import { describe, expect, it } from "vitest";
import { connectorInputSchema, connectorPatchSchema, connectorView, maskAuth, mappingSchema, mergeAuth, networkRulesFromEnv, requestInputSchema, requestPatchSchema, toVarfetch } from "./connectors";

describe("mergeAuth", () => {
  it("keeps the stored secret when the update leaves it out", () => {
    const previous = { type: "bearer" as const, token: "secret" };
    expect(mergeAuth(previous, { type: "bearer" })).toEqual({ type: "bearer", token: "secret" });
    expect(mergeAuth(previous, { type: "bearer", token: "" })).toEqual({ type: "bearer", token: "secret" });
    expect(mergeAuth(previous, { type: "bearer", token: "new" })).toEqual({ type: "bearer", token: "new" });
  });

  it("drops secrets of the old type when the type changes", () => {
    const previous = { type: "bearer" as const, token: "secret" };
    expect(mergeAuth(previous, { type: "basic", username: "u" })).toEqual({ type: "basic", username: "u", password: undefined });
    expect(mergeAuth(previous, { type: "none" })).toEqual({ type: "none" });
  });

  it("keeps header name and value of an api key", () => {
    const previous = { type: "api_key" as const, headerName: "X-Key", value: "k" };
    expect(mergeAuth(previous, { type: "api_key", headerName: "X-Other" })).toEqual({ type: "api_key", headerName: "X-Other", value: "k" });
  });
});

describe("maskAuth and connectorView", () => {
  it("never exposes secrets", () => {
    expect(maskAuth({ type: "basic", username: "u", password: "p" })).toEqual({ type: "basic", username: "u", headerName: undefined, hasSecret: true });
    expect(maskAuth({ type: "none" }).hasSecret).toBe(false);
    const view = connectorView({ id: "1", name: "anno", baseUrl: "https://x.test", auth: { type: "bearer", token: "secret" }, headers: [{ key: "A", value: "b" }], requests: [] });
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(view.auth.hasSecret).toBe(true);
  });

  it("falls back to no auth and no headers for malformed stored JSON", () => {
    const view = connectorView({ id: "1", name: "anno", baseUrl: "https://x.test", auth: "garbage", headers: 5 });
    expect(view.auth.type).toBe("none");
    expect(view.headers).toEqual([]);
  });
});

describe("input schemas", () => {
  it("accepts only http(s) base URLs", () => {
    expect(connectorInputSchema.safeParse({ name: "a", baseUrl: "https://api.test" }).success).toBe(true);
    for (const baseUrl of ["file:///etc/passwd", "ftp://x.test", "not a url", ""]) expect(connectorInputSchema.safeParse({ name: "a", baseUrl }).success).toBe(false);
  });

  it("validates variable names of mappings with the project variable rule", () => {
    expect(mappingSchema.safeParse({ jsonPath: "$.a", variable: "evankeliumi" }).success).toBe(true);
    expect(mappingSchema.safeParse({ jsonPath: "$.a", variable: "bad name" }).success).toBe(false);
    expect(mappingSchema.parse({ jsonPath: "$.a", variable: "x" }).skipIfNull).toBe(true);
  });

  it("applies request defaults", () => {
    const parsed = requestInputSchema.parse({ name: "date" });
    expect(parsed).toMatchObject({ method: "GET", path: "", bodyType: "none", responseType: "auto", mappings: [], query: [] });
  });
});

describe("toVarfetch", () => {
  it("builds the connector and request varfetch expects", () => {
    const { connector, request } = toVarfetch(
      { id: "c", name: "anno", baseUrl: "https://x.test", auth: { type: "bearer", token: "t" }, headers: [{ key: "A", value: "b" }] },
      { id: "r", connectorId: "c", name: "day", method: "GET", path: "/d/{{paiva}}", query: [{ key: "q", value: "1" }], bodyType: "none", body: null, responseType: "auto", mappings: [{ jsonPath: "$.n", variable: "nimi", skipIfNull: true }], timeoutMs: null, sortOrder: 0 },
    );
    expect(connector).toEqual({ baseUrl: "https://x.test", auth: { type: "bearer", token: "t" }, headers: [{ key: "A", value: "b" }] });
    expect(request).toMatchObject({ method: "GET", path: "/d/{{paiva}}", query: [{ key: "q", value: "1" }], body: undefined, timeoutMs: undefined });
    expect(request.mappings).toEqual([{ jsonPath: "$.n", variable: "nimi", skipIfNull: true }]);
  });
});

describe("networkRulesFromEnv", () => {
  it("splits comma separated patterns", () => {
    expect(networkRulesFromEnv({ CONNECTOR_ALLOW: "10.0.0.0/8, anno.internal:3000 ,", CONNECTOR_DENY: "" })).toEqual({ allow: ["10.0.0.0/8", "anno.internal:3000"], deny: [] });
    expect(networkRulesFromEnv({})).toEqual({ allow: [], deny: [] });
  });
});

describe("patch schemas", () => {
  it("leave out what the client did not send instead of applying create defaults", () => {
    expect(connectorPatchSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(requestPatchSchema.parse({ path: "/p" })).toEqual({ path: "/p" });
  });
});
