import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { runStoredRequest, variablesInputSchema } from "@/app/api/_lib/connectors";
import { migrateProjectDefinition } from "@/domain/project";

const bodySchema = z.object({ requestId: z.string().min(1), variables: variablesInputSchema });

/**
 * Fires a connector request for the project and answers with the values it would set, without saving them:
 * the page shows them next to the current values and the user decides. `{{name}}` in the request resolves from the
 * project's variables, overridden by `variables` from the body (for example the service date).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const project = await prisma.project.findUnique({ where: { id }, select: { definition: true } });
  if (!project) return jsonError("Project not found", 404);
  const stored = Object.fromEntries((migrateProjectDefinition(project.definition).variables ?? []).map((variable) => [variable.key, variable.value]));
  const outcome = await runStoredRequest(parsed.data.requestId, { ...stored, ...parsed.data.variables });
  if (outcome.error) return outcome.error;
  return NextResponse.json({ ok: true, status: outcome.status, values: outcome.values });
}
