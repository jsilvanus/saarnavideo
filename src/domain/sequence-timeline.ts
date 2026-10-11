import type { Section } from "@/domain/sections";

/** The shortest sequence the timeline allows, in seconds. */
export const MIN_SEQUENCE_SECONDS = 0.5;

export type TimelineRow = { section: Section; depth: 0 | 1 };

/** Rounds to a tenth of a second, as the timeline stores positions. */
export const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * Rows for one source's positioned sections: each top-level sequence, followed by its nested
 * sequences, ordered by start time. Sections without a position are left out (the Structure
 * list still shows them).
 */
export function timelineRows(sections: Section[], sourceId: string): TimelineRow[] {
  const placed = (section: Section) => section.startSeconds !== undefined && section.endSeconds !== undefined;
  const byStart = (a: Section, b: Section) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0);
  const roots = sections
    .filter(section => section.scope === "SOURCE" && section.sourceId === sourceId && !section.parentId && placed(section))
    .sort(byStart);
  return roots.flatMap(root => [
    { section: root, depth: 0 as const },
    ...sections
      .filter(section => section.parentId === root.id && placed(section))
      .sort(byStart)
      .map(child => ({ section: child, depth: 1 as const })),
  ]);
}

export type RangePatch = { label?: string; startSeconds?: number; endSeconds?: number; color?: string };

export type RangeChange = { sections: Section[] } | { error: "endAfterStart" | "outsideSource" | "nestedTooShort" | "emptyLabel" };

/**
 * Applies a change to one section and returns the new list, or the reason it was refused.
 * Times must stay inside the source. A nested section is clamped into its parent; a parent
 * whose new range would squeeze a nested section below the minimum is refused.
 */
export function applySectionChange(sections: Section[], id: string, patch: RangePatch, durationSeconds: number): RangeChange {
  const target = sections.find(section => section.id === id);
  if (!target) return { sections };
  if (patch.label !== undefined && !patch.label.trim()) return { error: "emptyLabel" };

  const start = patch.startSeconds !== undefined ? tenth(patch.startSeconds) : target.startSeconds ?? 0;
  const end = patch.endSeconds !== undefined ? tenth(patch.endSeconds) : target.endSeconds ?? start;
  const ranged = patch.startSeconds !== undefined || patch.endSeconds !== undefined;
  if (ranged) {
    if (start < 0 || end > durationSeconds) return { error: "outsideSource" };
    if (end - start < MIN_SEQUENCE_SECONDS) return { error: "endAfterStart" };
  }
  const updated: Section = {
    ...target,
    ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(ranged ? { startSeconds: start, endSeconds: end } : {}),
  };

  if (!ranged || target.parentId) {
    if (target.parentId && ranged) {
      const parent = sections.find(section => section.id === target.parentId);
      if (parent?.startSeconds !== undefined && parent.endSeconds !== undefined) {
        if (start < parent.startSeconds || end > parent.endSeconds) return { error: "outsideSource" };
      }
    }
    return { sections: sections.map(section => (section.id === id ? updated : section)) };
  }

  // A top-level sequence moved: its nested sequences must still fit inside it.
  const children = sections.filter(section => section.parentId === id);
  const fitted: Section[] = [];
  for (const child of children) {
    const childStart = Math.max(child.startSeconds ?? start, start);
    const childEnd = Math.min(child.endSeconds ?? end, end);
    if (childEnd - childStart < MIN_SEQUENCE_SECONDS) return { error: "nestedTooShort" };
    fitted.push({ ...child, startSeconds: tenth(childStart), endSeconds: tenth(childEnd) });
  }
  return {
    sections: sections.map(section => {
      if (section.id === id) return updated;
      return fitted.find(child => child.id === section.id) ?? section;
    }),
  };
}

/** The section after (or before) the current one in timeline order, wrapping at the ends. */
export function neighbourRow(rows: TimelineRow[], currentId: string | null, step: 1 | -1): TimelineRow | undefined {
  if (!rows.length) return undefined;
  const index = rows.findIndex(row => row.section.id === currentId);
  if (index < 0) return rows[0];
  return rows[(index + step + rows.length) % rows.length];
}
