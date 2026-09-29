import { DESIGN_CANVAS } from "@/domain/output-presets";
import { resolveReframe, type Reframe } from "@/domain/reframe";
import { baseItemDuration, isBaseItem, type AudioClipItem, type BaseItem, type GraphicCarrierItem, type ProjectDefinition, type TimelineItem, type Transition } from "@/domain/project";

export type CaptionTrackInput = { path: string; language: string };
/** Burned-in captions: an ASS file rendered onto the picture with libass after overlays/slates (and before any preview downscale). */
export type BurnedCaptionInput = { assPath: string; /** Directory libass searches for font files (the template font's directory). */ fontsDir?: string };
export type RenderPlanOptions = { /** Soft subtitle track muxed into the MP4 as mov_text; `language` must be an ISO 639-2 code. */ captions?: CaptionTrackInput; burnedCaptions?: BurnedCaptionInput };
export type FfmpegPlan = { sourcePaths: Map<string, string>; assetPaths?: Map<string, string>; outputPath: string; args: string[] };

type SourceClipItem = Extract<TimelineItem, { type: "source-clip" }>;
type OverlayItem = Extract<TimelineItem, { type: "overlay" }>;
type SlateItem = Extract<TimelineItem, { type: "slate" }>;
type RichLayer = { id?: string; type?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; text?: string; src?: string; animation?: string; style?: Record<string, string | number> };
type TimeRange = { start: number; end: number };

const ENCODE_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart"];
export const AUDIO_NORMALIZE = "asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

export function formatSeconds(value: number): string { return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
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

export function transitionDuration(transition: Transition | undefined, duration: number): number {
  if (!transition || transition.type === "cut" || transition.durationSeconds <= 0) return 0;
  return Math.min(transition.durationSeconds, duration / 2);
}
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Filter chain(s) that trim a source and fit its picture into the `width` x `height` frame per `reframe`:
 * fill (cover + centre crop), custom (crop the chosen rectangle, then cover) or fit (contain, bars filled with `bars`
 * or a blurred enlarged copy). The output frame size is exact in every mode; the source size is never needed up front.
 */
export function sourceVideoFilters(inputIndex: number, start: number, duration: number, label: string, frame: { width: number; height: number; bars?: string }, reframe: Reframe): string[] {
  const { width: W, height: H } = frame;
  const trimmed = `[${inputIndex}:v]trim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},setpts=PTS-STARTPTS`;
  const cover = `scale=w=${W}:h=${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (reframe.mode === "fit") {
    const contain = `scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
    if (reframe.fitBackground === "color") return [`${trimmed},${contain},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${frame.bars ?? "black"},setsar=1[${label}]`];
    const bw = even(W / 4), bh = even(H / 4);
    return [
      `${trimmed},split=2[${label}bgs][${label}fgs]`,
      `[${label}bgs]scale=w=${bw}:h=${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=6,scale=${W}:${H}[${label}bgb]`,
      `[${label}fgs]${contain}[${label}fgf]`,
      `[${label}bgb][${label}fgf]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2,setsar=1[${label}]`,
    ];
  }
  const crop = reframe.mode === "custom" && reframe.crop
    ? `crop=w=trunc(iw*${formatSeconds(reframe.crop.w)}/2)*2:h=trunc(ih*${formatSeconds(reframe.crop.h)}/2)*2:x=trunc(iw*${formatSeconds(reframe.crop.x)}/2)*2:y=trunc(ih*${formatSeconds(reframe.crop.y)}/2)*2,`
    : "";
  return [`${trimmed},${crop}${cover},setsar=1[${label}]`];
}
/** Audio of an audio-clip, trimmed to its window and padded/cut to exactly `duration` so concat stays in sync with the picture. */
export function audioClipFilter(inputIndex: number, item: AudioClipItem, label: string, duration = item.endSeconds - item.startSeconds): string {
  const volume = item.volume !== undefined && item.volume !== 1 ? `volume=${formatSeconds(item.volume)},` : "";
  return `[${inputIndex}:a]atrim=start=${formatSeconds(item.startSeconds ?? 0)}:duration=${formatSeconds(duration)},${volume}${AUDIO_NORMALIZE},apad=whole_dur=${formatSeconds(duration)},atrim=duration=${formatSeconds(duration)},asetpts=PTS-STARTPTS[${label}]`;
}
/**
 * Layers an audio-clip over `base` starting `at` seconds into it. The base is ducked to `duckSourceVolume` while the clip
 * plays; amix runs with normalize=0 (plain sum) and `duration=first`, so the result never outlasts the base.
 */
