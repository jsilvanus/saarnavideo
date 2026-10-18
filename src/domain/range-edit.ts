/** A time range in seconds. */
export type TimeRange = { start: number; end: number };

/** Positions snap to a tenth of a second; a block is never shorter than half a second. */
export const SNAP_SECONDS = 0.1;
export const MIN_BLOCK_SECONDS = 0.5;

export const snapTime = (seconds: number, step = SNAP_SECONDS) => Math.round(seconds / step) * step;
const clean = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

export type RangeEdit =
  /** The start edge goes to `to` (output seconds). */
  | { edge: "start"; to: number }
  /** The end edge goes to `to`. */
  | { edge: "end"; to: number }
  /** The whole block moves by `by` seconds. */
  | { edge: "move"; by: number };

/**
 * Applies a drag or a typed value to a block's range: positions snap to 0.1 s, the length stays at least `minLength`,
 * and the block stays inside `bounds` (its clip or section; the whole timeline when there are none). A range that
 * cannot fit the minimum inside the bounds is returned cut to the bounds.
 */
export function editRange(range: TimeRange, edit: RangeEdit, bounds: TimeRange, minLength = MIN_BLOCK_SECONDS): TimeRange {
  const low = bounds.start;
  const high = Math.max(bounds.start, bounds.end);
  const min = Math.min(minLength, high - low);
  if (edit.edge === "start") {
    const start = clamp(snapTime(edit.to), low, Math.max(low, range.end - min));
    return { start: clean(start), end: clean(range.end) };
  }
  if (edit.edge === "end") {
    const end = clamp(snapTime(edit.to), Math.min(high, range.start + min), high);
    return { start: clean(range.start), end: clean(end) };
  }
  const length = range.end - range.start;
  const start = clamp(snapTime(range.start + edit.by), low, Math.max(low, high - length));
  return { start: clean(start), end: clean(start + length) };
}
