import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  inputPath: string;
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

function sourceVideoFilter(start: number, duration: number, label: string): string {
  return `[0:v]trim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},setpts=PTS-STARTPTS[${label}]`;
}

function sourceAudioFilter(start: number, duration: number, label: string): string {
  return `[0:a]atrim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[${label}]`;
}

function slateFilters(
  inputIndex: number,
  item: Extract<TimelineItem, { type: "slate" }>,
  label: string,
  width: number,
  height: number,
  fps: number,
  backgroundColor: string,
  textColor: string,
  fontFile?: string,
): string[] {
  const video = `[${inputIndex}:v]setpts=PTS-STARTPTS`;
  const filters = [`${video}[${label}base]`];
  const text = item.data.title ?? item.data.text;
  const subtitle = item.data.subtitle;
  if (text) {
    const font = fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : "";
    filters.push(
      `[${label}base]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.065)}:x=(w-text_w)/2:y=(h-text_h)/2${font}[${label}title]`,
    );
  }
  if (subtitle) {
    const previous = text ? `${label}title` : `${label}base`;
    const font = fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : "";
    filters.push(
      `[${previous}]drawtext=text='${escapeFilterText(subtitle)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.035)}:x=(w-text_w)/2:y=(h*0.65)${font}[${label}]`,
    );
  } else if (text) {
    filters[filters.length - 1] = filters[filters.length - 1].replace(`[${label}title]`, `[${label}]`);
  } else {
    filters[filters.length - 1] = filters[filters.length - 1].replace(`[${label}base]`, `[${label}]`);
  }
  void width;
  void fps;
  void backgroundColor;
  return filters;
}

/**
 * Build a deterministic FFmpeg plan for the declarative composition timeline.
 * Source clips and generated slates form the base sequence; overlays are then
 * applied in output-time coordinates. Multi-source resolution is intentionally
 * left to the source acquisition layer, so this renderer still receives one
 * resolved input file for now.
 */
export function buildCompositionRenderPlan(
  definition: ProjectDefinition,
  inputPath: string,
  outputPath: string,
): FfmpegPlan {
  const template = definition.template ?? {};
  const width = template.width ?? 1920;
  const height = template.height ?? 1080;
  const fps = template.fps ?? 30;
  const backgroundColor = template.backgroundColor ?? "black";
  const textColor = template.textColor ?? "white";
  const items = definition.composition.items.length > 0
    ? definition.composition.items
    : [{ type: "source-clip" as const, startSeconds: definition.composition.sourceStartSeconds, endSeconds: definition.composition.sourceEndSeconds }];
  const baseItems = items.filter((item) => item.type !== "overlay");
  const overlays = items.filter((item): item is Extract<TimelineItem, { type: "overlay" }> => item.type === "overlay");

  if (baseItems.length === 0) throw new Error("Composition must contain at least one source clip or slate");

  const args: string[] = ["-hide_banner", "-y", "-i", inputPath];
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  const durations: number[] = [];
  let inputIndex = 1;

  baseItems.forEach((item, index) => {
    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    durations.push(duration);
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;
    videoLabels.push(videoLabel);
    audioLabels.push(audioLabel);

    if (item.type === "source-clip") {
      filters.push(sourceVideoFilter(item.startSeconds, duration, videoLabel));
      filters.push(sourceAudioFilter(item.startSeconds, duration, audioLabel));
    } else {
      const videoInput = inputIndex++;
      args.push("-f", "lavfi", "-i", `color=c=${backgroundColor}:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}`);
      const audioInput = inputIndex++;
      args.push("-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000`);
      filters.push(...slateFilters(videoInput, item, videoLabel, width, height, fps, backgroundColor, textColor, template.fontFile));
      filters.push(`[${audioInput}:a]atrim=duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[${audioLabel}]`);
    }
  });

  let currentVideo = videoLabels[0];
  let currentAudio = audioLabels[0];
  let currentDuration = durations[0];

  for (let index = 1; index < baseItems.length; index += 1) {
    const item = baseItems[index];
    const duration = durations[index];
    const transition = item.type === "source-clip" || item.type === "slate" ? item.transitionIn : undefined;
    const d = transitionDuration(transition, Math.min(currentDuration, duration));
    if (transition?.type === "crossfade" && d > 0) {
      const nextVideo = `vx${index}`;
      const nextAudio = `ax${index}`;
      filters.push(`[${currentVideo}][${videoLabels[index]}]xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(currentDuration - d)}[${nextVideo}]`);
      filters.push(`[${currentAudio}][${audioLabels[index]}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${nextAudio}]`);
      currentVideo = nextVideo;
      currentAudio = nextAudio;
      currentDuration = currentDuration + duration - d;
    } else {
      const nextVideo = `vc${index}`;
      const nextAudio = `ac${index}`;
      if (transition?.type === "fade" && d > 0) {
        filters.push(`[${videoLabels[index]}]fade=t=in:st=0:d=${formatSeconds(d)}[${videoLabels[index]}f]`);
        filters.push(`[${currentVideo}][${videoLabels[index]}f][${currentAudio}][${audioLabels[index]}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      } else {
        filters.push(`[${currentVideo}][${videoLabels[index]}][${currentAudio}][${audioLabels[index]}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      }
      currentVideo = nextVideo;
      currentAudio = nextAudio;
      currentDuration += duration;
    }
  }

  let outputVideo = currentVideo;
  let elapsed = 0;
  for (const item of baseItems) {
    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    elapsed += duration;
  }
  void elapsed;

  let overlayIndex = 0;
  let overlayElapsed = 0;
  for (const item of overlays) {
    const text = item.data.text ?? item.data.gospelText ?? item.data.title;
    if (!text) continue;
    const boxColor = item.data.boxColor ?? "black@0.55";
    const fontSize = Number(item.data.fontSize ?? Math.round(height * 0.035));
    const font = template.fontFile ? `:fontfile='${escapeFilterText(template.fontFile)}'` : "";
    const next = `overlay${overlayIndex++}`;
    const start = formatSeconds(item.startSeconds);
    const end = formatSeconds(item.endSeconds);
    filters.push(
      `[${outputVideo}]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=${boxColor}:boxborderw=20:enable='between(t,${start},${end})'${font}[${next}]`,
    );
    outputVideo = next;
    overlayElapsed = Math.max(overlayElapsed, item.endSeconds);
  }
  void overlayElapsed;

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", `[${outputVideo}]`,
    "-map", `[${currentAudio}]`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  );
  return { inputPath, outputPath, args };
}

/** Backwards-compatible source-only plan used by the current worker. */
export function buildSourceRenderPlan(
  definition: ProjectDefinition,
  inputPath: string,
  outputPath: string,
): FfmpegPlan {
  return buildCompositionRenderPlan(definition, inputPath, outputPath);
}
