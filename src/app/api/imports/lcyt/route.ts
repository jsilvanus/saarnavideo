import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/app/api/_lib/http";
import { ImportRequestError, loadManifest, startLcytImport } from "@/lib/lcyt-import";

const requestSchema = z.object({
  manifestUrl: z.string().url().optional(),
  manifest: z.unknown().optional(),
  templateKey: z.string().min(1).optional(),
  userTemplateId: z.string().min(1).optional(),
  defaultFeed: z.enum(["clean", "program"]).optional(),
});

/**
 * LCYT hands over a finished broadcast: `{ manifestUrl }` (a signed link to the handoff manifest) or an inline `manifest`.
 * Answers 202 with the import and project ids while the IMPORT job fetches the recordings; the same broadcast delivered
 * again answers 200 with the existing import (a failed one is queued again).
 */
export async function POST(request: Request) {
  try {
    const input = requestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return jsonError("Send JSON with manifestUrl (or manifest)", 400);
    const { manifestUrl, manifest, templateKey, userTemplateId, defaultFeed } = input.data;
    if (!manifestUrl && manifest === undefined) return jsonError("manifestUrl or manifest is required", 400);
    const parsed = await loadManifest({ manifestUrl, manifest });
    const started = await startLcytImport(parsed, { templateKey, userTemplateId, defaultFeed });
    return NextResponse.json(started, { status: started.created ? 202 : 200 });
  } catch (error) {
    if (error instanceof ImportRequestError) return jsonError(error.message, error.status);
    console.error("LCYT import error:", error instanceof Error ? error.message : error);
    return jsonError("Could not start the import", 500);
  }
}
