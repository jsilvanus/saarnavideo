import { fireRequest } from "varfetch";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { fireErrorMessage, networkRulesFromEnv, toVarfetch } from "@/domain/connectors";

export const variablesInputSchema = z.record(z.string().max(100), z.string().max(2000)).default({});

/** True for Prisma's unique-constraint error, so routes answer 409 instead of 500. */
export function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Fires a stored request with the given variables and answers with the mapped values, or an error response. */
export async function runStoredRequest(requestId: string, variables: Record<string, string>, connectorId?: string) {
  const request = await prisma.apiRequest.findUnique({ where: { id: requestId }, include: { connector: true } });
  if (!request || (connectorId && request.connectorId !== connectorId)) return { error: jsonError("Request not found", 404) };
  const { connector, request: definition } = toVarfetch(request.connector, request);
  const result = await fireRequest({ connector, request: definition, variables, network: networkRulesFromEnv() });
  if (!result.ok) return { error: jsonError(fireErrorMessage(result), 502, { status: result.status }) };
  return { values: result.values, status: result.status };
}
