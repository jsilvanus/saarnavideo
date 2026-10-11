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
  /** Timeline colour (#rrggbb). Nested sections without one take their parent's colour. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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

/** Colours handed out to top-level sections in order; nested sections inherit their parent's colour. */
export const SECTION_PALETTE = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

/** The colour a section is drawn in: its own, its parent's, or the palette entry for its top-level position. */
export function sectionColor(sections: Section[], section: Section): string {
  if (section.color) return section.color;
  if (section.parentId) {
    const parent = sections.find(candidate => candidate.id === section.parentId);
    if (parent) return sectionColor(sections, parent);
  }
  const roots = sections.filter(candidate => candidate.scope === section.scope && !candidate.parentId);
  const index = Math.max(0, roots.findIndex(candidate => candidate.id === section.id));
  return SECTION_PALETTE[index % SECTION_PALETTE.length];
}

export function getRootSections(sections: Section[], scope: SectionScope): Section[] {
  return sections.filter(section => section.scope === scope && !section.parentId);
}

export function getChildSections(sections: Section[], parentId: string): Section[] {
  return sections.filter(section => section.parentId === parentId);
}
