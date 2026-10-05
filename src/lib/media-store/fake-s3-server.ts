import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A tiny path-style S3 server (PUT, GET with Range, HEAD, DELETE) for tests of the AWS client. */
export async function startFakeS3(): Promise<{ url: string; objects: Map<string, Buffer>; close(): Promise<void> }> {
  const objects = new Map<string, Buffer>();
  const server: Server = createServer((request, response) => {
    const key = decodeURIComponent((request.url ?? "").split("?")[0].replace(/^\//, ""));
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => { objects.set(key, Buffer.concat(chunks)); response.writeHead(200, { ETag: '"fake"' }).end(); });
      return;
    }
    const data = objects.get(key);
    if (request.method === "DELETE") { objects.delete(key); response.writeHead(204).end(); return; }
    if (!data) { response.writeHead(404, { "Content-Type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>"); return; }
    if (request.method === "HEAD") { response.writeHead(200, { "Content-Length": data.length }).end(); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      const part = data.subarray(start, end + 1);
      response.writeHead(206, { "Content-Length": part.length, "Content-Range": `bytes ${start}-${end}/${data.length}` }).end(part);
      return;
    }
    response.writeHead(200, { "Content-Length": data.length }).end(data);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, objects, close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
