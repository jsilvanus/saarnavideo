import { prisma } from "../src/lib/prisma";
import { createMediaStoreFromEnv } from "../src/lib/media-store";
import { migrateMedia, type MigrationDb } from "../src/lib/media-migrate";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const to = args[args.indexOf("--to") + 1];

if (to !== "s3" && to !== "local") {
  console.error("Usage: npm run media:migrate -- --to s3|local [--dry-run] [--delete-old]\n"
    + "  --to s3     copy local files to the bucket (run with MEDIA_STORAGE=s3, MEDIA_S3_BUCKET and AWS_* set)\n"
    + "  --to local  copy S3 files back under MEDIA_ROOT (run with MEDIA_STORAGE=local and the bucket settings set so s3:// files can be read)\n"
    + "  --dry-run   only list what would move\n  --delete-old  remove each old file after its copy is verified and the database points at the new one");
  process.exit(2);
}

process.env.MEDIA_STORAGE = to === "s3" ? "s3" : "local";
const store = await createMediaStoreFromEnv();
const report = await migrateMedia({ db: prisma as unknown as MigrationDb, store, mediaRoot: process.env.MEDIA_ROOT ?? "/data/media", to, dryRun: flag("dry-run"), deleteOld: flag("delete-old"), log: message => console.log(message) });
console.log(JSON.stringify({ ...report, missing: report.missing.length, failed: report.failed.length }, null, 2));
if (report.failed.length) console.error(report.failed.map(item => `${item.ref}: ${item.error}`).join("\n"));
await prisma.$disconnect();
process.exit(report.failed.length ? 1 : 0);
