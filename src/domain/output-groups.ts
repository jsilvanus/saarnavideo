/**
 * Groups a project's outputs by the render that made them: every output of one MediaJob (video, thumbnail, caption files,
 * podcast audio) forms one group. Outputs without a job (not produced by a render) stand alone.
 */

export type GroupableOutput = { id: string; jobId?: string | null; createdAt?: string | Date | null };

export type OutputGroup<T extends GroupableOutput> = {
  /** The job id, or the output id for an output without a job. */
  key: string;
  jobId: string | null;
  /** When the group was produced: the newest output's creation time (ISO string), or null when unknown. */
  producedAt: string | null;
  /** The outputs of the group, oldest first (a render writes the video before its captions and thumbnail). */
  outputs: T[];
};

function time(value: string | Date | null | undefined): number {
  if (!value) return Number.NaN;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return ms;
}

/** Groups outputs by job, newest group first. Groups of unknown time go last. */
export function groupOutputsByRender<T extends GroupableOutput>(outputs: T[]): OutputGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const output of outputs) {
    const key = output.jobId ? `job:${output.jobId}` : `output:${output.id}`;
    const list = groups.get(key);
    if (list) list.push(output);
    else groups.set(key, [output]);
  }
  const result: OutputGroup<T>[] = [...groups.entries()].map(([key, members]) => {
    const sorted = members
      .map((output, index) => ({ output, index }))
      .sort((a, b) => {
        const diff = time(a.output.createdAt) - time(b.output.createdAt);
        return (Number.isNaN(diff) ? 0 : diff) || a.index - b.index;
      })
      .map(entry => entry.output);
    const newest = sorted.reduce<number>((max, output) => { const t = time(output.createdAt); return Number.isNaN(t) ? max : Math.max(max, t); }, -Infinity);
    return {
      key,
      jobId: members[0].jobId ?? null,
      producedAt: Number.isFinite(newest) ? new Date(newest).toISOString() : null,
      outputs: sorted,
    };
  });
  // Newest first; the sort is stable, so groups of equal or unknown time keep the input order.
  return result.sort((a, b) => {
    const ta = a.producedAt ? Date.parse(a.producedAt) : Number.NaN;
    const tb = b.producedAt ? Date.parse(b.producedAt) : Number.NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

/** The Intl locale used for times of one interface language (24-hour clock in all three). */
export function intlLocaleFor(locale: string): string {
  return locale === "sv" ? "sv-SE" : locale === "en" ? "en-GB" : "fi-FI";
}

/**
 * A render's production time as a heading: "Today 14:32" on the day of `now`, else the date and the time ("18.10.2026 14:32"
 * in Finnish). `todayLabel` is the translated word for today.
 */
export function formatRenderTime(iso: string, now: Date, locale: string, todayLabel: string): string {
  const when = new Date(iso);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(when);
  const sameDay = when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth() && when.getDate() === now.getDate();
  if (sameDay) return `${todayLabel} ${time}`;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric" }).format(when);
  return `${date} ${time}`;
}
