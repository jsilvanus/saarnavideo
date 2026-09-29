import path from "node:path";
import { defineConfig } from "vitest/config";

// End-to-end tests: start the real Next.js server and media worker against a
// throwaway SQLite database and media directory, then drive them over HTTP.
// Requires ffmpeg/ffprobe on PATH and a SQLite-generated Prisma client.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
