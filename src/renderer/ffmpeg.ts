import type { ProjectDefinition, TimelineItem } from "@/domain/project";

export type FfmpegPlan = {
  inputPath: string;
  outputPath: string;
  args: string[];
};

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Build a conservative FFmpeg command for the source-only part of a composition.
 * Generated slates/overlays are deliberately represented as timeline items and
 * are resolved by the renderer in later steps. Keeping command construction
 * pure makes it straightforward to test without invoking FFmpeg.
 */
export function buildSourceRenderPlan(
  definition: ProjectDefinition,
  inputPath: string,
  outputPath: string,
): FfmpegPlan {
  const sourceItems = definition.composition.items.filter(
    (item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip",
  );

  const ranges = sourceItems.length > 0
    ? sourceItems
    : [{
        type: "source-clip" as const,
        startSeconds: definition.composition.sourceStartSeconds,
        endSeconds: definition.composition.sourceEndSeconds,
      }];

  const args: string[] = ["-hide_banner", "-y", "-i", inputPath];

  if (ranges.length === 1) {
    const range = ranges[0];
    const duration = range.endSeconds - range.startSeconds;
    args.push(
      "-ss", formatSeconds(range.startSeconds),
      "-t", formatSeconds(duration),
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    );
    return { inputPath, outputPath, args };
  }

  const filter = ranges.map((range, index) => {
    const duration = range.endSeconds - range.startSeconds;
    return `[0:v]trim=start=${formatSeconds(range.startSeconds)}:duration=${formatSeconds(duration)},setpts=PTS-STARTPTS[v${index}];` +
      `[0:a]atrim=start=${formatSeconds(range.startSeconds)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[a${index}]`;
  }).join(";");

  const concatInputs = ranges.map((_, index) => `[v${index}][a${index}]`).join("");
  const concat = `${concatInputs}concat=n=${ranges.length}:v=1:a=1[outv][outa]`;

  args.push(
    "-filter_complex", `${filter};${concat}`,
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  );

  return { inputPath, outputPath, args };
}
