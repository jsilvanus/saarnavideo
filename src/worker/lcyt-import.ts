import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaStore } from "@/lib/media-store";
import { parseVtt } from "@/lib/captions";
import { createTranscriptionRun } from "@/lib/transcriptionRuns";
import { downloadToFile, fetchJson, fetchText, type FetchOptions } from "@/lib/import-fetch";
import { feedOffsetMs, fileFeeds, lcytManifestSchema, manifestVariables, type LcytManifest, type ManifestFeed } from "@/domain/lcyt-manifest";
import { buildImportedDefinition, chooseMainRole } from "@/domain/lcyt-import";
import { shiftCues } from "@/domain/feed-group";
import { VARIABLE_KEY_PATTERN } from "@/domain/variables";
import { projectDefinitionSchema, type ProjectDefinition } from "@/domain/project";
import type { JobFiles } from "@/worker/media-io";
import { buildJoinArgs, gapColorFor, probeVideo, runFfmpegJoin, type JoinInput } from "@/worker/lcyt-feed";

export type ImportDeps = {
  /** Job files for the run (scratch directory, S3 upload). */
  files: JobFiles;
  mediaRoot: string;
  maxFileBytes: number;
  log(level: "INFO" | "WARN" | "ERROR", message: string): Promise<void>;
  progress(percent: number, message: string): Promise<void>;
  fetchOptions?: FetchOptions;
};

const ROLE = { clean: "CLEAN", program: "PROGRAM", dsk: "DSK" } as const;
const MAX_DSK_EVENTS = 5000;

type Summary = { notices: string[]; mainRole?: string; sources?: Record<string, string>; captionLanguages?: string[]; dskEvents?: unknown[]; dskEventCount?: number; skippedVariables?: string[] };

