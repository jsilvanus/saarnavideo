import type { ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = {
  sourcePaths: Map<string, string>;
  assetPaths?: Map<string, string>;
  outputPath: string;
  args: string[];
};

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeFilterText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\n/g, "\\n");
}

function transitionDuration(transition: Transition | undefined, duration: number): number {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return 0;
  return Math.min(transition.durationSeconds, duration / 2);
}

function sourceVideoFilter(inputIndex: number, start: number, duration: number, label: string): string {
  return `[${inputIndex}:v]trim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},scale=w=1920:h=1080,setsar=1,setpts=PTS-STARTPTS[${label}]`;
}

function sourceAudioFilter(inputIndex: number, start: number, duration: number, label: string): string {
  return `[${inputIndex}:a]atrim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${label}]`;
}

function slateFilters(
  inputIndex: number,
  item: Extract<TimelineItem, { type: "slate" }>,
  label: string,
  height: number,
  width: number,
  textColor: string,
  fontFile?: string,
): string[] {
  const filters = [`[${inputIndex}:v]scale=w=${width}:h=${height},setsar=1,setpts=PTS-STARTPTS[${label}base]`];
  const text = item.data.title ?? item.data.text;
  const subtitle = item.data.subtitle;
  const font = fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : "";
  if (text) filters.push(`[${label}base]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.065)}:x=(w-text_w)/2:y=(h-text_h)/2${font}[${label}title]`);
  if (subtitle) {
    const previous = text ? `${label}title` : `${label}base`;
    filters.push(`[${previous}]drawtext=text='${escapeFilterText(subtitle)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.035)}:x=(w-text_w)/2:y=h*0.65${font}[${label}]`);
  } else if (text) filters[filters.length - 1] = filters[filters.length - 1].replace(`[${label}title]`, `[${label}]`);
  else filters[0] = filters[0].replace(`[${label}base]`, `[${label}]`);
  return filters;
}

function overlayTextFilter(input: string, output: string, text: string, item: Extract<TimelineItem, { type: "overlay" }>, textColor: string, fontFile?: string): string {
  const font = fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : "";
  const fontSize = Number(item.data.fontSize ?? 48);
  const color = item.data.color ?? `${textColor}@${item.opacity}`;
  const x = item.x === undefined ? "(w-text_w)/2" : formatSeconds(item.x);
  const y = item.y === undefined ? "(h-text_h)/2" : formatSeconds(item.y);
  const box = item.data.boxColor ? `:box=1:boxcolor=${item.data.boxColor}:boxborderw=${item.data.boxBorderWidth ?? 20}` : "";
  return `[${input}]drawtext=text='${escapeFilterText(text)}':fontcolor=${color}:fontsize=${fontSize}:x=${x}:y=${y}${box}:enable='between(t,${formatSeconds(item.startSeconds)},${formatSeconds(item.endSeconds)})'${font}[${output}]`;
}

