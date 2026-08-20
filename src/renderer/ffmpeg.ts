import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  inputPath?: string; // Single input path for backward compatibility with single-source compositions
  inputPaths?: Record<string, string>; // Map sourceId to input paths for multi-source
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
 * 
 * Supports both single-source (backward compatible) and multi-source compositions.
 */
export function buildSourceRenderPlan(
  definition: ProjectDefinition,
  inputPath: string,
  outputPath: string,
  sourceMap?: Record<string, string>, // sourceId -> file path mapping
): FfmpegPlan {
  const sourceItems = definition.composition.items.filter(
    (item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip",
  );

  // Handle single-source backward compatibility
  if (!sourceMap && sourceItems.length > 0 && !sourceItems[0].sourceId) {
    // Old format without sourceId - treat as single source
    const ranges = sourceItems;
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

  // Handle simple backward compatibility with sourceStartSeconds/sourceEndSeconds
  if (sourceItems.length === 0 && definition.composition.sourceStartSeconds !== undefined && definition.composition.sourceEndSeconds !== undefined) {
    const duration = definition.composition.sourceEndSeconds - definition.composition.sourceStartSeconds;
    const args: string[] = ["-hide_banner", "-y", "-i", inputPath];
    args.push(
      "-ss", formatSeconds(definition.composition.sourceStartSeconds),
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

  // Multi-source handling
  if (!sourceMap) throw new Error("sourceMap is required for multi-source compositions");

  // Collect all unique sourceIds from items
  const sourceIds = new Set<string>();
  sourceItems.forEach(item => {
    if (item.sourceId) sourceIds.add(item.sourceId);
  });
  const uniqueSourceIds = Array.from(sourceIds);

  // Build input arguments and create source-to-input-index mapping
  const args: string[] = ["-hide_banner", "-y"];
  const sourceToInputIndex: Record<string, number> = {};
  
  uniqueSourceIds.forEach((sourceId, index) => {
    const filePath = sourceMap[sourceId];
    if (!filePath) throw new Error(`No file path provided for source ${sourceId}`);
    args.push("-i", filePath);
    sourceToInputIndex[sourceId] = index;
  });

  if (sourceItems.length === 1) {
    // Single source clip - simple case
    const item = sourceItems[0];
    const inputIndex = sourceToInputIndex[item.sourceId];
    const duration = item.endSeconds - item.startSeconds;
    const transition = transitionFilter(item.transitionIn, 0, duration);
    
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
    return { inputPaths: sourceMap, outputPath, args };
  }

  // Multiple source clips - need complex filter
  const filter = sourceItems.map((item, index) => {
    const inputIndex = sourceToInputIndex[item.sourceId];
    const duration = item.endSeconds - item.startSeconds;
    const transition = transitionFilter(item.transitionIn, index, duration);
    const videoFilters = [`trim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(duration)}`, "setpts=PTS-STARTPTS"];
    if (transition) videoFilters.push(transition);
    return `[${inputIndex}:v]${videoFilters.join(",")}[v${index}];` +
      `[${inputIndex}:a]atrim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[a${index}]`;
  }).join(";");

  const concatInputs = sourceItems.map((_, index) => `[v${index}][a${index}]`).join("");
  const concat = `${concatInputs}concat=n=${sourceItems.length}:v=1:a=1[outv][outa]`;

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

  return { inputPaths: sourceMap, outputPath, args };
}
