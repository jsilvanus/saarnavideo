import type { Section } from "@/domain/sections";

/** The shortest sequence the timeline allows, in seconds. */
export const MIN_SEQUENCE_SECONDS = 0.5;

/** `depth` is the nesting level: 0 for a top-level sequence, 1 inside it, and so on. */
export type TimelineRow = { section: Section; depth: number };

/** Rounds to a tenth of a second, as the timeline stores positions. */
export const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * Rows for one source's positioned sections: each top-level sequence, followed by its nested
 * sequences at any depth (depth first), ordered by start time among siblings. Sections without a position
 * are left out (`unplacedRows` lists them).
 */
export function timelineRows(sections: Section[], sourceId: string): TimelineRow[] {
  const placed = (section: Section) => section.startSeconds !== undefined && section.endSeconds !== undefined;
  const byStart = (a: Section, b: Section) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0);
  const rows: TimelineRow[] = [];
  const visit = (section: Section, depth: number, seen: Set<string>) => {
    if (seen.has(section.id)) return; // a parent cycle in bad data must not loop
    seen.add(section.id);
    rows.push({ section, depth });
    sections.filter(child => child.parentId === section.id && placed(child)).sort(byStart).forEach(child => visit(child, depth + 1, seen));
  };
  const seen = new Set<string>();
  sections
    .filter(section => section.scope === "SOURCE" && section.sourceId === sourceId && !section.parentId && placed(section))
    .sort(byStart)
    .forEach(root => visit(root, 0, seen));
  return rows;
}

/** Ids of every section below `id`, at any depth. */
export function descendantIds(sections: Section[], id: string): Set<string> {
  const ids = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const section of sections) {
      if (section.parentId && (section.parentId === id || ids.has(section.parentId)) && !ids.has(section.id)) { ids.add(section.id); grew = true; }
    }
  }
  return ids;
}

/** The list without the section and everything nested in it. */
export function removeWithDescendants(sections: Section[], id: string): Section[] {
  const gone = descendantIds(sections, id);
  gone.add(id);
  return sections.filter(section => !gone.has(section.id));
}

