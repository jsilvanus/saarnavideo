import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as LIST, POST as CREATE } from "./route";
import { DELETE as DELETE_CONNECTOR, GET as GET_ONE, PATCH as PATCH_CONNECTOR } from "./[id]/route";
import { POST as CREATE_REQUEST } from "./[id]/requests/route";
import { DELETE as DELETE_REQUEST, PATCH as PATCH_REQUEST } from "./[id]/requests/[requestId]/route";
import { POST as TEST_REQUEST } from "./[id]/requests/[requestId]/test/route";
import { POST as FETCH_VARIABLES } from "../projects/[id]/fetch-variables/route";

let server: http.Server;
let base: string;
let lastAuth: string | undefined;
let projectId: string;
const connectorIds: string[] = [];

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const post = (url: string, body: unknown) => new Request(url, json(body));
const patch = (body: unknown) => new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });

async function makeConnector(extra: Record<string, unknown> = {}) {
  const res = await CREATE(post("http://localhost/api/connectors", { name: `anno-${connectorIds.length}-${Date.now()}`, baseUrl: base, ...extra }));
  const body = await res.json();
  expect(res.status).toBe(201);
  connectorIds.push(body.id);
  return body as { id: string; auth: { hasSecret: boolean } };
}

async function makeRequest(connectorId: string, extra: Record<string, unknown> = {}) {
  const res = await CREATE_REQUEST(post("http://localhost/x", { name: "day", path: "/day/{{paiva}}", mappings: [{ jsonPath: "$.name", variable: "pyhapaiva" }, { jsonPath: "$.gospel.ref", variable: "evankeliumi" }], ...extra }), { params: Promise.resolve({ id: connectorId }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization;
    if (req.url?.startsWith("/day/")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ name: `Pyhä ${req.url.slice(5)}`, gospel: { ref: "Matt. 22:1-14" } }));
    } else {
      res.statusCode = 404;
      res.end("no");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.CONNECTOR_ALLOW = `127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  delete process.env.CONNECTOR_ALLOW;
});

beforeEach(async () => {
  lastAuth = undefined;
  projectId = (await prisma.project.create({ data: { title: "Connector test", definition: {} } })).id;
});

afterEach(async () => {
  await prisma.apiConnector.deleteMany({ where: { id: { in: connectorIds.splice(0) } } });
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
});

describe("connector CRUD", () => {
  it("creates, lists and masks secrets", async () => {
    const created = await makeConnector({ auth: { type: "bearer", token: "top-secret" }, headers: [{ key: "Accept-Language", value: "fi" }] });
    expect(created.auth.hasSecret).toBe(true);
    const list = await (await LIST()).json();
    const found = list.connectors.find((c: { id: string }) => c.id === created.id);
    expect(found.headers).toEqual([{ key: "Accept-Language", value: "fi" }]);
    expect(JSON.stringify(list)).not.toContain("top-secret");
    expect((await prisma.apiConnector.findUniqueOrThrow({ where: { id: created.id } })).auth).toMatchObject({ token: "top-secret" });
  });

  it("answers 400 for a bad base URL and 409 for a duplicate name", async () => {
    expect((await CREATE(post("http://x", { name: "a", baseUrl: "javascript:alert(1)" }))).status).toBe(400);
    const created = await makeConnector();
    const name = (await (await GET_ONE(new Request("http://x"), { params: Promise.resolve({ id: created.id }) })).json()).name;
    expect((await CREATE(post("http://x", { name, baseUrl: base }))).status).toBe(409);
  });

  it("keeps the stored secret when a patch leaves it out", async () => {
    const created = await makeConnector({ auth: { type: "bearer", token: "keep-me" } });
    const res = await PATCH_CONNECTOR(patch({ baseUrl: base, auth: { type: "bearer" } }), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    expect((await prisma.apiConnector.findUniqueOrThrow({ where: { id: created.id } })).auth).toMatchObject({ type: "bearer", token: "keep-me" });
  });

  it("deletes a connector together with its requests", async () => {
    const created = await makeConnector();
    const request = await makeRequest(created.id);
    expect((await DELETE_CONNECTOR(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: created.id }) })).status).toBe(200);
    expect(await prisma.apiRequest.findUnique({ where: { id: request.id } })).toBeNull();
    expect((await DELETE_CONNECTOR(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: created.id }) })).status).toBe(404);
  });

  it("validates, updates and deletes requests", async () => {
    const created = await makeConnector();
    const bad = await CREATE_REQUEST(post("http://x", { name: "x", mappings: [{ jsonPath: "$.a", variable: "has space" }] }), { params: Promise.resolve({ id: created.id }) });
    expect(bad.status).toBe(400);
    const request = await makeRequest(created.id);
    const dup = await CREATE_REQUEST(post("http://x", { name: "day" }), { params: Promise.resolve({ id: created.id }) });
    expect(dup.status).toBe(409);
    const ctx = { params: Promise.resolve({ id: created.id, requestId: request.id }) };
    const updated = await (await PATCH_REQUEST(patch({ path: "/other" }), ctx)).json();
    expect(updated.path).toBe("/other");
    expect(updated.mappings).toHaveLength(2);
    expect((await DELETE_REQUEST(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect((await DELETE_REQUEST(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(404);
  });
});

describe("firing requests", () => {
  it("tests a request with given variables and sends the stored auth", async () => {
    const connector = await makeConnector({ auth: { type: "bearer", token: "abc" } });
    const request = await makeRequest(connector.id);
    const res = await TEST_REQUEST(post("http://x", { variables: { paiva: "2026-10-11" } }), { params: Promise.resolve({ id: connector.id, requestId: request.id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, values: { pyhapaiva: "Pyhä 2026-10-11", evankeliumi: "Matt. 22:1-14" } });
    expect(lastAuth).toBe("Bearer abc");
  });

  it("answers 502 with the reason when the remote fails, and 404 for an unknown request", async () => {
    const connector = await makeConnector();
    const request = await makeRequest(connector.id, { path: "/missing" });
    const res = await TEST_REQUEST(post("http://x", {}), { params: Promise.resolve({ id: connector.id, requestId: request.id }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("HTTP 404");
    expect((await TEST_REQUEST(post("http://x", {}), { params: Promise.resolve({ id: connector.id, requestId: "nope" }) })).status).toBe(404);
  });

  it("is blocked by the network guard when the target is not allowed", async () => {
    const saved = process.env.CONNECTOR_ALLOW;
    process.env.CONNECTOR_ALLOW = "";
    try {
      const connector = await makeConnector();
      const request = await makeRequest(connector.id);
      const res = await TEST_REQUEST(post("http://x", { variables: { paiva: "x" } }), { params: Promise.resolve({ id: connector.id, requestId: request.id }) });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/private\/internal\/reserved/);
    } finally {
      process.env.CONNECTOR_ALLOW = saved;
    }
  });

  it("fetches variables for a project: project variables fill the path, the body overrides them", async () => {
    const connector = await makeConnector();
    const request = await makeRequest(connector.id);
    await prisma.project.update({ where: { id: projectId }, data: { definition: { version: 1, semanticSegments: [], composition: { sourceStartSeconds: 0, sourceEndSeconds: 1, items: [] }, variables: [{ key: "paiva", value: "from-project" }] } } });
    const ctx = { params: Promise.resolve({ id: projectId }) };
    const fromProject = await (await FETCH_VARIABLES(post("http://x", { requestId: request.id }), ctx)).json();
    expect(fromProject.values.pyhapaiva).toBe("Pyhä from-project");
    const overridden = await (await FETCH_VARIABLES(post("http://x", { requestId: request.id, variables: { paiva: "from-body" } }), ctx)).json();
    expect(overridden.values.pyhapaiva).toBe("Pyhä from-body");
    expect((await FETCH_VARIABLES(post("http://x", { requestId: request.id }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect((await FETCH_VARIABLES(post("http://x", {}), ctx)).status).toBe(400);
    // Fetching never saves anything.
    const stored = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).definition as { variables: unknown };
    expect(stored.variables).toEqual([{ key: "paiva", value: "from-project" }]);
  });
});

describe("patching leaves other fields alone", () => {
  it("a rename keeps auth and headers", async () => {
    const connector = await makeConnector({ auth: { type: "bearer", token: "keep" }, headers: [{ key: "A", value: "b" }] });
    const res = await PATCH_CONNECTOR(patch({ name: `renamed-${Date.now()}` }), { params: Promise.resolve({ id: connector.id }) });
    expect(res.status).toBe(200);
    const row = await prisma.apiConnector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(row.auth).toMatchObject({ type: "bearer", token: "keep" });
    expect(row.headers).toEqual([{ key: "A", value: "b" }]);
  });
});
