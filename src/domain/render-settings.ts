import { z } from "zod";
import { evenDimension } from "@/domain/output-presets";
import { reframeSchema } from "@/domain/reframe";

const sizeSchema = z.object({ width: evenDimension, height: evenDimension });

/**
 * Checks the parts of a stored project definition that decide the picture size and framing: template size (even, in range),
 * the project default reframe and the reframe of sections and source clips. Returns readable messages; empty = fine.
 * Definitions are saved as the editor sends them (no schema defaults), so this validates only what is present.
 */
export function validateRenderSettings(definition: unknown): string[] {
  const issues: string[] = [];
  if (!definition || typeof definition !== "object") return issues;
  const value = definition as { template?: Record<string, unknown>; sections?: unknown; composition?: { items?: unknown } };
  const template = value.template;
  if (template && (template.width !== undefined || template.height !== undefined)) {
    const size = sizeSchema.safeParse({ width: template.width ?? 1920, height: template.height ?? 1080 });
    if (!size.success) issues.push(`Output size: ${size.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  const check = (label: string, reframe: unknown) => {
    if (reframe === undefined) return;
    const parsed = reframeSchema.safeParse(reframe);
    if (!parsed.success) issues.push(`${label}: ${parsed.error.issues[0]?.message ?? "invalid reframe"}`);
  };
  check("Project reframe", template?.reframe);
  if (Array.isArray(value.sections)) value.sections.forEach((section: { label?: string; reframe?: unknown }) => check(`Section "${section?.label ?? "?"}" reframe`, section?.reframe));
  if (Array.isArray(value.composition?.items)) (value.composition!.items as Array<{ type?: string; reframe?: unknown }>).forEach((item, index) => { if (item?.type === "source-clip") check(`Clip ${index + 1} reframe`, item.reframe); });
  return issues;
}
