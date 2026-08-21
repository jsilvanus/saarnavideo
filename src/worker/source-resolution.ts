import type { ProjectDefinition } from "@/domain/project";

export type SourceRecord = {
  id: string;
  type: "UPLOAD" | "YOUTUBE";
  storagePath: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
};

export function getReferencedSourceIds(definition: ProjectDefinition): string[] {
  const sourceIds = new Set<string>();
  for (const item of definition.composition.items) {
    if (item.type === "source-clip") {
      sourceIds.add(item.sourceId);
    }
  }
  return [...sourceIds];
}

export function resolveSourcePaths(definition: ProjectDefinition, sources: readonly SourceRecord[]): Map<string, string> {
  const sourceIds = new Set(getReferencedSourceIds(definition));
  const sourcePaths = new Map<string, string>();

  for (const source of sources) {
    if (!sourceIds.has(source.id)) continue;
    if (source.storagePath) {
      sourcePaths.set(source.id, source.storagePath);
    }
  }

  for (const sourceId of sourceIds) {
    if (!sourcePaths.has(sourceId)) {
      throw new Error(`Missing source path for sourceId: ${sourceId}`);
    }
  }

  return sourcePaths;
}

export function appendSource(sources: readonly SourceRecord[], nextSource: SourceRecord): SourceRecord[] {
  return [...sources, nextSource];
}
