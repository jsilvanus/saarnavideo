import type { GraphicCarrierItem, ProjectDefinition, TimelineItem, Transition } from "@/domain/project";

export type FfmpegPlan = { sourcePaths: Map<string, string>; assetPaths?: Map<string, string>; outputPath: string; args: string[] };

type SourceClipItem = Extract<TimelineItem, { type: "source-clip" }>;
type OverlayItem = Extract<TimelineItem, { type: "overlay" }>;
type SlateItem = Extract<TimelineItem, { type: "slate" }>;
type RichLayer = { id?: string; type?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; text?: string; src?: string; animation?: string; style?: Record<string, string | number> };
type TimeRange = { start: number; end: number };

const ENCODE_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart"];
const AUDIO_NORMALIZE = "asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

function formatSeconds(value: number): string { return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function escapeFilterText(value: string): string { return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\n/g, "\\n"); }
function fontOption(fontFile?: string): string { return fontFile ? `:fontfile='${escapeFilterText(fontFile)}'` : ""; }
function enableBetween(range: TimeRange): string { return `:enable='between(t,${formatSeconds(range.start)},${formatSeconds(range.end)})'`; }
function fillBox(x: number | string, y: number | string, w: number | string, h: number | string, color: string): string {
  const fmt = (v: number | string) => (typeof v === "number" ? formatSeconds(v) : v);
  return `drawbox=x=${fmt(x)}:y=${fmt(y)}:w=${fmt(w)}:h=${fmt(h)}:color=${color}:t=fill`;
}
/** Centered drawtext used by slate titles (y = "(h-text_h)/2") and subtitles (y = "h*0.65"). */
function centeredText(input: string, output: string, text: string, color: string, fontSize: number, y: string, extra: string): string {
  return `[${input}]drawtext=text='${escapeFilterText(text)}':fontcolor=${color}:fontsize=${fontSize}:x=(w-text_w)/2:y=${y}${extra}[${output}]`;
}

function transitionDuration(transition: Transition | undefined, duration: number): number {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return 0;
  return Math.min(transition.durationSeconds, duration / 2);
}
function sourceVideoFilter(inputIndex: number, start: number, duration: number, label: string): string { return `[${inputIndex}:v]trim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},scale=w=1920:h=1080,setsar=1,setpts=PTS-STARTPTS[${label}]`; }
function sourceAudioFilter(inputIndex: number, start: number, duration: number, label: string): string { return `[${inputIndex}:a]atrim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},${AUDIO_NORMALIZE}[${label}]`; }

