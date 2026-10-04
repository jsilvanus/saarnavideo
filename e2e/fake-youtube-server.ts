import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A small fake of the Google endpoints SaarnaVideo talks to, for e2e tests (no real credentials exist):
 * POST /token (authorization_code and refresh_token grants), the resumable uploads of videos.insert and captions.insert
 * (init request answers a Location, the PUT carries the bytes) and thumbnails.set. Every request needs
 * `Authorization: Bearer <accessToken>` for the token it handed out last. State is observable and configurable over
 * /__admin/state, /__admin/reset and /__admin/config so a test in another process can drive it.
 */

export type FakeYouTubeConfig = {
  /** Make video upload initialisation fail with this HTTP status (0 = succeed). */
  failVideoInit: number;
  failThumbnails: boolean;
  failCaptions: boolean;
  /** Seconds a handed-out access token lives; 0 or less makes every token expired immediately, so each upload refreshes. */
  expiresIn: number;
};

export type FakeYouTubeState = {
  config: FakeYouTubeConfig;
  tokenRequests: Array<{ grant: string; hasClientSecret: boolean }>;
  videos: Array<{ id: string; title: string; description: string; privacyStatus: string; size: number; sha256: string; contentType: string }>;
  thumbnails: Array<{ videoId: string; size: number }>;
  captions: Array<{ videoId: string; language: string; name: string; content: string }>;
  /** Every request as "METHOD path" (no query string, never a token). */
  requests: string[];
  /** Requests that arrived with a token other than the current one. */
  unauthorized: number;
};

const defaults = (): FakeYouTubeConfig => ({ failVideoInit: 0, failThumbnails: false, failCaptions: false, expiresIn: 3600 });

export type FakeYouTubeServer = { url: string; server: Server; state: FakeYouTubeState; close(): Promise<void> };

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

const googleError = (response: ServerResponse, status: number, message: string) => send(response, status, { error: { code: status, message } });

export async function startFakeYouTubeServer(overrides: Partial<FakeYouTubeConfig> = {}, port = 0): Promise<FakeYouTubeServer> {
  const state: FakeYouTubeState = { config: { ...defaults(), ...overrides }, tokenRequests: [], videos: [], thumbnails: [], captions: [], requests: [], unauthorized: 0 };
  /** Upload sessions opened by an init request, keyed by session id. */
  const sessions = new Map<string, { kind: "video" | "caption"; meta: Record<string, any>; contentType: string }>();
  let counter = 0;
  let accessToken = "";
  let origin = "";

  const newToken = () => (accessToken = `fake-access-${++counter}`);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://fake");
      const body = await readBody(request);
      if (url.pathname.startsWith("/__admin/")) {
        if (url.pathname === "/__admin/state") return send(response, 200, state);
        if (url.pathname === "/__admin/reset") { Object.assign(state, { config: { ...defaults(), ...overrides }, tokenRequests: [], videos: [], thumbnails: [], captions: [], requests: [], unauthorized: 0 }); sessions.clear(); return send(response, 200, {}); }
        if (url.pathname === "/__admin/config") { Object.assign(state.config, JSON.parse(body.toString() || "{}")); return send(response, 200, state.config); }
        return send(response, 404, {});
      }
      state.requests.push(`${request.method} ${url.pathname}`);

      if (request.method === "POST" && url.pathname === "/token") {
        const form = new URLSearchParams(body.toString());
        const grant = form.get("grant_type") ?? "";
        state.tokenRequests.push({ grant, hasClientSecret: !!form.get("client_secret") });
        if (grant === "authorization_code") {
          if (form.get("code") !== "good-code") return send(response, 400, { error: "invalid_grant" });
          return send(response, 200, { access_token: newToken(), refresh_token: "fake-refresh-token", expires_in: state.config.expiresIn, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl" });
        }
        if (grant === "refresh_token") {
          if (form.get("refresh_token") !== "fake-refresh-token") return send(response, 400, { error: "invalid_grant" });
          return send(response, 200, { access_token: newToken(), expires_in: state.config.expiresIn });
        }
        return send(response, 400, { error: "unsupported_grant_type" });
      }

      // Everything below is the Data API: it needs the current access token.
      if (request.headers.authorization !== `Bearer ${accessToken}` || !accessToken) { state.unauthorized++; return googleError(response, 401, "Invalid Credentials"); }

      if (request.method === "POST" && url.pathname === "/upload/youtube/v3/videos") {
        if (state.config.failVideoInit) return googleError(response, state.config.failVideoInit, "Quota exceeded");
        const meta = JSON.parse(body.toString() || "{}");
        const id = `session-${++counter}`;
        sessions.set(id, { kind: "video", meta, contentType: String(request.headers["x-upload-content-type"] ?? "") });
        return send(response, 200, {}, { Location: `${origin}/upload-session/${id}` });
      }
      if (request.method === "POST" && url.pathname === "/upload/youtube/v3/captions") {
        if (state.config.failCaptions) return googleError(response, 403, "Insufficient Permission");
        const meta = JSON.parse(body.toString() || "{}");
        const id = `session-${++counter}`;
        sessions.set(id, { kind: "caption", meta, contentType: "" });
        return send(response, 200, {}, { Location: `${origin}/upload-session/${id}` });
      }
      const sessionId = url.pathname.match(/^\/upload-session\/(.+)$/)?.[1];
      if (request.method === "PUT" && sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return googleError(response, 404, "Unknown upload session");
        sessions.delete(sessionId);
        if (session.kind === "video") {
          const id = `video${++counter}`;
          state.videos.push({ id, title: session.meta.snippet?.title ?? "", description: session.meta.snippet?.description ?? "", privacyStatus: session.meta.status?.privacyStatus ?? "", size: body.length, sha256: createHash("sha256").update(body).digest("hex"), contentType: String(request.headers["content-type"] ?? "") });
          return send(response, 200, { id });
        }
        const id = `caption${++counter}`;
        state.captions.push({ videoId: session.meta.snippet?.videoId ?? "", language: session.meta.snippet?.language ?? "", name: session.meta.snippet?.name ?? "", content: body.toString("utf8") });
        return send(response, 200, { id });
      }
      if (request.method === "POST" && url.pathname === "/upload/youtube/v3/thumbnails/set") {
        if (state.config.failThumbnails) return googleError(response, 403, "The authenticated user cannot upload custom video thumbnails");
        state.thumbnails.push({ videoId: url.searchParams.get("videoId") ?? "", size: body.length });
        return send(response, 200, { items: [] });
      }
      return googleError(response, 404, "Unsupported operation");
    } catch (error) {
      send(response, 500, { error: { code: 500, message: String(error) } });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake YouTube server has no address");
  origin = `http://127.0.0.1:${address.port}`;
  return { url: origin, server, state, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** Admin helpers for tests that only know the server URL. */
export async function fakeYouTubeState(url: string): Promise<FakeYouTubeState> { return (await fetch(`${url}/__admin/state`)).json() as Promise<FakeYouTubeState>; }
export async function fakeYouTubeReset(url: string): Promise<void> { await fetch(`${url}/__admin/reset`, { method: "POST" }); }
export async function fakeYouTubeConfigure(url: string, patch: Partial<FakeYouTubeConfig>): Promise<void> { await fetch(`${url}/__admin/config`, { method: "POST", body: JSON.stringify(patch) }); }
