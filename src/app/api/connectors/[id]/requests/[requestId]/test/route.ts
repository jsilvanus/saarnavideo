import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/app/api/_lib/http";
import { runStoredRequest, variablesInputSchema } from "@/app/api/_lib/connectors";

const bodySchema = z.object({ variables: variablesInputSchema });

/** Fires the request once with the given `{{variable}}` values and shows what it would fill in. Nothing is saved. */
export async function POST(request: Request, context: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const outcome = await runStoredRequest(requestId, parsed.data.variables, id);
  if (outcome.error) return outcome.error;
  return NextResponse.json({ ok: true, status: outcome.status, values: outcome.values });
}
