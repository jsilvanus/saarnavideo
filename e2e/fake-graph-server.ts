import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A small fake of the Facebook Graph API Page video endpoints, for unit/integration/e2e tests (no real credentials
 * exist). It implements: GET /{ver}/{page}?fields=name, the resumable POST /{ver}/{page}/videos (start / transfer /
 * finish) with server-dictated chunk boundaries and byte accounting, GET /{ver}/{video}?fields=status,
 * POST /{ver}/{video}/thumbnails and POST /{ver}/{video}/captions. State is observable and configurable over
 * /__admin/state, /__admin/reset and /__admin/config so a test in another process can drive it.
 */

export type FakeGraphConfig = {
  /** Requests carrying any other token fail with error 190. */
  expectedToken: string;
  pageId: string;
  pageName: string;
  /** Size of the chunk range offered in start/transfer responses. */
  chunkSize: number;
  /** How many status polls answer "processing" before "ready". */
  processingPolls: number;
  /** Final status: "ready" or "error". */
  finalStatus: "ready" | "error";
  /** Make the next N transfer requests fail with HTTP 500. */
  failTransfers: number;
  /** Reject caption uploads with a Graph error. */
  failCaptions: boolean;
  failThumbnails: boolean;
};

export type FakeSession = {
  videoId: string; sessionId: string; fileSize: number; received: number; chunks: Array<{ startOffset: number; size: number }>;
  sha256?: string; finished?: { title: string; description: string; published: string };
  statusPolls: number;
};
export type FakeGraphState = {
  config: FakeGraphConfig;
  sessions: FakeSession[];
  thumbnails: Array<{ videoId: string; size: number; isPreferred: string }>;
  captions: Array<{ videoId: string; filename: string; defaultLocale: string; content: string }>;
  /** Every request as "METHOD path" (no query string, never the token). */
  requests: string[];
  pageNameRequests: number;
};

const defaults = (): FakeGraphConfig => ({ expectedToken: "fake-page-token", pageId: "1234567890", pageName: "Testiseurakunta", chunkSize: 64 * 1024, processingPolls: 1, finalStatus: "ready", failTransfers: 0, failCaptions: false, failThumbnails: false });

export type FakeGraphServer = { url: string; server: Server; state: FakeGraphState; close(): Promise<void> };

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const graphError = (response: ServerResponse, status: number, code: number, message: string, subcode?: number) =>
  send(response, status, { error: { message, type: code === 190 ? "OAuthException" : "GraphMethodException", code, error_subcode: subcode, fbtrace_id: "FAKETRACE" } });

