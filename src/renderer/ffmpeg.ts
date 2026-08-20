import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  inputPath: string;
  outputPath: string;
  args: string[];
};

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function transitionFilter(transition: Transition | undefined, index: number, duration: number): string {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return "";
  const d = Math.min(transition.durationSeconds, duration / 2);
  if (transition.type === "crossfade") {
    return `xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(duration - d)}`;
  }
  // A fade is implemented as a short fade-to-black at the beginning of the clip.
  return `fade=t=in:st=0:d=${formatSeconds(d)}`;
}

/**
 * Build an explicit FFmpeg plan for source clips. Transitions are declarative
 * timeline properties; cut is the default and remains a no-op.
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
    const transition = transitionFilter(range.transitionIn, 0, duration);
    args.push(
      "-ss", formatSeconds(range.startSeconds),
      "-t", formatSeconds(duration),
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      ...(transition ? ["-vf", transition] : []),
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
    const transition = transitionFilter(range.transitionIn, index, duration);
    const videoFilters = [`trim=start=${formatSeconds(range.startSeconds)}:duration=${formatSeconds(duration)}`, "setpts=PTS-STARTPTS"];
    if (transition) videoFilters.push(transition);
    return `[0:v]${videoFilters.join(",")}[v${index}];` +
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
