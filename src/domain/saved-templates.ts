import { z } from "zod";
import { projectDefinitionSchema, type ProjectDefinition, type TimelineItem } from "@/domain/project";
import { getRootSections } from "@/domain/sections";
import { VARIABLE_DEFAULTS, type TemplateContext } from "@/domain/templates";

/**
 * A template saved from a project: the project's look and structure without its content. Applying it to a new project
 * gives the same output size, graphics, variables, opening/ending slates and section rules, but no sources or clips.
 */
export const savedTemplateSchema = z.object({
  version: z.literal(1),
  /** Section names of the project the template was saved from (offered as a list in the Structure step). */
  sections: z.array(z.string().min(1)).default([]),
  definition: projectDefinitionSchema,
});

export type SavedTemplate = z.infer<typeof savedTemplateSchema>;

/**
 * Strips a project down to a reusable template. Kept: output settings, graphics, variable names (values cleared),
 * podcast settings, standalone slates, and one rule per section overlay (the graphic and how long it stays).
 * Dropped: sources, sections with their ranges, clips, transcripts' timing, overlays and voiceovers that sit at a time position.
 */
export function captureTemplate(definition: ProjectDefinition): SavedTemplate {
  const items = definition.composition.items;
  const sectionLabel = new Map(definition.sections.map((section) => [section.id, section.label]));
  const rules = new Map<string, { section: string; graphicId: string; durationSeconds: number }>();
  for (const rule of definition.template?.sectionOverlays ?? []) rules.set(rule.section.toLowerCase(), rule);
  for (const item of items) {
    if (item.type !== "overlay" || !item.sectionId || !item.graphicId) continue;
    const label = sectionLabel.get(item.sectionId);
    if (label && !rules.has(label.toLowerCase())) rules.set(label.toLowerCase(), { section: label, graphicId: item.graphicId, durationSeconds: Math.max(0.1, item.endSeconds - item.startSeconds) });
  }
  const kept = items.filter((item) => item.type === "slate" && item.mode !== "overlay" || item.type === "audio-clip" && item.mode !== "mix");
  // A standalone slate after the last clip is the ending slate; new sections will go in front of it.
  const lastItem = items[items.length - 1];
  const closesVideo = items.some((item) => item.type === "source-clip") && lastItem?.type === "slate" && lastItem.mode !== "overlay";
  const endingGraphicId = closesVideo ? lastItem.graphicId : definition.template?.endingGraphicId;
  const names = getRootSections(definition.sections, "SOURCE").map((section) => section.label);
  const sectionNames = names.length ? names : definition.template?.sectionNames ?? [];
  return savedTemplateSchema.parse({
    version: 1,
    sections: sectionNames,
    definition: {
      ...definition,
      semanticSegments: [],
      sections: [],
      variables: (definition.variables ?? []).map((variable) => ({ key: variable.key, value: "" })),
      template: definition.template && { ...definition.template, endingGraphicId, sectionOverlays: [...rules.values()], sectionNames: sectionNames.length ? sectionNames : undefined },
      composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: kept },
    },
  });
}

/** A copy of the saved definition with fresh graphic ids, variables filled in from the new project's facts. */
export function applySavedTemplate(saved: SavedTemplate, context: TemplateContext = {}): ProjectDefinition {
  const newId = context.newId ?? (() => crypto.randomUUID());
  const ids = new Map(saved.definition.graphics.map((graphic) => [graphic.id, newId()]));
  const remap = (id: string | undefined) => (id ? ids.get(id) ?? id : undefined);
  const definition = saved.definition;
  const items = definition.composition.items.map((item): TimelineItem => (item.type === "slate" || item.type === "audio-clip" || item.type === "overlay") && item.graphicId ? { ...item, graphicId: remap(item.graphicId) } : item);
  return projectDefinitionSchema.parse({
    ...definition,
    graphics: definition.graphics.map((graphic) => ({ ...graphic, id: ids.get(graphic.id)! })),
    variables: (definition.variables ?? []).map((variable) => ({ key: variable.key, value: VARIABLE_DEFAULTS[variable.key]?.(context) ?? "" })),
    template: definition.template && {
      ...definition.template,
      endingGraphicId: remap(definition.template.endingGraphicId),
      sectionOverlays: definition.template.sectionOverlays?.map((rule) => ({ ...rule, graphicId: remap(rule.graphicId)! })),
    },
    composition: { ...definition.composition, items },
  });
}
