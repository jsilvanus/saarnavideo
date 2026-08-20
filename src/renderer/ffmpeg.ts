import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  sourcePaths: Map<string, string>;
  outputPath: string;
  args: string[];
};

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeFilterText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n");
}

function transitionDuration(transition: Transition | undefined, duration: number): number {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return 0;
  return Math.min(transition.durationSeconds, duration / 2);
}

function sourceVideoFilter(inputIndex: number, start: number, duration: number, label: string): string {
  return `[${inputIndex}:v]trim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},setpts=PTS-STARTPTS[${label}]`;
}

function sourceAudioFilter(inputIndex: number, start: number, duration: number, label: string): string {
  return `[${inputIndex}:a]atrim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[${label}]`;
}

function slateFilters(
  inputIndex: number,
  item: Extract<TimelineItem, { type: "slate" }>,
  label: string,
  height: number,
  textColor: string,
  fontFile?: string,
): string[] {
  const filters = [`[${inputIndex}:v]setpts=PTS-STARTPTS[${label}base]`];
  const text = item.data.title ?? item.data.text;
  const subtitle = item.data.subtitle;
  const font = fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : "";

  if (text) {
    filters.push(
      `[${label}base]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.065)}:x=(w-text_w)/2:y=(h-text_h)/2${font}[${label}title]`,
    );
  }

  if (subtitle) {
    const previous = text ? `${label}title` : `${label}base`;
    filters.push(
      `[${previous}]drawtext=text='${escapeFilterText(subtitle)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.035)}:x=(w-text_w)/2:y=h*0.65${font}[${label}]`,
    );
  } else if (text) {
    filters[filters.length - 1] = filters[filters.length - 1].replace(`[${label}title]`, `[${label}]`);
  } else {
    filters[0] = filters[0].replace(`[${label}base]`, `[${label}]`);
  }

  return filters;
}

/**
 * Build an explicit FFmpeg plan for compositions with multiple sources, slates, and overlays.
 * Handles multi-source video files, generated slates (with text), and text overlays.
 */
