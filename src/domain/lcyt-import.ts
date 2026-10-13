import { addSourceSection } from "@/domain/templates";
import type { ProjectDefinition } from "@/domain/project";
import type { LcytManifest, ManifestRole } from "@/domain/lcyt-manifest";
import type { ProjectVariable } from "@/domain/variables";

const MIN_SECTION_SECONDS = 0.5;

/** Which recording becomes the working source: the one asked for when it has a file, else program (as aired), else clean. */
export function chooseMainRole(manifest: LcytManifest, preferred?: ManifestRole | null): ManifestRole {
  const hasFile = (role: ManifestRole) => manifest.feeds.some((feed) => feed.role === role && !feed.aliasOf && (feed.parts?.length ?? 0) > 0);
  if (preferred && preferred !== "dsk" && hasFile(preferred)) return preferred;
  if (hasFile("program")) return "program";
  return "clean";
}

export type ImportedSection = { id: string; label: string; startSeconds: number; endSeconds: number };

/**
 * Sections of the working source: one per cue marker (each runs to the next marker or the end), or a single section for the
 * whole recording when there are none. `offsetMs` is where the working file starts on the clean timeline.
 */
export function importSections(manifest: LcytManifest, offsetMs: number, durationSeconds: number, newId: () => string = () => crypto.randomUUID()): ImportedSection[] {
  const title = manifest.title.trim() || "Recording";
  const starts = manifest.markers
    .filter((marker) => marker.kind === "cue")
    .map((marker) => ({ at: (marker.atMs - offsetMs) / 1000, label: marker.label.trim() || title }))
    .filter((marker) => marker.at >= 0 && marker.at < durationSeconds - MIN_SECTION_SECONDS)
    .sort((a, b) => a.at - b.at);
  const marks: Array<{ at: number; label: string }> = [];
  for (const mark of starts) {
    const last = marks[marks.length - 1];
    if (last && mark.at - last.at < MIN_SECTION_SECONDS) continue;
    marks.push(mark);
  }
  if (!marks.length || marks[0].at >= MIN_SECTION_SECONDS) marks.unshift({ at: 0, label: title });
  return marks.map((mark, index) => ({
    id: newId(),
    label: mark.label,
    startSeconds: Math.round(mark.at * 1000) / 1000,
    endSeconds: Math.round((index + 1 < marks.length ? marks[index + 1].at : durationSeconds) * 1000) / 1000,
  }));
}

/** Variables of the broadcast merged into the template's: a name the manifest sets replaces the template's value. */
export function mergeVariables(existing: readonly ProjectVariable[] | undefined, incoming: readonly ProjectVariable[]): ProjectVariable[] {
  const merged = new Map((existing ?? []).map((variable) => [variable.key, variable]));
  for (const variable of incoming) merged.set(variable.key, variable);
  return [...merged.values()].slice(0, 100);
}

/** The new project's definition once the working source exists: variables, then the sections with their clips (before the template's ending slate). */
export function buildImportedDefinition(base: ProjectDefinition, input: { manifest: LcytManifest; sourceId: string; offsetMs: number; durationSeconds: number; variables: ProjectVariable[]; newId?: () => string }): ProjectDefinition {
  let definition: ProjectDefinition = { ...base, variables: mergeVariables(base.variables, input.variables) };
  for (const section of importSections(input.manifest, input.offsetMs, input.durationSeconds, input.newId)) {
    definition = addSourceSection(definition, { ...section, sourceId: input.sourceId });
  }
  return definition;
}