/** Downloads every part of a feed and joins them into the single file stored as the source. Returns the stored reference and what ffprobe found. */
async function fetchFeed(feed: ManifestFeed, importId: string, projectId: string, deps: ImportDeps, report: (fraction: number) => void) {
  const store = await getMediaStore();
  const parts = [...(feed.parts ?? [])].sort((a, b) => a.startMs - b.startMs);
  const work = path.join(deps.files.scratchDir, `import-${importId}-${feed.role}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const name = `lcyt-${importId}-${feed.role}.mp4`;
  const finalPath = store.mode === "local" ? path.join(deps.mediaRoot, "sources", projectId, name) : path.join(work, name);
  await mkdir(path.dirname(finalPath), { recursive: true });
  try {
    const downloaded: JoinInput[] = [];
    for (const [index, part] of parts.entries()) {
      const file = path.join(work, `part-${index + 1}.mp4`);
      await downloadToFile(part.ref, file, { ...deps.fetchOptions, maxBytes: deps.maxFileBytes, onProgress: (bytes, total) => report((index + (total ? bytes / total : 0)) / parts.length) });
      const probe = await probeVideo(file).catch((error) => { throw new Error(`${feed.role} part ${index + 1} is not a readable video: ${error instanceof Error ? error.message : "probe failed"}`); });
      downloaded.push({ file, part, hasAudio: probe.hasAudio });
    }
    let probe;
    if (downloaded.length === 1) {
      const { rename, copyFile } = await import("node:fs/promises");
      await rename(downloaded[0].file, finalPath).catch(async () => { await copyFile(downloaded[0].file, finalPath); });
      probe = await probeVideo(finalPath);
    } else {
      const first = await probeVideo(downloaded[0].file);
      await runFfmpegJoin(buildJoinArgs(downloaded, { width: first.width, height: first.height, fps: Math.round(first.fps) || 25 }, gapColorFor(feed.role, feed.key), finalPath));
      probe = await probeVideo(finalPath);
    }
    const size = (await stat(finalPath)).size;
    const storagePath = await deps.files.finalize(finalPath, `sources/${projectId}/${name}`, "video/mp4");
    return { storagePath, size, probe, parts: parts.length };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Key settings kept with a DSK source: the colour LCYT keyed on air, or "has alpha". */
function keyParamsOf(feed: ManifestFeed) {
  if (feed.role !== "dsk") return undefined;
  if (feed.hasAlpha) return { hasAlpha: true };
  return { hasAlpha: false, color: feed.key?.color ?? "#00B140", similarity: feed.key?.similarity ?? 0.3, blend: feed.key?.blend ?? 0.1 };
}

/**
 * IMPORT job: fetches the feeds of an LCYT manifest into sources of the project, imports the captions as transcript runs
 * (moved onto each file's own time), fills in the project's variables and sections, and keeps the DSK event log. Safe to
 * run again after a failure: sources and caption runs that already exist are kept.
 */
export async function runLcytImport(importId: string, deps: ImportDeps): Promise<void> {
  const record = await prisma.import.findUnique({ where: { id: importId } });
  if (!record) throw new Error("Import not found");
  if (!record.projectId) throw new Error("Import has no project");
  const parsed = lcytManifestSchema.safeParse(record.manifest);
  if (!parsed.success) throw new Error(`The stored manifest is no longer valid; deliver it again from LCYT (${parsed.error.issues[0]?.path.join(".") || "manifest"}: ${parsed.error.issues[0]?.message ?? "invalid"})`);
  const manifest: LcytManifest = parsed.data;
  const projectId = record.projectId;
  const summary: Summary = { notices: [] };
  const job = await prisma.mediaJob.findFirst({ where: { projectId, type: "IMPORT" }, orderBy: { createdAt: "desc" } });
  const preferred = (job?.parameters as { defaultFeed?: "clean" | "program" } | null)?.defaultFeed ?? null;
  await prisma.import.update({ where: { id: importId }, data: { status: "DOWNLOADING", error: null } });

  const feeds = fileFeeds(manifest);
  const existing = await prisma.source.findMany({ where: { feedGroupId: importId, projects: { some: { id: projectId } } } });
  const sourceByRole = new Map<string, (typeof existing)[number]>(existing.map((source) => [source.feedRole!, source]));

  for (const [index, feed] of feeds.entries()) {
    const role = ROLE[feed.role];
    if (sourceByRole.has(role)) continue;
    await deps.log("INFO", `Fetching the ${feed.role} recording (${feed.parts!.length} part${feed.parts!.length === 1 ? "" : "s"})`);
    const fetched = await fetchFeed(feed, importId, projectId, deps, (fraction) => void deps.progress(Math.round(((index + fraction) / feeds.length) * 80), `Fetching ${feed.role}`));
    const created = await prisma.source.create({
      data: {
        type: "UPLOAD", status: "AVAILABLE", originalName: `${manifest.title.slice(0, 80) || "Recording"} (${feed.role}).mp4`.replace(/[\\/]/g, "-"),
        storagePath: fetched.storagePath, mimeType: "video/mp4", sizeBytes: BigInt(fetched.size), durationMs: fetched.probe.durationMs, referenceDurationMs: Math.round(feed.durationMs ?? fetched.probe.durationMs),
        feedRole: role, feedGroupId: importId, syncOffsetMs: feedOffsetMs(feed),
        origin: { system: "lcyt", instance: manifest.origin.instance ?? null, broadcastId: manifest.origin.broadcastId ?? null, videoId: manifest.origin.videoId ?? null, groupId: manifest.origin.groupId ?? null, manifestVersion: manifest.version },
        keyParams: keyParamsOf(feed),
        projects: { connect: { id: projectId } },
      },
    });
    sourceByRole.set(role, created);
    await deps.log("INFO", `Stored the ${feed.role} recording (${fetched.probe.width}x${fetched.probe.height}, ${(fetched.probe.durationMs / 1000).toFixed(1)} s)`);
  }

  const aliases = manifest.feeds.filter((feed) => feed.aliasOf);
  for (const alias of aliases) summary.notices.push(`${alias.role} is the same picture as ${alias.aliasOf} (no graphics were composited on air)`);
  if (!sourceByRole.has("DSK")) summary.notices.push("No separate graphics recording was delivered");
  summary.sources = Object.fromEntries([...sourceByRole].map(([role, source]) => [role.toLowerCase(), source.id]));

  // Captions: one transcript run per language on every picture feed, each moved onto that file's own time.
  await deps.progress(82, "Importing captions");
  const languages: string[] = [];
  for (const caption of manifest.captions) {
    try {
      const text = await fetchText(caption.ref, `captions (${caption.language})`, 20 * 1024 * 1024, deps.fetchOptions);
      const cues = parseVtt(text);
      if (!cues.length) { summary.notices.push(`The ${caption.language} captions had no cues`); continue; }
      for (const source of [...sourceByRole.values()].filter((candidate) => candidate.feedRole !== "DSK")) {
        const already = await prisma.transcriptionRun.findFirst({ where: { sourceId: source.id, language: caption.language, origin: "UPLOAD" } });
        if (already) continue;
        const shifted = shiftCues(cues, source.syncOffsetMs ?? 0);
        if (!shifted.length) continue;
        const durationSeconds = source.durationMs != null ? source.durationMs / 1000 : Math.max(...shifted.map((cue) => cue.endSeconds));
        await createTranscriptionRun({ sourceId: source.id, origin: "UPLOAD", language: caption.language, rangeStartSeconds: 0, rangeEndSeconds: Math.max(durationSeconds, ...shifted.map((cue) => cue.endSeconds)), segments: shifted });
      }
      languages.push(caption.language);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreadable";
      await deps.log("WARN", `Captions (${caption.language}) were not imported: ${message}`);
      summary.notices.push(`Captions (${caption.language}) could not be imported: ${message}`);
    }
  }
  summary.captionLanguages = languages;

  // The graphics change log is kept with the import (the editor shows it; mapping it to graphics comes later).
  if (manifest.dskEvents?.ref) {
    try {
      const raw = (await fetchJson(manifest.dskEvents.ref, "DSK event log", 5 * 1024 * 1024, deps.fetchOptions)) as { events?: unknown[] };
      const events = Array.isArray(raw?.events) ? raw.events : [];
      summary.dskEventCount = events.length;
      summary.dskEvents = events.slice(0, MAX_DSK_EVENTS);
      if (events.length > MAX_DSK_EVENTS) summary.notices.push(`Only the first ${MAX_DSK_EVENTS} of ${events.length} graphics changes are kept`);
    } catch (error) {
      await deps.log("WARN", `The DSK event log was not imported: ${error instanceof Error ? error.message : "unreadable"}`);
      summary.notices.push("The graphics event log could not be imported");
    }
  }

  // The project: working source, sections, variables.
  await deps.progress(92, "Preparing the project");
  const mainRole = chooseMainRole(manifest, preferred);
  const main = sourceByRole.get(ROLE[mainRole]) ?? sourceByRole.get("CLEAN");
  if (!main?.durationMs) throw new Error("No usable recording was delivered");
  summary.mainRole = main.feedRole!.toLowerCase();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const base = projectDefinitionSchema.parse(project.definition);
  if (!base.composition.items.some((item) => item.type === "source-clip" && item.sourceId === main.id)) {
    const { variables, skipped } = manifestVariables(manifest, (key) => VARIABLE_KEY_PATTERN.test(key));
    summary.skippedVariables = skipped;
    if (skipped.length) summary.notices.push(`Variables skipped because their names are not allowed: ${skipped.join(", ")}`);
    const definition: ProjectDefinition = buildImportedDefinition(base, { manifest, sourceId: main.id, offsetMs: main.syncOffsetMs ?? 0, durationSeconds: main.durationMs / 1000, variables });
    await prisma.project.update({ where: { id: projectId }, data: { definition: definition as object } });
  }
  await prisma.import.update({ where: { id: importId }, data: { status: "READY", manifest: Prisma.DbNull, summary: summary as object, error: null } });
  await deps.progress(100, "Import complete");
  await deps.log("INFO", `Import complete; the working source is the ${summary.mainRole} recording`);
}

/**
 * Marks imports whose job is gone (its worker stopped, or the job was cancelled) as failed, so the user can retry them
 * instead of watching a download that is not running.
 */
export async function reconcileImports(): Promise<number> {
  const open = await prisma.import.findMany({ where: { status: { in: ["PENDING", "DOWNLOADING"] }, projectId: { not: null } }, select: { id: true, projectId: true } });
  let failed = 0;
  for (const record of open) {
    const jobs = await prisma.mediaJob.findMany({ where: { projectId: record.projectId!, type: "IMPORT" }, select: { status: true, parameters: true } });
    const active = jobs.some((job) => (job.status === "QUEUED" || job.status === "RUNNING") && (job.parameters as { importId?: string } | null)?.importId === record.id);
    if (active) continue;
    await prisma.import.updateMany({ where: { id: record.id, status: { in: ["PENDING", "DOWNLOADING"] } }, data: { status: "FAILED", error: "The import stopped before it finished (the worker stopped or the job was cancelled)" } });
    failed++;
  }
  return failed;
}
