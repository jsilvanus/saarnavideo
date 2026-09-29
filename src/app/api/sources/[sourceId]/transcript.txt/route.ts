import { transcriptDownload } from "@/app/api/_lib/transcript";

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  return transcriptDownload(request, sourceId, "txt");
}