export function buildCompositionRenderPlan(
  definition: ProjectDefinition,
  sourcePaths: Map<string, string>,
  outputPath: string,
  assetPaths?: Map<string, string>,
): FfmpegPlan {
  const template = (definition.template ?? {}) as Partial<Record<string, unknown>>;
  const width = (template.width as number | undefined) ?? 1920;
  const height = (template.height as number | undefined) ?? 1080;
  const fps = (template.fps as number | undefined) ?? 30;
  const backgroundColor = (template.backgroundColor as string | undefined) ?? "black";
  const textColor = (template.textColor as string | undefined) ?? "white";
  const items = definition.composition.items;

  const baseItems = items.filter((item) => item.type === "source-clip" || (item.type === "slate" && item.mode !== "overlay"));
  const overlays = items.filter((item): item is Extract<TimelineItem, { type: "overlay" }> => item.type === "overlay");
  const overlaySlates = items.filter((item): item is Extract<TimelineItem, { type: "slate" }> => item.type === "slate" && item.mode === "overlay");
  if (baseItems.length === 0) throw new Error("Composition must contain at least one source clip or standalone slate");

  const sourceIds = Array.from(new Set(baseItems.filter((i): i is Extract<TimelineItem, { type: "source-clip" }> => i.type === "source-clip").map((i) => i.sourceId)));
  const sourceIndexMap = new Map(sourceIds.map((id, index) => [id, index]));
  for (const sourceId of sourceIds) if (!sourcePaths.has(sourceId)) throw new Error(`Missing source path for sourceId: ${sourceId}`);

  const args: string[] = ["-hide_banner", "-y"];
  for (const sourceId of sourceIds) args.push("-i", sourcePaths.get(sourceId)!);

  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  const durations: number[] = [];
  let nextInput = sourceIds.length;
  const slateInputs = new Map<number, { video: number; audio: number }>();

  baseItems.forEach((item, index) => {
    const duration = item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds;
    durations.push(duration);
    const v = `v${index}`;
    const a = `a${index}`;
    videoLabels.push(v);
    audioLabels.push(a);
    if (item.type === "source-clip") {
      const input = sourceIndexMap.get(item.sourceId)!;
      filters.push(sourceVideoFilter(input, item.startSeconds, duration, v));
      filters.push(sourceAudioFilter(input, item.startSeconds, duration, a));
    } else {
      const video = nextInput++;
      const audio = nextInput++;
      slateInputs.set(index, { video, audio });
      if (item.backgroundImage && assetPaths?.has(item.backgroundImage)) {
        args.push("-loop", "1", "-i", assetPaths.get(item.backgroundImage)!);
      } else {
        args.push("-f", "lavfi", "-i", `color=c=${backgroundColor}:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}`);
      }
      args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      filters.push(...slateFilters(video, item, v, height, width, textColor, template.fontFile as string | undefined));
      filters.push(`[${audio}:a]atrim=duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${a}]`);
    }
  });

  let currentVideo = videoLabels[0];
  let currentAudio = audioLabels[0];
  let currentDuration = durations[0];

  for (let index = 1; index < baseItems.length; index++) {
    const item = baseItems[index];
    const duration = durations[index];
    const transition = item.transitionIn;
    const d = transitionDuration(transition, Math.min(currentDuration, duration));
    const nextVideo = `vc${index}`;
    const nextAudio = `ac${index}`;

    if (transition?.type === "crossfade" && d > 0) {
      filters.push(`[${currentVideo}][${videoLabels[index]}]xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(currentDuration - d)}[${nextVideo}]`);
      filters.push(`[${currentAudio}][${audioLabels[index]}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${nextAudio}]`);
      currentDuration += duration - d;
    } else if (transition?.type === "fade" && d > 0) {
      const outV = `vfout${index}`;
      const inV = `vfin${index}`;
      const outA = `afout${index}`;
      const inA = `afin${index}`;
      filters.push(`[${currentVideo}]fade=t=out:st=${formatSeconds(currentDuration - d)}:d=${formatSeconds(d)}[${outV}]`);
      filters.push(`[${videoLabels[index]}]fade=t=in:st=0:d=${formatSeconds(d)}[${inV}]`);
      filters.push(`[${currentAudio}]afade=t=out:st=${formatSeconds(currentDuration - d)}:d=${formatSeconds(d)}[${outA}]`);
      filters.push(`[${audioLabels[index]}]afade=t=in:st=0:d=${formatSeconds(d)}[${inA}]`);
      filters.push(`[${outV}][${inV}][${outA}][${inA}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    } else {
      filters.push(`[${currentVideo}][${videoLabels[index]}][${currentAudio}][${audioLabels[index]}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    }
    currentVideo = nextVideo;
    currentAudio = nextAudio;
  }

  let outputVideo = currentVideo;
  let overlayCounter = 0;
  let imageInputIndex = nextInput;

  const imageAssets = new Set<string>();
  for (const item of overlays) if (item.kind === "image" && item.imageAsset && assetPaths?.has(item.imageAsset)) imageAssets.add(item.imageAsset);
  for (const item of overlaySlates) if (item.backgroundImage && assetPaths?.has(item.backgroundImage)) imageAssets.add(item.backgroundImage);
  for (const assetKey of imageAssets) args.push("-loop", "1", "-i", assetPaths!.get(assetKey)!);
  const imageIndexByAsset = new Map(Array.from(imageAssets).map((key, index) => [key, imageInputIndex + index]));

  for (const item of overlays) {
    const next = `ol${overlayCounter++}`;
    if (item.kind === "rectangle") {
      const x = item.x ?? 0;
      const y = item.y ?? 0;
      const w = item.width ?? width;
      const h = item.height ?? height;
      const color = item.color ?? item.data.color ?? "black";
      filters.push(`[${outputVideo}]drawbox=x=${formatSeconds(x)}:y=${formatSeconds(y)}:w=${formatSeconds(w)}:h=${formatSeconds(h)}:color=${color}@${item.opacity}:t=fill:enable='between(t,${formatSeconds(item.startSeconds)},${formatSeconds(item.endSeconds)})'[${next}]`);
    } else if (item.kind === "image" && item.imageAsset && imageIndexByAsset.has(item.imageAsset)) {
      const input = imageIndexByAsset.get(item.imageAsset)!;
      const x = item.x ?? 0;
      const y = item.y ?? 0;
      filters.push(`[${input}:v]format=rgba,colorchannelmixer=aa=${item.opacity}[img${overlayCounter}]`);
      filters.push(`[${outputVideo}][img${overlayCounter}]overlay=x=${formatSeconds(x)}:y=${formatSeconds(y)}:enable='between(t,${formatSeconds(item.startSeconds)},${formatSeconds(item.endSeconds)})'[${next}]`);
    } else {
      const text = item.data.text ?? item.data.title;
      if (!text) continue;
      filters.push(overlayTextFilter(outputVideo, next, text, item, textColor, template.fontFile as string | undefined));
    }
    outputVideo = next;
  }

  for (const item of overlaySlates) {
    const start = item.startSeconds!;
    const end = item.endSeconds!;
    const next = `sl${overlayCounter++}`;
    let current = outputVideo;
    const background = item.data.backgroundColor ?? backgroundColor;
    const opacity = Number(item.data.backgroundOpacity ?? 0.55);
    filters.push(`[${current}]drawbox=x=0:y=0:w=${width}:h=${height}:color=${background}@${opacity}:t=fill:enable='between(t,${formatSeconds(start)},${formatSeconds(end)})'[${next}bg]`);
    current = `${next}bg`;
    if (item.backgroundImage && imageIndexByAsset.has(item.backgroundImage)) {
      const input = imageIndexByAsset.get(item.backgroundImage)!;
      filters.push(`[${input}:v]format=rgba[${next}img]`);
      filters.push(`[${current}][${next}img]overlay=x=0:y=0:enable='between(t,${formatSeconds(start)},${formatSeconds(end)})'[${next}image]`);
      current = `${next}image`;
    }
    const text = item.data.title ?? item.data.text;
    if (text) {
      filters.push(`[${current}]drawtext=text='${escapeFilterText(text)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.065)}:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${formatSeconds(start)},${formatSeconds(end)})'[${next}text]`);
      current = `${next}text`;
    }
    const subtitle = item.data.subtitle;
    if (subtitle) {
      filters.push(`[${current}]drawtext=text='${escapeFilterText(subtitle)}':fontcolor=${textColor}:fontsize=${Math.round(height * 0.035)}:x=(w-text_w)/2:y=h*0.65:enable='between(t,${formatSeconds(start)},${formatSeconds(end)})'[${next}]`);
    } else {
      filters.push(`[${current}]null[${next}]`);
    }
    outputVideo = next;
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${outputVideo}]`, "-map", `[${currentAudio}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", outputPath);
  return { sourcePaths, assetPaths, outputPath, args };
}

export function buildSourceRenderPlan(definition: ProjectDefinition, inputPathOrSourcePaths: string | Map<string, string>, outputPath: string): FfmpegPlan {
  if (inputPathOrSourcePaths instanceof Map) {
    if (definition.composition.items.length > 0) return buildCompositionRenderPlan(definition, inputPathOrSourcePaths, outputPath);
    const legacyPath = inputPathOrSourcePaths.get("legacy-source") ?? inputPathOrSourcePaths.values().next().value;
    if (!legacyPath) throw new Error("No source path available for legacy render");
    return buildSourceRenderPlan(definition, legacyPath, outputPath);
  }
  const sourcePaths = new Map([["legacy-source", inputPathOrSourcePaths]]);
  if (definition.composition.items.length > 0) return buildCompositionRenderPlan(definition, sourcePaths, outputPath);
  const start = definition.composition.sourceStartSeconds ?? 0;
  const end = definition.composition.sourceEndSeconds ?? 0;
  return {
    sourcePaths,
    outputPath,
    args: ["-hide_banner", "-y", "-i", inputPathOrSourcePaths, "-ss", formatSeconds(start), "-t", formatSeconds(end - start), "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", outputPath],
  };
}
