import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  inputPath: string | string[];
  outputPath: string;
  args: string[];
};

export type SourcePathMap = Record<string, string>;

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function transitionFilter(transition: Transition | undefined, duration: number): string {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return "";
  const d = Math.min(transition.durationSeconds, duration / 2);
  if (transition.type === "crossfade") {
    return `xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(Math.max(0, duration / 2 - d))}`;
  }
  return `fade=t=in:st=0:d=${formatSeconds(d)}`;
}

export function resolveSourceMap(
  definition: ProjectDefinition,
  sourcePathMap: SourcePathMap | string,
): SourcePathMap {
  const mapping: Record<string, string> = typeof sourcePathMap === "string" ? { default: sourcePathMap } : { ...sourcePathMap };
  const refs = definition.composition.items.filter((item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip").map((item) => item.sourceId);
  const ids = [...new Set(refs.length > 0 ? refs : Object.keys(mapping))];
  const missing = ids.filter((sourceId) => !(sourceId in mapping));
  if (missing.length > 0) {
    throw new Error(`Composition references missing source IDs: ${missing.join(", ")}`);
  }
  return ids.reduce<SourcePathMap>((result, sourceId) => {
    result[sourceId] = mapping[sourceId];
    return result;
  }, {});
}

export function buildSourceRenderPlan(
  definition: ProjectDefinition,
  sourcePathMap: SourcePathMap | string,
  outputPath: string,
): FfmpegPlan {
  const resolvedMap = resolveSourceMap(definition, sourcePathMap);
  const sourceEntries = Object.entries(resolvedMap);
  const args: string[] = ["-hide_banner", "-y"];

  for (const [, sourcePath] of sourceEntries) {
    args.push("-i", sourcePath);
  }

  const items = definition.composition.items.length > 0
    ? definition.composition.items
    : [{
        type: "source-clip" as const,
        sourceId: Object.keys(resolvedMap)[0],
        startSeconds: definition.composition.sourceStartSeconds,
        endSeconds: definition.composition.sourceEndSeconds,
      }];

  const inputIndexById = new Map<string, number>();
  sourceEntries.forEach(([sourceId], index) => inputIndexById.set(sourceId, index));

  if (items.length === 1 && items[0].type === "source-clip") {
    const item = items[0];
    const inputIndex = inputIndexById.get(item.sourceId) ?? 0;
    const duration = item.endSeconds - item.startSeconds;
    const transition = transitionFilter(item.transitionIn, duration);
    args.push(
      "-ss", formatSeconds(item.startSeconds),
      "-t", formatSeconds(duration),
      "-map", `${inputIndex}:v:0?`,
      "-map", `${inputIndex}:a:0?`,
      ...(transition ? ["-vf", transition] : []),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    );
    return { inputPath: sourceEntries.map(([, path]) => path), outputPath, args };
  }

  const segmentFilters: string[] = [];
  const concatStages: string[] = [];
  let previousDuration = 0;

  for (const [index, item] of items.entries()) {
    const baseIndex = item.type === "source-clip" ? inputIndexById.get(item.sourceId) ?? 0 : -1;
    if (item.type === "source-clip") {
      const duration = item.endSeconds - item.startSeconds;
      const transition = transitionFilter(item.transitionIn, duration);
      const videoFilter = `trim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(duration)},setpts=PTS-STARTPTS${transition ? `,${transition}` : ""}`;
      segmentFilters.push(`[${baseIndex}:v]${videoFilter}[v${index}];[${baseIndex}:a]atrim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[a${index}]`);
      concatStages.push(`[v${index}][a${index}]`);
      previousDuration = duration;
      continue;
    }

    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    const overlayText = item.type === "overlay" ? JSON.stringify(item.template + (Object.keys(item.data).length ? ` ${Object.values(item.data).join(" ")}` : "")) : item.template;
    const videoFilter = item.type === "slate"
      ? `color=c=black:s=1280x720:d=${formatSeconds(duration)},drawtext=text=${overlayText}:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`
      : `color=c=black:s=1280x720:d=${formatSeconds(duration)},drawtext=text=${overlayText}:fontcolor=white:fontsize=36:x=20:y=20`;
    const audioFilter = `anullsrc=r=48000:cl=stereo:d=${formatSeconds(duration)}`;
    segmentFilters.push(`${videoFilter}[v${index}];${audioFilter}[a${index}]`);
    concatStages.push(`[v${index}][a${index}]`);
    previousDuration = duration;
  }

  const filter = segmentFilters.join(";");
  const concat = `${concatStages.join("")}concat=n=${items.length}:v=1:a=1[outv][outa]`;

  if (items.some((item) => item.type === "source-clip" && item.transitionIn?.type === "crossfade")) {
    const crossfadeText = items
      .filter((item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip" && item.transitionIn?.type === "crossfade" === true)
      .map((item) => {
        const d = Math.min(item.transitionIn!.durationSeconds, item.endSeconds - item.startSeconds);
        return `xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(Math.max(0, previousDuration / 2 - d))}`;
      })
      .join(";");
    if (crossfadeText) {
      segmentFilters.push(crossfadeText);
    }
  }

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

  return { inputPath: sourceEntries.map(([, path]) => path), outputPath, args };
}
