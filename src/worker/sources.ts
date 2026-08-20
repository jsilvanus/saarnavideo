import { stat } from "node:fs/promises";
import path from "node:path";
import { migrateProjectDefinition, validateCompositionSources } from "../domain/project";

export type WorkerSource = {
  id: string;
  type: "UPLOAD" | "YOUTUBE";
  storagePath: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
};

export type SourcePathMap = Record<string, string>;

export function resolveRequiredSourceIds(definitionInput: unknown, sources: WorkerSource[]): string[] {
  const fallbackSourceId = sources.length === 1 ? sources[0]?.id : undefined;
  const definition = migrateProjectDefinition(definitionInput, fallbackSourceId);
  validateCompositionSources(definition, sources.map((source) => source.id));
  return Array.from(new Set(definition.composition.items
    .filter((item) => item.type === "source-clip")
    .map((item) => item.sourceId)));
}

export async function acquireRequiredSources(input: {
  projectId: string;
  sources: WorkerSource[];
  requiredSourceIds: string[];
  mediaRoot: string;
  retentionMs: number;
  downloadYouTubeSource: (source: { videoId: string; url: string }, outputPath: string) => Promise<void>;
  updateSource: (sourceId: string, data: { storagePath: string; mimeType: string; sizeBytes: number; expiresAt: Date }) => Promise<void>;
}): Promise<SourcePathMap> {
  const byId = new Map(input.sources.map((source) => [source.id, source]));
  const resolved: SourcePathMap = {};

  for (const sourceId of input.requiredSourceIds) {
    const source = byId.get(sourceId);
    if (!source) throw new Error(`Required source not found: ${sourceId}`);

    if (source.storagePath) {
      resolved[sourceId] = source.storagePath;
      continue;
    }

    if (source.type !== "YOUTUBE" || !source.youtubeUrl || !source.youtubeVideoId) {
      throw new Error(`Source ${sourceId} has no usable media`);
    }

    const directory = path.join(input.mediaRoot, "sources", input.projectId);
    const storagePath = path.join(directory, `${source.youtubeVideoId}.mp4`);
    await input.downloadYouTubeSource({ videoId: source.youtubeVideoId, url: source.youtubeUrl }, storagePath);
    const sizeBytes = (await stat(storagePath)).size;
    await input.updateSource(sourceId, {
      storagePath,
      mimeType: "video/mp4",
      sizeBytes,
      expiresAt: new Date(Date.now() + input.retentionMs),
    });
    resolved[sourceId] = storagePath;
  }

  return resolved;
}