export async function startFakeGraphServer(overrides: Partial<FakeGraphConfig> = {}, port = 0): Promise<FakeGraphServer> {
  const state: FakeGraphState = { config: { ...defaults(), ...overrides }, sessions: [], thumbnails: [], captions: [], requests: [], pageNameRequests: 0 };
  const buffers = new Map<string, Buffer[]>();
  let counter = 0;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://fake");
      const body = await readBody(request);
      if (url.pathname.startsWith("/__admin/")) {
        if (url.pathname === "/__admin/state") return send(response, 200, state);
        if (url.pathname === "/__admin/reset") { state.sessions = []; state.thumbnails = []; state.captions = []; state.requests = []; state.pageNameRequests = 0; state.config = { ...defaults(), ...overrides }; buffers.clear(); return send(response, 200, {}); }
        if (url.pathname === "/__admin/config") { Object.assign(state.config, JSON.parse(body.toString() || "{}")); return send(response, 200, state.config); }
        return send(response, 404, {});
      }
      const match = /^\/v\d+\.\d+\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (!match) return graphError(response, 404, 803, "Unknown path");
      const [, target, edge] = match;
      state.requests.push(`${request.method} /${target}${edge ? `/${edge}` : ""}`);

      let fields = new Map<string, string>();
      let files = new Map<string, { filename: string; bytes: Buffer }>();
      const contentType = request.headers["content-type"] ?? "";
      if (request.method === "POST" && contentType.startsWith("multipart/form-data")) {
        const form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
        for (const [key, value] of form.entries()) {
          if (typeof value === "string") fields.set(key, value);
          else files.set(key, { filename: value.name, bytes: Buffer.from(await value.arrayBuffer()) });
        }
      } else if (request.method === "POST") fields = new Map(new URLSearchParams(body.toString()));
      const token = fields.get("access_token") ?? url.searchParams.get("access_token") ?? request.headers.authorization?.replace(/^Bearer /, "");
      if (token !== state.config.expectedToken) return graphError(response, 400, 190, "Error validating access token: Session has expired", 463);

      if (request.method === "GET" && target === state.config.pageId && !edge) {
        state.pageNameRequests++;
        return send(response, 200, { name: state.config.pageName, id: target });
      }
      if (request.method === "POST" && target === state.config.pageId && edge === "videos") {
        const phase = fields.get("upload_phase");
        if (phase === "start") {
          const fileSize = Number(fields.get("file_size"));
          if (!(fileSize > 0)) return graphError(response, 400, 100, "Invalid file_size");
          const session: FakeSession = { videoId: `900${++counter}`, sessionId: `sess${counter}`, fileSize, received: 0, chunks: [], statusPolls: 0 };
          state.sessions.push(session); buffers.set(session.sessionId, []);
          return send(response, 200, { upload_session_id: session.sessionId, video_id: session.videoId, start_offset: "0", end_offset: String(Math.min(state.config.chunkSize, fileSize)) });
        }
        const session = state.sessions.find((item) => item.sessionId === fields.get("upload_session_id"));
        if (!session) return graphError(response, 400, 100, "Unknown upload session");
        if (phase === "transfer") {
          if (state.config.failTransfers > 0) { state.config.failTransfers--; return graphError(response, 500, 2, "Service temporarily unavailable"); }
          const chunk = files.get("video_file_chunk");
          const startOffset = Number(fields.get("start_offset"));
          if (!chunk) return graphError(response, 400, 100, "video_file_chunk is required");
          if (startOffset !== session.received) return graphError(response, 400, 100, `start_offset ${startOffset} does not match ${session.received}`);
          const expected = Math.min(state.config.chunkSize, session.fileSize - session.received);
          if (chunk.bytes.length !== expected) return graphError(response, 400, 100, `chunk has ${chunk.bytes.length} bytes, expected ${expected}`);
          buffers.get(session.sessionId)!.push(chunk.bytes);
          session.chunks.push({ startOffset, size: chunk.bytes.length });
          session.received += chunk.bytes.length;
          const next = Math.min(session.received + state.config.chunkSize, session.fileSize);
          return send(response, 200, { start_offset: String(session.received), end_offset: String(session.received >= session.fileSize ? session.received : next) });
        }
        if (phase === "finish") {
          if (session.received !== session.fileSize) return graphError(response, 400, 100, `Upload incomplete: ${session.received} of ${session.fileSize} bytes`);
          session.sha256 = createHash("sha256").update(Buffer.concat(buffers.get(session.sessionId)!)).digest("hex");
          session.finished = { title: fields.get("title") ?? "", description: fields.get("description") ?? "", published: fields.get("published") ?? "" };
          return send(response, 200, { success: true });
        }
        return graphError(response, 400, 100, "Unknown upload_phase");
      }
      const session = state.sessions.find((item) => item.videoId === target);
      if (session && request.method === "GET" && !edge) {
        session.statusPolls++;
        const ready = session.statusPolls > state.config.processingPolls;
        const video_status = !ready ? "processing" : state.config.finalStatus;
        return send(response, 200, { id: target, status: { video_status, ...(video_status === "error" ? { processing_phase: { error: { message: "Unsupported codec" } } } : {}) } });
      }
      if (session && request.method === "POST" && edge === "thumbnails") {
        const file = files.get("source");
        if (state.config.failThumbnails || !file) return graphError(response, 400, 100, "Invalid thumbnail");
        state.thumbnails.push({ videoId: target, size: file.bytes.length, isPreferred: fields.get("is_preferred") ?? "" });
        return send(response, 200, { success: true });
      }
      if (session && request.method === "POST" && edge === "captions") {
        const file = files.get("captions_file");
        if (state.config.failCaptions || !file) return graphError(response, 400, 100, "Invalid captions file");
        state.captions.push({ videoId: target, filename: file.filename, defaultLocale: fields.get("default_locale") ?? "", content: file.bytes.toString("utf8") });
        return send(response, 200, { success: true });
      }
      return graphError(response, 404, 803, "Unsupported operation");
    } catch (error) {
      send(response, 500, { error: { message: String(error), code: 1 } });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Graph server has no address");
  return { url: `http://127.0.0.1:${address.port}`, server, state, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** Admin helpers for tests that only know the server URL. */
export async function fakeGraphState(url: string): Promise<FakeGraphState> { return (await fetch(`${url}/__admin/state`)).json() as Promise<FakeGraphState>; }
export async function fakeGraphReset(url: string): Promise<void> { await fetch(`${url}/__admin/reset`, { method: "POST" }); }
export async function fakeGraphConfigure(url: string, patch: Partial<FakeGraphConfig>): Promise<void> { await fetch(`${url}/__admin/config`, { method: "POST", body: JSON.stringify(patch) }); }
