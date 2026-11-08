import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Database-backed unit tests share one SQLite file, and Vitest runs test files in parallel workers, so a test that
 * claims "the next queued job" could take a job another file had just created. Each worker gets its own copy of the
 * pushed database (made once per worker process, before @/lib/prisma is imported). SQLite paths in DATABASE_URL are
 * relative to the prisma/ directory. PostgreSQL URLs are left alone.
 */
const url = process.env.DATABASE_URL ?? "";
const pool = process.env.VITEST_POOL_ID;
const marker = "__saarnavideoTestDb";
if (url.startsWith("file:") && pool && !(globalThis as Record<string, unknown>)[marker]) {
  const [file, query = ""] = url.slice("file:".length).split("?");
  const source = path.resolve("prisma", file);
  if (existsSync(source)) {
    const copy = source.replace(/(\.db)?$/, `-w${pool}.db`);
    copyFileSync(source, copy);
    process.env.DATABASE_URL = `file:./${path.relative(path.resolve("prisma"), copy)}${query ? `?${query}` : ""}`;
  }
  (globalThis as Record<string, unknown>)[marker] = true;
}
