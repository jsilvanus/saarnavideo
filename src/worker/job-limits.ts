/** Optional caps on how many jobs of one type run at once across all workers (`JOB_LIMITS`). */
export type JobLimits = Partial<Record<string, number>>;

const JOB_TYPES = ["DOWNLOAD", "THUMBNAIL", "PREVIEW", "VIDEO", "PODCAST", "TRANSCRIBE"] as const;

/**
 * Parses `JOB_LIMITS`, for example `TRANSCRIBE=2,VIDEO=4`. Unset or empty means no limits. Unknown types and
 * non-positive or non-integer counts are rejected, so a typo cannot silently turn a limit off.
 */
export function parseJobLimits(value: string | undefined): JobLimits {
  const limits: JobLimits = {};
  if (!value?.trim()) return limits;
  for (const part of value.split(",")) {
    const [rawType, rawCount, ...rest] = part.split("=").map(item => item.trim());
    const count = Number(rawCount);
    if (rest.length || !JOB_TYPES.includes(rawType as never) || !Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid JOB_LIMITS entry "${part.trim()}": expected TYPE=count with TYPE one of ${JOB_TYPES.join(", ")} and count of at least 1`);
    }
    limits[rawType] = count;
  }
  return limits;
}