export function buildCompositionRenderPlan(
  definition: ProjectDefinition,
  sourcePaths: Map<string, string>,
  outputPath: string,
): FfmpegPlan {
  const template = (definition.template ?? {}) as Partial<Record<string, unknown>>;
  const width = (template.width as number | undefined) ?? 1920;
  const height = (template.height as number | undefined) ?? 1080;
  const fps = (template.fps as number | undefined) ?? 30;
  const backgroundColor = (template.backgroundColor as string | undefined) ?? "black";
  const textColor = (template.textColor as string | undefined) ?? "white";

  const items = definition.composition.items;
  const baseItems = items.filter((item) => item.type !== "overlay");
  const overlays = items.filter((item): item is Extract<TimelineItem, { type: "overlay" }> => item.type === "overlay");

  // Validate we have at least one base item
  if (baseItems.length === 0) {
    throw new Error("Composition must contain at least one source clip or slate");
  }

  // Collect all unique source IDs from source-clip items
  const sourceClips = baseItems.filter((item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip");
  const uniqueSourceIds = Array.from(new Set(sourceClips.map((item) => item.sourceId)));
  const sourceIndexMap = new Map(uniqueSourceIds.map((id, idx) => [id, idx]));

  // Verify all referenced sources are provided
  for (const sourceId of sourceIndexMap.keys()) {
    if (!sourcePaths.has(sourceId)) {
      throw new Error(`Missing source path for sourceId: ${sourceId}`);
    }
  }

  const args: string[] = ["-hide_banner", "-y"];

  // Add source file inputs
  for (const [sourceId, path] of sourcePaths) {
    if (sourceIndexMap.has(sourceId)) {
      args.push("-i", path);
    }
  }

  // Add generated inputs for slates (color + audio)
  const slateItems = baseItems.filter((item): item is Extract<TimelineItem, { type: "slate" }> => item.type === "slate");
  const slateInputIndices = new Map<number, { videoIndex: number; audioIndex: number }>();
  let currentInputIndex = uniqueSourceIds.length;

  for (let i = 0; i < baseItems.length; i++) {
    const item = baseItems[i];
    if (item.type === "slate") {
      const videoIndex = currentInputIndex++;
      const audioIndex = currentInputIndex++;
      slateInputIndices.set(i, { videoIndex, audioIndex });
      const duration = item.durationSeconds;
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=${backgroundColor}:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}`,
      );
      args.push(
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
    }
  }

  // Build filter complex
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  const durations: number[] = [];

  baseItems.forEach((item, index) => {
    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    durations.push(duration);
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;
    videoLabels.push(videoLabel);
    audioLabels.push(audioLabel);

    if (item.type === "source-clip") {
      const inputIndex = sourceIndexMap.get(item.sourceId) ?? 0;
      filters.push(sourceVideoFilter(inputIndex, item.startSeconds, duration, videoLabel));
      filters.push(sourceAudioFilter(inputIndex, item.startSeconds, duration, audioLabel));
    } else if (item.type === "slate") {
      const indices = slateInputIndices.get(index);
      if (!indices) throw new Error(`Missing input indices for slate at index ${index}`);
      filters.push(...slateFilters(indices.videoIndex, item, videoLabel, height, textColor, template.fontFile as string | undefined));
      filters.push(
        `[${indices.audioIndex}:a]atrim=duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[${audioLabel}]`,
      );
    }
  });

  // Compose base items with transitions
  let currentVideo = videoLabels[0];
  let currentAudio = audioLabels[0];
  let currentDuration = durations[0];

  for (let index = 1; index < baseItems.length; index++) {
    const item = baseItems[index];
    const duration = durations[index];
    const transition = item.type === "source-clip" || item.type === "slate" ? item.transitionIn : undefined;
    const d = transitionDuration(transition, Math.min(currentDuration, duration));

    if (transition?.type === "crossfade" && d > 0) {
      const nextVideo = `vx${index}`;
      const nextAudio = `ax${index}`;
      filters.push(
        `[${currentVideo}][${videoLabels[index]}]xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(currentDuration - d)}[${nextVideo}]`,
      );
      filters.push(`[${currentAudio}][${audioLabels[index]}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${nextAudio}]`);
      currentVideo = nextVideo;
      currentAudio = nextAudio;
      currentDuration += duration - d;
    } else {
      const nextVideo = `vc${index}`;
      const nextAudio = `ac${index}`;
      if (transition?.type === "fade" && d > 0) {
        const faded = `vf${index}`;
        filters.push(`[${videoLabels[index]}]fade=t=in:st=0:d=${formatSeconds(d)}[${faded}]`);
        filters.push(
          `[${currentVideo}][${faded}][${currentAudio}][${audioLabels[index]}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`,
        );
      } else {
        filters.push(
          `[${currentVideo}][${videoLabels[index]}][${currentAudio}][${audioLabels[index]}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`,
        );
      }
      currentVideo = nextVideo;
      currentAudio = nextAudio;
      currentDuration += duration;
    }
  }

  // Apply overlays
  let outputVideo = currentVideo;
  let overlayIndex = 0;
  for (const item of overlays) {
    const text = item.data.text ?? item.data.gospelText ?? item.data.title;
    if (!text) continue;
    const boxColor = item.data.boxColor ?? "black@0.55";
    const fontSize = Number(item.data.fontSize ?? Math.round(height * 0.035));
    const font = (template.fontFile as string | undefined) ? `:fontfile='${escapeFilterText(template.fontFile as string)}'` : "";
    const next = `overlay${overlayIndex++}`;
    filters.push(
      `[${outputVideo}]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=${boxColor}:boxborderw=20:enable='between(t,${formatSeconds(item.startSeconds)},${formatSeconds(item.endSeconds)})'${font}[${next}]`,
    );
    outputVideo = next;
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${outputVideo}]`,
    "-map",
    `[${currentAudio}]`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  );

  return { sourcePaths, outputPath, args };
}

/**
 * Legacy single-source rendering for backward compatibility.
 * Delegates to buildCompositionRenderPlan if composition items exist.
 */
export function buildSourceRenderPlan(definition: ProjectDefinition, inputPath: string, outputPath: string): FfmpegPlan {
  // For multi-source support, we need sourcePaths map. This function is kept for backward compatibility
  // but requires single source. Convert to composition plan if items exist.
  const sourceId = "legacy-source";
  const sourcePaths = new Map([[sourceId, inputPath]]);

  if (definition.composition.items && definition.composition.items.length > 0) {
    // Has explicit items, use composition plan
    return buildCompositionRenderPlan(definition, sourcePaths, outputPath);
  }

  // Fall back to simple source range rendering (legacy format)
  const start = definition.composition.sourceStartSeconds ?? 0;
  const end = definition.composition.sourceEndSeconds ?? 0;
  const duration = end - start;

  const args = [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-ss",
    formatSeconds(start),
    "-t",
    formatSeconds(duration),
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  return { sourcePaths, outputPath, args };
}