export function audioMixFilters(base: string, inputIndex: number, item: AudioClipItem, at: number, index: number): { filters: string[]; output: string } {
  const duration = item.endSeconds - item.startSeconds;
  const volume = item.volume !== undefined && item.volume !== 1 ? `volume=${formatSeconds(item.volume)},` : "";
  const filters = [`[${inputIndex}:a]atrim=start=${formatSeconds(item.startSeconds ?? 0)}:duration=${formatSeconds(duration)},${volume}${AUDIO_NORMALIZE},adelay=delays=${Math.round(at * 1000)}:all=1[mixin${index}]`];
  let source = base;
  const duck = item.duckSourceVolume ?? 1;
  if (duck < 1) {
    filters.push(`[${source}]volume=volume='if(between(t,${formatSeconds(at)},${formatSeconds(at + duration)}),${formatSeconds(duck)},1)':eval=frame[duck${index}]`);
    source = `duck${index}`;
  }
  filters.push(`[${source}][mixin${index}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix${index}]`);
  return { filters, output: `mix${index}` };
}
/** Slate stand-in for the picture of a standalone audio clip: its graphic / background image / template background colour. */
function audioClipAsSlate(item: AudioClipItem): SlateItem {
  return { type: "slate", template: "rich", mode: "standalone", durationSeconds: item.endSeconds - item.startSeconds, graphicId: item.graphicId, backgroundImage: item.backgroundImage, data: item.data ?? {} };
}
export function sourceAudioFilter(inputIndex: number, start: number, duration: number, label: string): string { return `[${inputIndex}:a]atrim=start=${formatSeconds(start)}:duration=${formatSeconds(duration)},${AUDIO_NORMALIZE}[${label}]`; }

