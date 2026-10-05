import { z } from "zod";
import type { Connector, FireResult, Mapping, NetworkRules, RequestDef } from "varfetch";
import { VARIABLE_KEY_PATTERN } from "@/domain/variables";

/**
 * API connectors: user-configured HTTP APIs whose responses fill project variables.
 * The request itself (interpolation, SSRF guard, JSON path mapping) is done by the `varfetch` package;
 * this file holds what Saarnavideo adds: validation, secret masking and the network policy from the environment.
 */

const pairSchema = z.object({ key: z.string().trim().max(200), value: z.string().max(2000) });

export const AUTH_TYPES = ["none", "bearer", "api_key", "basic"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/** What the client sends. A secret left out (or empty) keeps the stored one, so editing a connector never needs the secret again. */
export const authInputSchema = z.object({
  type: z.enum(AUTH_TYPES),
  token: z.string().max(2000).optional(),
  headerName: z.string().trim().max(200).optional(),
  value: z.string().max(2000).optional(),
  username: z.string().max(500).optional(),
  password: z.string().max(2000).optional(),
});
export type AuthInput = z.infer<typeof authInputSchema>;

const baseUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Base URL must be an http or https address");

// The patch schemas are built from fields without defaults: a default would be applied to a field the client left out and overwrite it.
const connectorFields = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: baseUrlSchema,
  auth: authInputSchema,
  headers: z.array(pairSchema).max(30),
});
export const connectorInputSchema = connectorFields.extend({ auth: authInputSchema.default({ type: "none" }), headers: connectorFields.shape.headers.default([]) });
export const connectorPatchSchema = connectorFields.partial();

export const mappingSchema = z.object({
  jsonPath: z.string().trim().min(1).max(300),
  variable: z.string().regex(VARIABLE_KEY_PATTERN, "Variable names use letters, digits, - or _ (max 40)"),
  skipIfNull: z.boolean().default(true),
});

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const requestFields = z.object({
  name: z.string().trim().min(1).max(100),
  method: methodSchema,
  path: z.string().max(1000),
  query: z.array(pairSchema).max(30),
  bodyType: z.enum(["none", "json", "text"]),
  body: z.string().max(20000).nullable(),
  responseType: z.enum(["auto", "json", "text"]),
  mappings: z.array(mappingSchema).max(50),
  timeoutMs: z.number().int().min(100).max(60000).nullable(),
});
export const requestInputSchema = requestFields.extend({
  method: requestFields.shape.method.default("GET"),
  path: requestFields.shape.path.default(""),
  query: requestFields.shape.query.default([]),
  bodyType: requestFields.shape.bodyType.default("none"),
  body: requestFields.shape.body.optional(),
  responseType: requestFields.shape.responseType.default("auto"),
  mappings: requestFields.shape.mappings.default([]),
  timeoutMs: requestFields.shape.timeoutMs.optional(),
});
export const requestPatchSchema = requestFields.partial();

export type StoredAuth = AuthInput;

/** Keeps a stored secret when the update leaves it out; switching the auth type drops secrets of the old type. */
export function mergeAuth(previous: StoredAuth | undefined, input: AuthInput): StoredAuth {
  const same = previous?.type === input.type;
  const keep = <K extends "token" | "value" | "password">(key: K) => (input[key] ? input[key] : same ? previous?.[key] : undefined);
  switch (input.type) {
    case "bearer":
      return { type: "bearer", token: keep("token") };
    case "api_key":
      return { type: "api_key", headerName: input.headerName ?? (same ? previous?.headerName : undefined), value: keep("value") };
    case "basic":
      return { type: "basic", username: input.username ?? (same ? previous?.username : undefined), password: keep("password") };
    default:
      return { type: "none" };
  }
}

/** The auth block as shown to the browser: no secrets, only whether one is stored. */
export function maskAuth(auth: StoredAuth) {
  return {
    type: auth.type,
    headerName: auth.headerName,
    username: auth.username,
    hasSecret: Boolean(auth.token || auth.value || auth.password),
  };
}

type ConnectorRow = { id: string; name: string; baseUrl: string; auth: unknown; headers: unknown };
type RequestRow = {
  id: string;
  connectorId: string;
  name: string;
  method: string;
  path: string;
  query: unknown;
  bodyType: string;
  body: string | null;
  responseType: string;
  mappings: unknown;
  timeoutMs: number | null;
  sortOrder: number;
};

const asPairs = (value: unknown) => z.array(pairSchema).catch([]).parse(value);
const asAuth = (value: unknown) => authInputSchema.catch({ type: "none" }).parse(value);

export function connectorView(row: ConnectorRow & { requests?: RequestRow[] }) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    auth: maskAuth(asAuth(row.auth)),
    headers: asPairs(row.headers),
    requests: (row.requests ?? []).map(requestView),
  };
}

export function requestView(row: RequestRow) {
  return {
    id: row.id,
    connectorId: row.connectorId,
    name: row.name,
    method: row.method,
    path: row.path,
    query: asPairs(row.query),
    bodyType: row.bodyType,
    body: row.body,
    responseType: row.responseType,
    mappings: z.array(mappingSchema).catch([]).parse(row.mappings),
    timeoutMs: row.timeoutMs,
  };
}

/** Rows to the shapes `varfetch.fireRequest` takes. */
export function toVarfetch(connector: ConnectorRow, request: RequestRow): { connector: Connector; request: RequestDef } {
  return {
    connector: { baseUrl: connector.baseUrl, auth: asAuth(connector.auth) as Connector["auth"], headers: asPairs(connector.headers) },
    request: {
      method: request.method,
      path: request.path,
      query: asPairs(request.query),
      bodyType: request.bodyType as RequestDef["bodyType"],
      body: request.body ?? undefined,
      responseType: request.responseType as RequestDef["responseType"],
      mappings: z.array(mappingSchema).catch([]).parse(request.mappings) as Mapping[],
      timeoutMs: request.timeoutMs ?? undefined,
    },
  };
}

/**
 * Network policy for connector requests: varfetch blocks private, loopback and link-local addresses by default.
 * `CONNECTOR_ALLOW` (comma separated host, IP, CIDR or host:port patterns) opens specific targets such as an
 * anno-api instance on a private network; `CONNECTOR_DENY` blocks targets even if allowed. Environment only,
 * because the app has no login and the UI must not be able to widen what the server may reach.
 */
export function networkRulesFromEnv(env: Record<string, string | undefined> = process.env): NetworkRules {
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return { allow: list(env.CONNECTOR_ALLOW), deny: list(env.CONNECTOR_DENY) };
}

/** Result in the shape the API returns: remote failures are an error message, never a stack trace. */
export function fireErrorMessage(result: FireResult) {
  return result.error ?? "The request failed";
}
