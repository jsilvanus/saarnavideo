import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    mediaRoot: string;
    fixturesDir: string;
    /** Base URL of a running liturgos-auditor-stt service (AUDITOR_STT_URL), or "" when none is configured. */
    auditorSttUrl: string;
  }
}

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "node_modules", ".bin");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** Solid-colour test clips with a tone, like a real recording (the renderer expects an audio stream). */
function makeFixtures(dir: string) {
  for (const [name, color, frequency] of [["green", "green", 440], ["red", "red", 660]] as const) {
    ffmpeg(["-f", "lavfi", "-i", `color=c=${color}:s=640x360:r=30:d=5`, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=5`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, `${name}.mp4`)]);
  }
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=200x200", "-frames:v", "1", path.join(dir, "blue.png")]);
}

async function waitForServer(url: string, server: ChildProcess, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

function start(command: string, args: string[], env: NodeJS.ProcessEnv, name: string) {
  const child = spawn(command, args, { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = (chunk: Buffer) => {
    if (process.env.E2E_VERBOSE) process.stderr.write(`[${name}] ${chunk}`);
  };
  child.stdout?.on("data", log);
  child.stderr?.on("data", log);
  return child;
}

function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

export default async function setup(project: TestProject) {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try {
      execFileSync(tool, ["-version"], { stdio: "ignore" });
    } catch {
      throw new Error(`${tool} is required for the e2e tests`);
    }
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "saarnavideo-e2e-"));
  const mediaRoot = path.join(workDir, "media");
  const fixturesDir = path.join(workDir, "fixtures");
  await Promise.all([mkdir(mediaRoot, { recursive: true }), mkdir(fixturesDir, { recursive: true })]);
  makeFixtures(fixturesDir);

  const port = await freePort();
  const distDir = `.next-e2e-${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${path.join(workDir, "e2e.db")}`,
    MEDIA_ROOT: mediaRoot,
    WORKER_POLL_MS: "500",
    NEXT_TELEMETRY_DISABLED: "1",
    // Own build directory: another `next dev` in the same checkout would otherwise share .next and break both.
    NEXT_DIST_DIR: distDir,
  };
  // The worker's TRANSCRIBE jobs talk to the STT service named here; without it the transcription e2e skips itself.
  const auditorSttUrl = process.env.AUDITOR_STT_URL?.trim() ?? "";
  if (auditorSttUrl) env.AUDITOR_STT_URL = auditorSttUrl;
  execFileSync(path.join(BIN, "prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: ROOT, env, stdio: "ignore" });

  const server = start(path.join(BIN, "next"), ["dev", "--port", String(port)], env, "next");
  const worker = start(path.join(BIN, "tsx"), ["src/worker/index.ts"], env, "worker");
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${baseUrl}/api/projects`, server);
  } catch (error) {
    stop(server);
    stop(worker);
    throw error;
  }

  project.provide("baseUrl", baseUrl);
  project.provide("mediaRoot", mediaRoot);
  project.provide("fixturesDir", fixturesDir);
  project.provide("auditorSttUrl", auditorSttUrl);

  return async () => {
    stop(server);
    stop(worker);
    if (!process.env.E2E_KEEP) await rm(workDir, { recursive: true, force: true });
    await rm(path.join(ROOT, distDir), { recursive: true, force: true });
  };
}
