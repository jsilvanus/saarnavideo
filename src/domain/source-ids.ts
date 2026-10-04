/**
 * A project definition names its sources by id in clips, sections and semantic segments. When a project is duplicated the
 * copy gets its own source rows, so those ids must be translated; ids not in the map stay as they are.
 */
export function remapSourceIds<T>(definition: T, idMap: ReadonlyMap<string, string>): T {
  if (!definition || typeof definition !== "object" || idMap.size === 0) return definition;
  const def = definition as {
    semanticSegments?: Array<Record<string, unknown>>;
    sections?: Array<Record<string, unknown>>;
    composition?: { items?: Array<Record<string, unknown>> } & Record<string, unknown>;
  } & Record<string, unknown>;
  const remap = <Row extends Record<string, unknown>>(row: Row): Row => (typeof row?.sourceId === "string" && idMap.has(row.sourceId) ? { ...row, sourceId: idMap.get(row.sourceId) } : row);
  return {
    ...def,
    ...(Array.isArray(def.semanticSegments) ? { semanticSegments: def.semanticSegments.map(remap) } : {}),
    ...(Array.isArray(def.sections) ? { sections: def.sections.map(remap) } : {}),
    ...(def.composition && Array.isArray(def.composition.items) ? { composition: { ...def.composition, items: def.composition.items.map(remap) } } : {}),
  } as T;
}
