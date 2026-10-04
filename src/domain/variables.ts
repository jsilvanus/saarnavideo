import { z } from "zod";

/**
 * Project variables: user-defined name/value pairs (e.g. `saarnaaja`, `pyhäpäivä`) that graphics refer to as `{{name}}`.
 * Nothing about the service (preacher, Gospel reference, ...) is hard-coded; a project defines the names it needs.
 */
export const VARIABLE_KEY_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;

export const projectVariableSchema = z.object({
  key: z.string().regex(VARIABLE_KEY_PATTERN, "Use letters, digits, - or _ (max 40)"),
  value: z.string().max(500),
});

export const projectVariablesSchema = z.array(projectVariableSchema).max(100).superRefine((variables, ctx) => {
  const seen = new Set<string>();
  variables.forEach((variable, index) => {
    if (seen.has(variable.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "key"], message: `Duplicate variable "${variable.key}"` });
    seen.add(variable.key);
  });
});

export type ProjectVariable = z.infer<typeof projectVariableSchema>;

const TOKEN = /\{\{\s*([\p{L}\p{N}_-]{1,40})\s*\}\}/gu;

/** Replaces `{{name}}` with the variable's value. Unknown names stay as written so a missing value is visible, not silently blank. */
export function applyVariables(text: string, variables: readonly ProjectVariable[] | undefined): string {
  if (!variables?.length || !text.includes("{{")) return text;
  const values = new Map(variables.map((variable) => [variable.key, variable.value]));
  return text.replace(TOKEN, (match, key: string) => (values.has(key) ? values.get(key)! : match));
}

/** Variable names a text refers to, in order of first use. */
export function variableNames(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(TOKEN), (match) => match[1]))];
}
