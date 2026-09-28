import { NextResponse } from "next/server";

/** JSON error body shared by every API route: `{ error, ...extra }` with the given status. */
export function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Round-trips a Prisma result through JSON, converting BigInt fields to strings. */
export function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}
