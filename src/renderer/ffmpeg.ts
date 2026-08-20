import { migrateProjectDefinition, type ProjectDefinition, type TimelineItem, type Transition, validateCompositionSources } from "../domain/project";

export type SourcePathMap = Record<string, string>;

export type FfmpegPlan = {
  sourcePaths: SourcePathMap;
  outputPath: string;
  args: string[];
};

type Segment = {
  videoLabel: string;
  audioLabel: string;
  durationSeconds: number;
  transitionIn?: Transition;
  transitionOut?: Transition;
};

function formatSeconds(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function toSlateText(item: Extract<TimelineItem, { type: "slate" }>): string {
  const primary = item.data.title ?? item.data.text ?? "SaarnaVideo";
  const secondary = item.data.subtitle;
  return secondary ? `${primary}\\n${secondary}` : primary;
}

function toOverlayText(item: Extract<TimelineItem, { type: "overlay" }>): string {
  return item.data.text ?? item.data.title ?? item.template;
}

function transitionForPair(previous: Segment, next: Segment): Transition {
  return next.transitionIn ?? previous.transitionOut ?? { type: "cut", durationSeconds: 0 };
}

function withDurationBoundaries(duration: number, transitionDuration: number): number {
  return Math.min(transitionDuration, duration / 2);
}

/**
 * Build an explicit FFmpeg plan for multi-source compositions.
 */
export function buildSourceRenderPlan(
  definitionInput: ProjectDefinition | unknown,
  sourcePaths: SourcePathMap,
  outputPath: string,
): FfmpegPlan {
  const fallbackSourceId = Object.keys(sourcePaths).length === 1 ? Object.keys(sourcePaths)[0] : undefined;
  const definition = migrateProjectDefinition(definitionInput, fallbackSourceId);
  validateCompositionSources(definition, Object.keys(sourcePaths));

  const sourceItems = definition.composition.items.filter(
    (item): item is Extract<TimelineItem, { type: "source-clip" }> => item.type === "source-clip",
  );
  if (sourceItems.length === 0 && definition.composition.items.every((item) => item.type === "overlay")) {
    throw new Error("Composition must contain at least one source clip or slate");
  }

  const sourceOrder = Array.from(new Set(sourceItems.map((item) => item.sourceId)));
  const sourceIndex = new Map(sourceOrder.map((sourceId, index) => [sourceId, index]));

  const args: string[] = ["-hide_banner", "-y"];
  for (const sourceId of sourceOrder) {
    args.push("-i", sourcePaths[sourceId]);
  }

  const filters: string[] = [];
  const segments: Segment[] = [];
  let segmentIndex = 0;

  for (const item of definition.composition.items) {
    if (item.type === "overlay") continue;

    const videoLabel = `[segv${segmentIndex}]`;
    const audioLabel = `[sega${segmentIndex}]`;

    if (item.type === "source-clip") {
      const inputIndex = sourceIndex.get(item.sourceId);
      if (inputIndex === undefined) throw new Error(`Composition references missing source: ${item.sourceId}`);
      const durationSeconds = item.endSeconds - item.startSeconds;
      filters.push(
        `[${inputIndex}:v]trim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(durationSeconds)},setpts=PTS-STARTPTS${videoLabel}`,
      );
      filters.push(
        `[${inputIndex}:a]atrim=start=${formatSeconds(item.startSeconds)}:duration=${formatSeconds(durationSeconds)},asetpts=PTS-STARTPTS${audioLabel}`,
      );
      segments.push({
        videoLabel,
        audioLabel,
        durationSeconds,
        transitionIn: item.transitionIn,
      });
      segmentIndex += 1;
      continue;
    }

    const durationSeconds = item.durationSeconds;
    const slateText = escapeDrawtext(toSlateText(item));
    const baseColor = item.template === "announcement" ? "#1a2f58" : "#111111";
    const textColor = item.template === "announcement" ? "#f4f7ff" : "#ffffff";
    filters.push(
      `color=c=${baseColor}:s=1280x720:d=${formatSeconds(durationSeconds)},format=yuv420p,drawtext=text='${slateText}':fontcolor=${textColor}:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2${videoLabel}`,
    );
    filters.push(
      `anullsrc=r=48000:cl=stereo:d=${formatSeconds(durationSeconds)},atrim=duration=${formatSeconds(durationSeconds)},asetpts=PTS-STARTPTS${audioLabel}`,
    );
    segments.push({
      videoLabel,
      audioLabel,
      durationSeconds,
      transitionIn: item.transitionIn,
      transitionOut: item.transitionOut,
    });
    segmentIndex += 1;
  }

  if (segments.length === 0) throw new Error("Composition must contain at least one source clip or slate");

  let currentVideo = segments[0].videoLabel;
  let currentAudio = segments[0].audioLabel;
  let currentDuration = segments[0].durationSeconds;

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const next = segments[index];
    const transition = transitionForPair(previous, next);
    const nextVideo = next.videoLabel;
    const nextAudio = next.audioLabel;

    if (transition.type === "cut" || transition.durationSeconds <= 0) {
      const outVideo = `[vtmp${index}]`;
      const outAudio = `[atmp${index}]`;
      filters.push(`${currentVideo}${currentAudio}${nextVideo}${nextAudio}concat=n=2:v=1:a=1${outVideo}${outAudio}`);
      currentVideo = outVideo;
      currentAudio = outAudio;
      currentDuration += next.durationSeconds;
      continue;
    }

    const boundedDuration = Math.min(
      withDurationBoundaries(currentDuration, transition.durationSeconds),
      withDurationBoundaries(next.durationSeconds, transition.durationSeconds),
    );
    const offset = currentDuration - boundedDuration;
    const outVideo = `[vtmp${index}]`;
    const outAudio = `[atmp${index}]`;
    const videoTransition = transition.type === "fade" ? "fadeblack" : "fade";
    filters.push(`${currentVideo}${nextVideo}xfade=transition=${videoTransition}:duration=${formatSeconds(boundedDuration)}:offset=${formatSeconds(offset)}${outVideo}`);
    filters.push(`${currentAudio}${nextAudio}acrossfade=d=${formatSeconds(boundedDuration)}${outAudio}`);
    currentVideo = outVideo;
    currentAudio = outAudio;
    currentDuration = currentDuration + next.durationSeconds - boundedDuration;
  }

  const overlays = definition.composition.items.filter(
    (item): item is Extract<TimelineItem, { type: "overlay" }> => item.type === "overlay",
  );

  let finalVideo = currentVideo;
  overlays.forEach((overlay, index) => {
    const outLabel = `[ov${index}]`;
    const text = escapeDrawtext(toOverlayText(overlay));
    const color = overlay.template === "lower-third" ? "black@0.45" : "black@0.35";
    const textColor = overlay.template === "lower-third" ? "white" : "#f8f8f8";
    const start = formatSeconds(overlay.startSeconds);
    const end = formatSeconds(overlay.endSeconds);
    filters.push(
      `${finalVideo}drawbox=x=40:y=h-180:w=w-80:h=120:color=${color}:t=fill:enable='between(t,${start},${end})',drawtext=text='${text}':fontcolor=${textColor}:fontsize=36:x=70:y=h-115:enable='between(t,${start},${end})'${outLabel}`,
    );
    finalVideo = outLabel;
  });

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", finalVideo,
    "-map", currentAudio,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  );

  return { sourcePaths, outputPath, args };
}
