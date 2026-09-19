import { z } from "zod";

export const sectionScopeSchema = z.enum(["SOURCE", "COMPOSITION"]);
export const sectionOriginSchema = z.enum(["MANUAL", "TEMPLATE", "AI"]);

export const sectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  scope: sectionScopeSchema,
  parentId: z.string().min(1).nullable().optional(),
  sourceId: z.string().min(1).optional(),
  sourceSectionId: z.string().min(1).optional(),
  startSeconds: z.number().nonnegative().optional(),
  endSeconds: z.number().positive().optional(),
  origin: sectionOriginSchema.default("MANUAL"),
}).superRefine((section, ctx) => {
  if (section.scope === "SOURCE" && !section.sourceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceId"], message: "Source sections require a sourceId" });
  }
  if (section.startSeconds !== undefined && section.endSeconds === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endSeconds"], message: "A section start requires an end" });
  }
  if (section.endSeconds !== undefined && section.startSeconds === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startSeconds"], message: "A section end requires a start" });
  }
  if (section.startSeconds !== undefined && section.endSeconds !== undefined && section.endSeconds <= section.startSeconds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endSeconds"], message: "Section end must be after start" });
  }
});

export type Section = z.infer<typeof sectionSchema>;
export type SectionScope = z.infer<typeof sectionScopeSchema>;
export type SectionOrigin = z.infer<typeof sectionOriginSchema>;

export function createSectionsFromLines(
  labels: string[],
  scope: SectionScope,
  options: { sourceId?: string; startSeconds?: number; endSeconds?: number; origin?: SectionOrigin } = {},
): Section[] {
  const clean = labels.map(label => label.trim()).filter(Boolean);
  const start = options.startSeconds;
  const end = options.endSeconds;
  const hasRange = start !== undefined && end !== undefined && end > start;
  return clean.map((label, index) => {
    const sectionStart = hasRange ? start! + ((end! - start!) * index) / clean.length : undefined;
    const sectionEnd = hasRange ? start! + ((end! - start!) * (index + 1)) / clean.length : undefined;
    return sectionSchema.parse({
      id: crypto.randomUUID(),
      label,
      scope,
      sourceId: options.sourceId,
      startSeconds: sectionStart,
      endSeconds: sectionEnd,
      origin: options.origin ?? "MANUAL",
    });
  });
}

export function getRootSections(sections: Section[], scope: SectionScope): Section[] {
  return sections.filter(section => section.scope === scope && !section.parentId);
}

export function getChildSections(sections: Section[], parentId: string): Section[] {
  return sections.filter(section => section.parentId === parentId);
}
