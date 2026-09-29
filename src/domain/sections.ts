import { z } from "zod";
import { reframeSchema } from "@/domain/reframe";

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
  /** Crop / fit used for the clips made from this section (a clip can override it). */
  reframe: reframeSchema.optional(),
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

type RangeOptions = { startSeconds?: number; endSeconds?: number };

/**
 * Slice [startSeconds, endSeconds] into `count` equal parts and return part `index`.
 * Returns undefined bounds when the range is missing or empty.
 */
export function evenRangeSlice(index: number, count: number, { startSeconds: start, endSeconds: end }: RangeOptions): RangeOptions {
  if (start === undefined || end === undefined || end <= start) return { startSeconds: undefined, endSeconds: undefined };
  return {
    startSeconds: start + ((end - start) * index) / count,
    endSeconds: start + ((end - start) * (index + 1)) / count,
  };
}

export function createSectionsFromLines(
  labels: string[],
  scope: SectionScope,
  options: { sourceId?: string; origin?: SectionOrigin } & RangeOptions = {},
): Section[] {
  const clean = labels.map(label => label.trim()).filter(Boolean);
  return clean.map((label, index) => sectionSchema.parse({
    id: crypto.randomUUID(),
    label,
    scope,
    sourceId: options.sourceId,
    ...evenRangeSlice(index, clean.length, options),
    origin: options.origin ?? "MANUAL",
  }));
}

export function getRootSections(sections: Section[], scope: SectionScope): Section[] {
  return sections.filter(section => section.scope === scope && !section.parentId);
}

export function getChildSections(sections: Section[], parentId: string): Section[] {
  return sections.filter(section => section.parentId === parentId);
}
