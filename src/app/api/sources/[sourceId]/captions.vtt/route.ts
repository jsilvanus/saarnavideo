import { captionsDownload } from "@/app/api/_lib/captions";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  return captionsDownload(sourceId, "vtt");
}