function richLayers(item: GraphicCarrierItem): RichLayer[] {
  try {
    const raw = item.data?.layers;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function layerStyle(layer: RichLayer) {
  const style = layer.style ?? {};
  return {
    fontSize: Number.parseFloat(String(style["font-size"] ?? 48)),
    color: String(style.color ?? "white"),
    textAlign: String(style["text-align"] ?? "left"),
    opacity: Number(style.opacity ?? 1),
    boxColor: style.background ? String(style.background) : undefined,
  };
}

type RichContext = { width: number; height: number; textColor: string; imageIndexByAsset: Map<string, number>; counter: { value: number }; fontFile?: string };

function richLayerFilters(input: string, output: string, layers: RichLayer[], ctx: RichContext, enable?: TimeRange): string[] {
  const filters: string[] = [];
  const enableExpr = enable ? enableBetween(enable) : "";
  let current = input;
  for (const layer of layers) {
    const next = `${output}_${ctx.counter.value++}`;
    const x = Number(layer.x ?? 0);
    const y = Number(layer.y ?? 0);
    const w = Number(layer.width ?? ctx.width);
    const h = Number(layer.height ?? ctx.height);
    const s = layerStyle(layer);
    if (layer.type === "rect" || layer.type === "ellipse") {
      filters.push(`[${current}]${fillBox(x, y, w, h, `${s.boxColor ?? "black"}@${s.opacity}`)}${enableExpr}[${next}]`);
    } else if (layer.type === "image" && layer.src && ctx.imageIndexByAsset.has(layer.src)) {
      const idx = ctx.imageIndexByAsset.get(layer.src)!;
      filters.push(`[${idx}:v]format=rgba,colorchannelmixer=aa=${s.opacity}[${next}img]`);
      filters.push(`[${current}][${next}img]overlay=x=${formatSeconds(x)}:y=${formatSeconds(y)}:w=${formatSeconds(w)}:h=${formatSeconds(h)}${enableExpr}[${next}]`);
    } else if (layer.type === "text" && layer.text) {
      const alignX = s.textAlign === "center" ? `(w-text_w)/2` : s.textAlign === "right" ? `w-text_w-${formatSeconds(ctx.width - x - w)}` : formatSeconds(x);
      const box = s.boxColor ? `:box=1:boxcolor=${s.boxColor}@${s.opacity}:boxborderw=10` : "";
      const color = s.color || ctx.textColor;
      filters.push(`[${current}]drawtext=text='${escapeFilterText(layer.text)}':fontcolor=${color}:fontsize=${s.fontSize}:x=${alignX}:y=${formatSeconds(y)}:fontcolor_expr='${color}'${box}${fontOption(ctx.fontFile)}${enableExpr}[${next}]`);
    } else {
      continue;
    }
    current = next;
  }
  filters.push(`[${current}]null[${output}]`);
  return filters;
}

function slateFilters(inputIndex: number, item: SlateItem, label: string, ctx: RichContext): string[] {
  const layers = richLayers(item);
  const text = item.data.title ?? item.data.text;
  const subtitle = item.data.subtitle;
  const baseLabel = layers.length || text || subtitle ? `${label}base` : label;
  const filters = [`[${inputIndex}:v]scale=w=${ctx.width}:h=${ctx.height},setsar=1,setpts=PTS-STARTPTS[${baseLabel}]`];
  if (layers.length) return [...filters, ...richLayerFilters(baseLabel, label, layers, ctx)];
  const font = fontOption(ctx.fontFile);
  let current = baseLabel;
  if (text) {
    const out = subtitle ? `${label}title` : label;
    filters.push(centeredText(current, out, text, ctx.textColor, Math.round(ctx.height * 0.065), "(h-text_h)/2", font));
    current = out;
  }
  if (subtitle) filters.push(centeredText(current, label, subtitle, ctx.textColor, Math.round(ctx.height * 0.035), "h*0.65", font));
  return filters;
}

function overlayTextFilter(input: string, output: string, text: string, item: OverlayItem, textColor: string, fontFile?: string): string {
  const fontSize = Number(item.data.fontSize ?? 48);
  const color = item.data.color ?? `${textColor}@${item.opacity}`;
  const x = item.x === undefined ? "(w-text_w)/2" : formatSeconds(item.x);
  const y = item.y === undefined ? "(h-text_h)/2" : formatSeconds(item.y);
  const box = item.data.boxColor ? `:box=1:boxcolor=${item.data.boxColor}:boxborderw=${item.data.boxBorderWidth ?? 20}` : "";
  return `[${input}]drawtext=text='${escapeFilterText(text)}':fontcolor=${color}:fontsize=${fontSize}:x=${x}:y=${y}${box}${enableBetween({ start: item.startSeconds, end: item.endSeconds })}${fontOption(fontFile)}[${output}]`;
}

export function buildCompositionRenderPlan(definition: ProjectDefinition, sourcePaths: Map<string, string>, outputPath: string, assetPaths?: Map<string, string>): FfmpegPlan {
  const template = definition.template;
  const width = template?.width ?? 1920;
  const height = template?.height ?? 1080;
  const fps = template?.fps ?? 30;
  const backgroundColor = template?.backgroundColor ?? "black";
  const textColor = template?.textColor ?? "white";
  const items = definition.composition.items;

  const baseItems = items.filter((item): item is SourceClipItem | SlateItem => item.type === "source-clip" || (item.type === "slate" && item.mode !== "overlay"));
  const overlays = items.filter((item): item is OverlayItem => item.type === "overlay");
  const overlaySlates = items.filter((item): item is SlateItem => item.type === "slate" && item.mode === "overlay");
  if (!baseItems.length) throw new Error("Composition must contain at least one source clip or standalone slate");

  const sourceIds = Array.from(new Set(baseItems.filter((i): i is SourceClipItem => i.type === "source-clip").map((i) => i.sourceId)));
  const sourceIndexMap = new Map(sourceIds.map((id, index) => [id, index]));
  const args: string[] = ["-hide_banner", "-y"];
  for (const sourceId of sourceIds) {
    if (!sourcePaths.has(sourceId)) throw new Error(`Missing source path for sourceId: ${sourceId}`);
    args.push("-i", sourcePaths.get(sourceId)!);
  }
  let nextInput = sourceIds.length;

  // Gather all image assets referenced by rich graphics before adding image inputs.
  const imageAssets = new Set<string>();
  for (const item of [...overlays, ...overlaySlates]) {
    if (item.type === "overlay" && item.kind === "image" && item.imageAsset) imageAssets.add(item.imageAsset);
    if (item.type === "slate" && item.backgroundImage) imageAssets.add(item.backgroundImage);
    for (const l of richLayers(item)) if (l.type === "image" && l.src) imageAssets.add(l.src);
  }
  const imageIndexByAsset = new Map<string, number>();
  for (const key of imageAssets) {
    if (!assetPaths?.has(key)) continue;
    imageIndexByAsset.set(key, nextInput++);
    args.push("-loop", "1", "-i", assetPaths.get(key)!);
  }

  const ctx: RichContext = { width, height, textColor, imageIndexByAsset, counter: { value: 0 }, fontFile: template?.fontFile };
  const filters: string[] = [];
  const durations = baseItems.map((item) => (item.type === "slate" ? item.durationSeconds : item.endSeconds - item.startSeconds));
  baseItems.forEach((item, index) => {
    const duration = durations[index];
    const v = `v${index}`, a = `a${index}`;
    if (item.type === "source-clip") {
      const input = sourceIndexMap.get(item.sourceId)!;
      filters.push(sourceVideoFilter(input, item.startSeconds, duration, v), sourceAudioFilter(input, item.startSeconds, duration, a));
      return;
    }
    const video = nextInput++;
    const audio = nextInput++;
    if (item.backgroundImage && assetPaths?.has(item.backgroundImage)) args.push("-loop", "1", "-i", assetPaths.get(item.backgroundImage)!);
    else args.push("-f", "lavfi", "-i", `color=c=${backgroundColor}:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}`);
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filters.push(...slateFilters(video, item, v, ctx));
    filters.push(`[${audio}:a]atrim=duration=${formatSeconds(duration)},${AUDIO_NORMALIZE}[${a}]`);
  });

  let currentVideo = "v0", currentAudio = "a0", currentDuration = durations[0];
  for (let index = 1; index < baseItems.length; index++) {
    const duration = durations[index];
    const transition = baseItems[index].transitionIn;
    const d = transitionDuration(transition, Math.min(currentDuration, duration));
    const inVideo = `v${index}`, inAudio = `a${index}`;
    const nextVideo = `vc${index}`, nextAudio = `ac${index}`;
    if (transition?.type === "crossfade" && d > 0) {
      filters.push(`[${currentVideo}][${inVideo}]xfade=transition=fade:duration=${formatSeconds(d)}:offset=${formatSeconds(currentDuration - d)}[${nextVideo}]`);
      filters.push(`[${currentAudio}][${inAudio}]acrossfade=d=${formatSeconds(d)}:curve1=tri:curve2=tri[${nextAudio}]`);
      currentDuration += duration - d;
    } else if (transition?.type === "fade" && d > 0) {
      const outV = `vfout${index}`, inV = `vfin${index}`, outA = `afout${index}`, inA = `afin${index}`;
      const outStart = formatSeconds(currentDuration - d);
      filters.push(`[${currentVideo}]fade=t=out:st=${outStart}:d=${formatSeconds(d)}[${outV}]`);
      filters.push(`[${inVideo}]fade=t=in:st=0:d=${formatSeconds(d)}[${inV}]`);
      filters.push(`[${currentAudio}]afade=t=out:st=${outStart}:d=${formatSeconds(d)}[${outA}]`);
      filters.push(`[${inAudio}]afade=t=in:st=0:d=${formatSeconds(d)}[${inA}]`);
      filters.push(`[${outV}][${inV}][${outA}][${inA}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    } else {
      filters.push(`[${currentVideo}][${inVideo}][${currentAudio}][${inAudio}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    }
    currentVideo = nextVideo;
    currentAudio = nextAudio;
  }

  let outputVideo = currentVideo;
  let overlayCounter = 0;
  for (const item of overlays) {
    const next = `ol${overlayCounter++}`;
    const range = { start: item.startSeconds, end: item.endSeconds };
    const layers = richLayers(item);
    if (layers.length) {
      filters.push(...richLayerFilters(outputVideo, next, layers, ctx, range));
    } else if (item.kind === "rectangle") {
      const color = item.color ?? item.data.color ?? "black";
      filters.push(`[${outputVideo}]${fillBox(item.x ?? 0, item.y ?? 0, item.width ?? width, item.height ?? height, `${color}@${item.opacity}`)}${enableBetween(range)}[${next}]`);
    } else if (item.kind === "image" && item.imageAsset && imageIndexByAsset.has(item.imageAsset)) {
      const input = imageIndexByAsset.get(item.imageAsset)!;
      const img = `img${overlayCounter}`;
      filters.push(`[${input}:v]format=rgba,colorchannelmixer=aa=${item.opacity}[${img}]`);
      filters.push(`[${outputVideo}][${img}]overlay=x=${formatSeconds(item.x ?? 0)}:y=${formatSeconds(item.y ?? 0)}${enableBetween(range)}[${next}]`);
    } else {
      const text = item.data.text ?? item.data.title;
      if (!text) continue;
      filters.push(overlayTextFilter(outputVideo, next, text, item, textColor, ctx.fontFile));
    }
    outputVideo = next;
  }

  for (const item of overlaySlates) {
    const range = { start: item.startSeconds!, end: item.endSeconds! };
    const enable = enableBetween(range);
    const next = `sl${overlayCounter++}`;
    const background = `${item.data.backgroundColor ?? backgroundColor}@${Number(item.data.backgroundOpacity ?? 0.55)}`;
    filters.push(`[${outputVideo}]${fillBox(0, 0, `${width}`, `${height}`, background)}${enable}[${next}bg]`);
    let current = `${next}bg`;
    const layers = richLayers(item);
    if (layers.length) {
      filters.push(...richLayerFilters(current, next, layers, ctx, range));
    } else {
      const text = item.data.title ?? item.data.text;
      if (text) {
        filters.push(centeredText(current, `${next}text`, text, textColor, Math.round(height * 0.065), "(h-text_h)/2", enable));
        current = `${next}text`;
      }
      const subtitle = item.data.subtitle;
      if (subtitle) {
        filters.push(centeredText(current, `${next}sub`, subtitle, textColor, Math.round(height * 0.035), "h*0.65", enable));
        current = `${next}sub`;
      }
      filters.push(`[${current}]null[${next}]`);
    }
    outputVideo = next;
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${outputVideo}]`, "-map", `[${currentAudio}]`, ...ENCODE_ARGS, outputPath);
  return { sourcePaths, assetPaths, outputPath, args };
}

export function buildSourceRenderPlan(definition: ProjectDefinition, inputPathOrSourcePaths: string | Map<string, string>, outputPath: string, assetPaths?: Map<string, string>): FfmpegPlan {
  const hasItems = definition.composition.items.length > 0;
  if (inputPathOrSourcePaths instanceof Map) {
    if (hasItems) return buildCompositionRenderPlan(definition, inputPathOrSourcePaths, outputPath, assetPaths);
    const legacyPath = inputPathOrSourcePaths.get("legacy-source") ?? inputPathOrSourcePaths.values().next().value;
    if (!legacyPath) throw new Error("No source path available for legacy render");
    return buildSourceRenderPlan(definition, legacyPath, outputPath, assetPaths);
  }
  const sourcePaths = new Map([["legacy-source", inputPathOrSourcePaths]]);
  if (hasItems) return buildCompositionRenderPlan(definition, sourcePaths, outputPath, assetPaths);
  const start = definition.composition.sourceStartSeconds ?? 0;
  const end = definition.composition.sourceEndSeconds ?? 0;
  return {
    sourcePaths,
    outputPath,
    args: ["-hide_banner", "-y", "-i", inputPathOrSourcePaths, "-ss", formatSeconds(start), "-t", formatSeconds(end - start), "-map", "0:v:0?", "-map", "0:a:0?", ...ENCODE_ARGS, outputPath],
  };
}
