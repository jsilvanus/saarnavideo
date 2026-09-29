import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/app/api/_lib/http";
import { readFacebookConfig } from "@/integrations/facebook";

// FACEBOOK: PUBLIC publishes on the Page, PRIVATE uploads an unpublished video (visible to Page admins). UNLISTED does not exist there.
const schema = z.object({ platform: z.enum(["YOUTUBE", "FACEBOOK"]).default("YOUTUBE"), privacy: z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]).default("PRIVATE") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const input = parsed.data;
  if (input.platform === "FACEBOOK") {
    if (input.privacy === "UNLISTED") return jsonError("Facebook has no unlisted videos: choose PUBLIC (published) or PRIVATE (unpublished draft).", 400);
    let configured = false;
    try { configured = readFacebookConfig() !== null; } catch { configured = false; }
    if (!configured) return jsonError("Facebook is not configured: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN (see docs/FACEBOOK_SETUP.md).", 409);
  } else {
    const connection = await prisma.youTubeConnection.findUnique({ where: { provider: "youtube" }, select: { id: true } });
    if (!connection) return jsonError("Connect a YouTube account before publishing.", 409);
  }
  const output = await prisma.output.findFirst({ where: { projectId: id, type: "VIDEO", preview: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!output) return jsonError("No retained generated video is available", 404);
  const publication = await prisma.publication.create({ data: { projectId: id, outputId: output.id, provider: input.platform, privacy: input.privacy, status: "QUEUED" } });
  return NextResponse.json(publication, { status: 202 });
}
