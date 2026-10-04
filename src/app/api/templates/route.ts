import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSafe } from "@/app/api/_lib/http";
import { migrateProjectDefinition } from "@/domain/project";
import { captureTemplate, savedTemplateSchema } from "@/domain/saved-templates";
import { getTemplateRegistry } from "@/domain/templates";

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

/** Built-in templates (by `key`) followed by the ones saved from projects (by `id`). */
export async function GET() {
  const builtin = getTemplateRegistry().listTemplates().map((template) => ({
    kind: "builtin" as const, key: template.key, name: template.name, description: template.description ?? "", sections: template.sections,
    presetKey: template.output.presetKey, targetSeconds: template.output.targetSeconds ?? null,
  }));
  const rows = await prisma.userTemplate.findMany({ orderBy: { name: "asc" } });
  const saved = rows.map((row) => {
    const parsed = savedTemplateSchema.safeParse(row.definition);
    return { kind: "saved" as const, id: row.id, name: row.name, description: row.description ?? "", sections: parsed.success ? parsed.data.sections : [], presetKey: parsed.success ? parsed.data.definition.template?.presetKey ?? null : null, targetSeconds: parsed.success ? parsed.data.definition.template?.targetSeconds ?? null : null };
  });
  return NextResponse.json({ templates: [...builtin, ...saved] });
}

/** Saves a project's structure (output size, graphics, variable names, slates, section rules; no sources or clips) as a template. */
export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, include: { sources: { select: { id: true }, take: 1 } } });
    if (!project) return jsonError("Project not found", 404);
    if (await prisma.userTemplate.findUnique({ where: { name: input.name } })) return jsonError(`A template named "${input.name}" already exists`, 409);
    const saved = captureTemplate(migrateProjectDefinition(project.definition, project.sources[0]?.id));
    const row = await prisma.userTemplate.create({ data: { name: input.name, description: input.description || null, definition: saved } });
    return NextResponse.json(jsonSafe({ id: row.id, name: row.name, description: row.description ?? "", sections: saved.sections }), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError(error.issues[0]?.message ?? "Invalid request", 400);
    console.error(error);
    return jsonError("Unable to save the template", 500);
  }
}