function richLayers(item: GraphicCarrierItem): RichLayer[] {
  try {
    const raw = item.data?.layers;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function layerStyle(layer: RichLayer, sizeFactor = 1) {
  const style = layer.style ?? {};
  return {
    fontSize: Math.round(Number.parseFloat(String(style["font-size"] ?? 48)) * sizeFactor * 100) / 100,
    color: String(style.color ?? "white"),
    textAlign: String(style["text-align"] ?? "left"),
    opacity: Number(style.opacity ?? 1),
    boxColor: style.background ? String(style.background) : undefined,
  };
}

type RichContext = { width: number; height: number; /** Output size relative to the 1920x1080 canvas graphics are authored on: positions scale per axis, sizes by the smaller factor. */ sx: number; sy: number; sf: number; textColor: string; imageIndexByAsset: Map<string, number>; counter: { value: number }; fontFile?: string };

function richLayerFilters(input: string, output: string, layers: RichLayer[], ctx: RichContext, enable?: TimeRange): string[] {
  const filters: string[] = [];
  const enableExpr = enable ? enableBetween(enable) : "";
  let current = input;
  for (const layer of layers) {
    const next = `${output}_${ctx.counter.value++}`;
    const x = Number(layer.x ?? 0) * ctx.sx;
    const y = Number(layer.y ?? 0) * ctx.sy;
    const w = layer.width === undefined ? ctx.width : Number(layer.width) * ctx.sx;
    const h = layer.height === undefined ? ctx.height : Number(layer.height) * ctx.sy;
    const s = layerStyle(layer, ctx.sf);
    if (layer.type === "rect" || layer.type === "ellipse") {
      filters.push(`[${current}]${fillBox(x, y, w, h, `${s.boxColor ?? "black"}@${s.opacity}`)}${enableExpr}[${next}]`);
    } else if (layer.type === "image" && layer.src && ctx.imageIndexByAsset.has(layer.src)) {
      const idx = ctx.imageIndexByAsset.get(layer.src)!;
      // overlay has no w/h options, so scale the image first; shortest=1 stops the looped image input from running forever.
      filters.push(`[${idx}:v]format=rgba,colorchannelmixer=aa=${s.opacity},scale=w=${formatSeconds(w)}:h=${formatSeconds(h)}[${next}img]`);
      filters.push(`[${current}][${next}img]overlay=x=${formatSeconds(x)}:y=${formatSeconds(y)}:shortest=1${enableExpr}[${next}]`);
    } else if (layer.type === "text" && layer.text) {
      const alignX = s.textAlign === "center" ? `(w-text_w)/2` : s.textAlign === "right" ? `w-text_w-${formatSeconds(ctx.width - x - w)}` : formatSeconds(x);
      const box = s.boxColor ? `:box=1:boxcolor=${s.boxColor}@${s.opacity}:boxborderw=${formatSeconds(10 * ctx.sf)}` : "";
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
  // trim bounds a looped background image, which is otherwise an endless stream.
  const filters = [`[${inputIndex}:v]trim=duration=${formatSeconds(item.durationSeconds)},scale=w=${ctx.width}:h=${ctx.height},setsar=1,setpts=PTS-STARTPTS[${baseLabel}]`];
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

function overlayTextFilter(input: string, output: string, text: string, item: OverlayItem, textColor: string, ctx: RichContext): string {
  const fontFile = ctx.fontFile;
  const fontSize = Math.round(Number(item.data.fontSize ?? 48) * ctx.sf);
  const color = item.data.color ?? `${textColor}@${item.opacity}`;
  const x = item.x === undefined ? "(w-text_w)/2" : formatSeconds(item.x * ctx.sx);
  const y = item.y === undefined ? "(h-text_h)/2" : formatSeconds(item.y * ctx.sy);
  const box = item.data.boxColor ? `:box=1:boxcolor=${item.data.boxColor}:boxborderw=${formatSeconds(Number(item.data.boxBorderWidth ?? 20) * ctx.sf)}` : "";
  return `[${input}]drawtext=text='${escapeFilterText(text)}':fontcolor=${color}:fontsize=${fontSize}:x=${x}:y=${y}${box}${enableBetween({ start: item.startSeconds, end: item.endSeconds })}${fontOption(fontFile)}[${output}]`;
}

export function buildCompositionRenderPlan(definition: ProjectDefinition, sourcePaths: Map<string, string>, outputPath: string, assetPaths?: Map<string, string>, options: RenderPlanOptions = {}): FfmpegPlan {
  const template = definition.template;
  const width = template?.width ?? 1920;
  const height = template?.height ?? 1080;
  const fps = template?.fps ?? 30;
  const backgroundColor = template?.backgroundColor ?? "black";
  const textColor = template?.textColor ?? "white";
  const items = definition.composition.items;

  const baseItems = items.filter(isBaseItem);
  const audioMixes = items.filter((item): item is AudioClipItem => item.type === "audio-clip" && item.mode === "mix");
  // Definitions are stored as saved by the editor, without schema defaults applied.
  const overlays = items.filter((item): item is OverlayItem => item.type === "overlay").map((item) => ({ ...item, opacity: item.opacity ?? 1, data: item.data ?? {} }));
  const overlaySlates = items.filter((item): item is SlateItem => item.type === "slate" && item.mode === "overlay");
  if (!baseItems.length) throw new Error("Composition must contain at least one source clip or standalone slate (or standalone voiceover)");

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

  const sx = width / DESIGN_CANVAS.width, sy = height / DESIGN_CANVAS.height;
  const ctx: RichContext = { width, height, sx, sy, sf: Math.min(sx, sy), textColor, imageIndexByAsset, counter: { value: 0 }, fontFile: template?.fontFile };
  const filters: string[] = [];
  const durations = baseItems.map(baseItemDuration);
  const audioAssetPath = (item: AudioClipItem) => {
    const assetPath = assetPaths?.get(item.assetId);
    if (!assetPath) throw new Error(`Missing audio asset for assetId: ${item.assetId}`);
    return assetPath;
  };
  baseItems.forEach((item, index) => {
    const duration = durations[index];
    const v = `v${index}`, a = `a${index}`;
    if (item.type === "source-clip") {
      const input = sourceIndexMap.get(item.sourceId)!;
      filters.push(...sourceVideoFilters(input, item.startSeconds, duration, v, { width, height, bars: backgroundColor }, resolveReframe(item, definition.sections, template?.reframe)), sourceAudioFilter(input, item.startSeconds, duration, a));
      return;
    }
    const video = nextInput++;
    const audio = nextInput++;
    const slate = item.type === "audio-clip" ? audioClipAsSlate(item) : item;
    if (slate.backgroundImage && assetPaths?.has(slate.backgroundImage)) args.push("-loop", "1", "-i", assetPaths.get(slate.backgroundImage)!);
    else args.push("-f", "lavfi", "-i", `color=c=${backgroundColor}:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}`);
    if (item.type === "audio-clip") args.push("-i", audioAssetPath(item));
    else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filters.push(...slateFilters(video, slate, v, ctx));
    filters.push(item.type === "audio-clip" ? audioClipFilter(audio, item, a) : `[${audio}:a]atrim=duration=${formatSeconds(duration)},${AUDIO_NORMALIZE}[${a}]`);
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
      filters.push(`[${outV}][${outA}][${inV}][${inA}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    } else {
      filters.push(`[${currentVideo}][${currentAudio}][${inVideo}][${inAudio}]concat=n=2:v=1:a=1[${nextVideo}][${nextAudio}]`);
      currentDuration += duration;
    }
    currentVideo = nextVideo;
    currentAudio = nextAudio;
  }

  // Voiceovers layered over the finished timeline; the source audio underneath is ducked while they play.
  audioMixes.forEach((item, index) => {
    const input = nextInput++;
    args.push("-i", audioAssetPath(item));
    const mixed = audioMixFilters(currentAudio, input, item, item.atSeconds ?? 0, index);
    filters.push(...mixed.filters);
    currentAudio = mixed.output;
  });

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
      filters.push(`[${outputVideo}]${fillBox((item.x ?? 0) * sx, (item.y ?? 0) * sy, item.width === undefined ? width : item.width * sx, item.height === undefined ? height : item.height * sy, `${color}@${item.opacity}`)}${enableBetween(range)}[${next}]`);
    } else if (item.kind === "image" && item.imageAsset && imageIndexByAsset.has(item.imageAsset)) {
      const input = imageIndexByAsset.get(item.imageAsset)!;
      const img = `img${overlayCounter}`;
      const imageScale = ctx.sf === 1 ? "" : `,scale=w=iw*${formatSeconds(ctx.sf)}:h=ih*${formatSeconds(ctx.sf)}`;
      filters.push(`[${input}:v]format=rgba,colorchannelmixer=aa=${item.opacity}${imageScale}[${img}]`);
      filters.push(`[${outputVideo}][${img}]overlay=x=${formatSeconds((item.x ?? 0) * sx)}:y=${formatSeconds((item.y ?? 0) * sy)}:shortest=1${enableBetween(range)}[${next}]`);
    } else {
      const text = item.data.text ?? item.data.title;
      if (!text) continue;
      filters.push(overlayTextFilter(outputVideo, next, text, item, textColor, ctx));
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

  if (options.burnedCaptions) {
    const fontsDir = options.burnedCaptions.fontsDir ? `:fontsdir='${escapeFilterText(options.burnedCaptions.fontsDir)}'` : "";
    filters.push(`[${outputVideo}]ass=filename='${escapeFilterText(options.burnedCaptions.assPath)}'${fontsDir}[burned]`);
    outputVideo = "burned";
  }

  args.push("-filter_complex", filters.join(";"), "-map", `[${outputVideo}]`, "-map", `[${currentAudio}]`, ...ENCODE_ARGS);
  if (options.captions) {
    // Added after the video/audio maps so callers that patch the first -map (previews) keep working.
    args.splice(args.indexOf("-filter_complex"), 0, "-i", options.captions.path);
    args.push("-map", `${nextInput}:0`, "-c:s", "mov_text", "-metadata:s:s:0", `language=${options.captions.language}`);
  }
  args.push(outputPath);
  return { sourcePaths, assetPaths, outputPath, args };
}

export function buildSourceRenderPlan(definition: ProjectDefinition, inputPathOrSourcePaths: string | Map<string, string>, outputPath: string, assetPaths?: Map<string, string>, options: RenderPlanOptions = {}): FfmpegPlan {
  const hasItems = definition.composition.items.length > 0;
  if (inputPathOrSourcePaths instanceof Map) {
    if (hasItems) return buildCompositionRenderPlan(definition, inputPathOrSourcePaths, outputPath, assetPaths, options);
    const legacyPath = inputPathOrSourcePaths.get("legacy-source") ?? inputPathOrSourcePaths.values().next().value;
    if (!legacyPath) throw new Error("No source path available for legacy render");
    return buildSourceRenderPlan(definition, legacyPath, outputPath, assetPaths, options);
  }
  const sourcePaths = new Map([["legacy-source", inputPathOrSourcePaths]]);
  if (hasItems) return buildCompositionRenderPlan(definition, sourcePaths, outputPath, assetPaths, options);
  const start = definition.composition.sourceStartSeconds ?? 0;
  const end = definition.composition.sourceEndSeconds ?? 0;
  return {
    sourcePaths,
    outputPath,
    args: ["-hide_banner", "-y", "-i", inputPathOrSourcePaths, "-ss", formatSeconds(start), "-t", formatSeconds(end - start), "-map", "0:v:0?", "-map", "0:a:0?", ...ENCODE_ARGS, outputPath],
  };
}