/** Nesting level of a section (0 = top level). */
export function sectionDepth(sections: Section[], section: Section): number {
  let depth = 0;
  let parentId = section.parentId;
  while (parentId && depth < 20) {
    const parent = sections.find(candidate => candidate.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

/** Length given to a new sequence when only one edge is known (seconds). */
export const DEFAULT_SEQUENCE_SECONDS = 10;

/**
 * Sections of one source that have no start/end yet (a section typed by name on a source of unknown length, or
 * from a template). `timelineRows` leaves them out because there is nothing to draw; the timeline lists them in a
 * "no range yet" row instead so they never vanish.
 */
export function unplacedRows(sections: Section[], sourceId: string): TimelineRow[] {
  const missing = (section: Section) => section.startSeconds === undefined || section.endSeconds === undefined;
  const mine = sections.filter(section => section.scope === "SOURCE" && section.sourceId === sourceId && missing(section));
  return mine.map(section => ({ section, depth: sectionDepth(sections, section) }));
}

/**
 * The range offered for a new sequence: from the playhead for ten seconds, kept inside the source (when its
 * length is known) and inside the parent sequence, shifted back when the end would pass the limit.
 */
export function defaultNewRange(playhead: number, limits: { durationSeconds?: number; parent?: Pick<Section, "startSeconds" | "endSeconds"> } = {}): { start: number; end: number } {
  const floor = limits.parent?.startSeconds ?? 0;
  const ceiling = Math.min(limits.parent?.endSeconds ?? Infinity, limits.durationSeconds ?? Infinity);
  let start = tenth(Math.max(floor, playhead));
  let end = tenth(start + DEFAULT_SEQUENCE_SECONDS);
  if (end > ceiling) {
    end = tenth(ceiling);
    start = tenth(Math.max(floor, Math.min(start, end - DEFAULT_SEQUENCE_SECONDS)));
  }
  return { start, end };
}

export type NewSequenceInput = { label: string; start: number; end: number; parentId?: string };
export type NewSequenceCheck = { ok: true; label: string; start: number; end: number } | { error: "emptyLabel" | "endAfterStart" | "outsideSource" };

/** Validates a sequence about to be created, with the same rules as editing one (length, source, parent). */
export function checkNewSequence(sections: Section[], input: NewSequenceInput, durationSeconds?: number): NewSequenceCheck {
  const label = input.label.trim();
  if (!label) return { error: "emptyLabel" };
  const start = tenth(input.start);
  const end = tenth(input.end);
  if (!(start >= 0) || (durationSeconds !== undefined && end > durationSeconds)) return { error: "outsideSource" };
  if (!(end - start >= MIN_SEQUENCE_SECONDS)) return { error: "endAfterStart" };
  const parent = input.parentId ? sections.find(section => section.id === input.parentId) : undefined;
  if (parent?.startSeconds !== undefined && parent.endSeconds !== undefined && (start < parent.startSeconds || end > parent.endSeconds)) return { error: "outsideSource" };
  return { ok: true, label, start, end };
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

  // A sequence without a range gets one from the first edge that is set: ten seconds from the start, or ending at the end.
  const placed = target.startSeconds !== undefined && target.endSeconds !== undefined;
  const fromEnd = !placed && patch.startSeconds === undefined && patch.endSeconds !== undefined;
  const start = patch.startSeconds !== undefined ? tenth(patch.startSeconds) : fromEnd ? tenth(Math.max(0, (patch.endSeconds ?? 0) - DEFAULT_SEQUENCE_SECONDS)) : target.startSeconds ?? 0;
  const end = patch.endSeconds !== undefined ? tenth(patch.endSeconds) : target.endSeconds ?? tenth(Math.min(start + DEFAULT_SEQUENCE_SECONDS, durationSeconds));
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

  if (ranged && target.parentId) {
    const parent = sections.find(section => section.id === target.parentId);
    if (parent?.startSeconds !== undefined && parent.endSeconds !== undefined && (start < parent.startSeconds || end > parent.endSeconds)) return { error: "outsideSource" };
  }
  if (!ranged) return { sections: sections.map(section => (section.id === id ? updated : section)) };

  // The range changed: everything nested below it must still fit, at any depth.
  const fitted = fitDescendants(sections, id, start, end);
  if ("error" in fitted) return fitted;
  return { sections: sections.map(section => (section.id === id ? updated : fitted.sections.get(section.id) ?? section)) };
}

/** Clamps the sequences below `id` into its new range, level by level; refuses when one would drop under the minimum. */
function fitDescendants(sections: Section[], id: string, start: number, end: number): { sections: Map<string, Section> } | { error: "nestedTooShort" } {
  const changed = new Map<string, Section>();
  const walk = (parentId: string, from: number, to: number): "nestedTooShort" | undefined => {
    for (const child of sections.filter(section => section.parentId === parentId)) {
      const childStart = Math.max(child.startSeconds ?? from, from);
      const childEnd = Math.min(child.endSeconds ?? to, to);
      if (childEnd - childStart < MIN_SEQUENCE_SECONDS) return "nestedTooShort";
      changed.set(child.id, { ...child, startSeconds: tenth(childStart), endSeconds: tenth(childEnd) });
      const failure = walk(child.id, tenth(childStart), tenth(childEnd));
      if (failure) return failure;
    }
    return undefined;
  };
  const failure = walk(id, start, end);
  return failure ? { error: failure } : { sections: changed };
}

/**
 * Moves a sequence by `delta` seconds, keeping its length. With `withChildren` the sequences nested in it move
 * the same distance; otherwise they stay and must still fit (else the move is refused). The move is limited to
 * the source (0..duration) and to the parent sequence.
 */
export function moveSequence(sections: Section[], id: string, delta: number, durationSeconds: number, withChildren: boolean): RangeChange {
  const target = sections.find(section => section.id === id);
  if (!target || target.startSeconds === undefined || target.endSeconds === undefined) return { sections };
  const parent = target.parentId ? sections.find(section => section.id === target.parentId) : undefined;
  const floor = parent?.startSeconds ?? 0;
  const ceiling = Math.min(parent?.endSeconds ?? Infinity, durationSeconds);
  const length = target.endSeconds - target.startSeconds;
  const start = tenth(Math.min(Math.max(target.startSeconds + delta, floor), ceiling - length));
  const shift = tenth(start - target.startSeconds);
  if (shift === 0) return { sections };
  const moving = new Set<string>([id, ...(withChildren ? descendantIds(sections, id) : [])]);
  const moved = sections.map(section => moving.has(section.id) && section.startSeconds !== undefined && section.endSeconds !== undefined
    ? { ...section, startSeconds: tenth(section.startSeconds + shift), endSeconds: tenth(section.endSeconds + shift) }
    : section);
  if (withChildren) return { sections: moved };
  const nowAt = moved.find(section => section.id === id)!;
  const fitted = fitDescendants(moved, id, nowAt.startSeconds!, nowAt.endSeconds!);
  if ("error" in fitted) return fitted;
  return { sections: moved.map(section => fitted.sections.get(section.id) ?? section) };
}

/** The section after (or before) the current one in timeline order, wrapping at the ends. */
export function neighbourRow(rows: TimelineRow[], currentId: string | null, step: 1 | -1): TimelineRow | undefined {
  if (!rows.length) return undefined;
  const index = rows.findIndex(row => row.section.id === currentId);
  if (index < 0) return rows[0];
  return rows[(index + step + rows.length) % rows.length];
}
