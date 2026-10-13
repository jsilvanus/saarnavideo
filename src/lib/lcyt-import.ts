import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createProjectDefinition, type ProjectDefinition } from "@/domain/project";
import { applySavedTemplate, savedTemplateSchema } from "@/domain/saved-templates";
import { applyTemplateByKey } from "@/domain/templates";
import { lcytManifestSchema, manifestExternalId, type LcytManifest } from "@/domain/lcyt-manifest";
import { fetchJson, ImportFetchError, type FetchOptions } from "@/lib/import-fetch";

export const IMPORT_SYSTEM = "lcyt";

export class ImportRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The manifest to import: sent inline, or fetched from `manifestUrl` (LCYT sends a signed link). */
export async function loadManifest(input: { manifestUrl?: string; manifest?: unknown }, options: FetchOptions = {}): Promise<LcytManifest> {
  let raw: unknown = input.manifest;
  if (raw === undefined) {
    if (!input.manifestUrl) throw new ImportRequestError("manifestUrl or manifest is required", 400);
    try {
      raw = await fetchJson(input.manifestUrl, "manifest", 5 * 1024 * 1024, options);
    } catch (error) {
      if (error instanceof ImportFetchError) throw new ImportRequestError(`Could not fetch the manifest: ${error.message}`, 502);
      throw error;
    }
  }
  const parsed = lcytManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ImportRequestError(`Invalid manifest: ${issue?.path.join(".") || "manifest"}: ${issue?.message ?? "invalid"}`, 422);
  }
  return parsed.data;
}

/** Definition of the new project: the chosen template (built-in key or saved id), or an empty project when there is none. */
async function baseDefinition(manifest: LcytManifest, choice: { templateKey?: string; userTemplateId?: string }): Promise<{ definition: ProjectDefinition; templateKey: string }> {
  const context = { title: manifest.title };
  if (choice.userTemplateId) {
    const row = await prisma.userTemplate.findUnique({ where: { id: choice.userTemplateId } });
    if (!row) throw new ImportRequestError("Template not found", 404);
    return { definition: applySavedTemplate(savedTemplateSchema.parse(row.definition), context), templateKey: "saved" };
  }
  const key = choice.templateKey ?? process.env.LCYT_IMPORT_TEMPLATE ?? "basic";
  const templated = applyTemplateByKey(key, context);
  if (templated) return { definition: templated, templateKey: key };
  if (choice.templateKey && key !== "basic") throw new ImportRequestError(`Unknown template: ${key}`, 400);
  const first = manifest.feeds.find((feed) => !feed.aliasOf);
  const even = (value: number | undefined, fallback: number) => (value && value >= 128 && value <= 7680 ? Math.round(value / 2) * 2 : fallback);
  return {
    templateKey: "basic",
    definition: createProjectDefinition({
      template: { key: "basic", width: even(first?.width, 1920), height: even(first?.height, 1080), fps: 30, backgroundColor: "black", textColor: "white" },
      semanticSegments: [],
      composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] },
    }),
  };
}

export type StartedImport = { importId: string; projectId: string | null; status: string; created: boolean };

/**
 * Registers an import and queues its job. One broadcast makes one project: delivering the same manifest again returns the
 * existing import, and only a FAILED one is queued again (it resumes, keeping what already arrived).
 */
export async function startLcytImport(manifest: LcytManifest, options: { templateKey?: string; userTemplateId?: string; defaultFeed?: "clean" | "program" } = {}): Promise<StartedImport> {
  const externalId = manifestExternalId(manifest);
  const key = { system_externalId: { system: IMPORT_SYSTEM, externalId } };
  const existing = await prisma.import.findUnique({ where: key });
  if (existing) {
    if (existing.status !== "FAILED") return { importId: existing.id, projectId: existing.projectId, status: existing.status, created: false };
    return requeue(existing.id, existing.projectId!, manifest, options.defaultFeed);
  }
  const { definition, templateKey } = await baseDefinition(manifest, options);
  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data: { title: manifest.title.trim().slice(0, 200) || "Broadcast", templateKey, definition: definition as object } });
      const record = await tx.import.create({ data: { system: IMPORT_SYSTEM, externalId, status: "PENDING", projectId: project.id, manifest: manifest as object } });
      await tx.mediaJob.create({ data: { projectId: project.id, type: "IMPORT", status: "QUEUED", phase: "QUEUED", message: "Waiting to fetch the recording", parameters: { importId: record.id, defaultFeed: options.defaultFeed ?? null } } });
      return { importId: record.id, projectId: project.id, status: "PENDING", created: true };
    });
  } catch (error) {
    // Two deliveries at once: the other one won the unique (system, externalId).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.import.findUniqueOrThrow({ where: key });
      return { importId: winner.id, projectId: winner.projectId, status: winner.status, created: false };
    }
    throw error;
  }
}

/** Queues another IMPORT job for a failed import, with the (possibly fresher) manifest. */
export async function requeue(importId: string, projectId: string, manifest: LcytManifest | null, defaultFeed?: "clean" | "program"): Promise<StartedImport> {
  await prisma.import.update({ where: { id: importId }, data: { status: "PENDING", error: null, ...(manifest ? { manifest: manifest as object } : {}) } });
  await prisma.mediaJob.create({ data: { projectId, type: "IMPORT", status: "QUEUED", phase: "QUEUED", message: "Waiting to fetch the recording", parameters: { importId, defaultFeed: defaultFeed ?? null } } });
  return { importId, projectId, status: "PENDING", created: false };
}

/** What an import looks like to API clients: no stored manifest (it carries download links). */
export function serializeImport(record: { id: string; system: string; externalId: string; status: string; projectId: string | null; summary: unknown; error: string | null; createdAt: Date; updatedAt: Date }, options: { events?: boolean } = {}) {
  const summary = (record.summary ?? null) as (Record<string, unknown> & { dskEvents?: unknown[] }) | null;
  const { dskEvents, ...rest } = summary ?? {};
  return {
    id: record.id, system: record.system, externalId: record.externalId, status: record.status, projectId: record.projectId, error: record.error, createdAt: record.createdAt, updatedAt: record.updatedAt,
    summary: summary ? { ...rest, ...(options.events ? { dskEvents } : {}) } : null,
  };
}
