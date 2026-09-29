import type { CaptionStyle, RGBA } from "@/domain/caption-style";
import type { WrappedCue } from "@/renderer/caption-wrap";
import { effectiveMaxLines, layoutCues } from "@/renderer/caption-wrap";
import type { CaptionSegment } from "@/lib/captions";

/**
 * libass (like VSFilter) treats the ASS font size as the height of the whole
 * font cell (ascent + descent), while CSS font-size in the graphics editor is
 * the em size. For DejaVu Sans the cell is about 1.164 em, so the ASS size is
 * scaled up to make burned-in text as large as the editor preview.
 */
export const ASS_FONT_CELL_FACTOR = 1.16;

/** ASS colour: &HAABBGGRR& where AA is *transparency* (00 opaque). */
export function assColor(color: RGBA): string {
  const hex = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).toUpperCase().padStart(2, "0");
  return `&H${hex((1 - color.a) * 255)}${hex(color.b)}${hex(color.g)}${hex(color.r)}`;
}

/** h:mm:ss.cc (centiseconds). */
export function assTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Text of a dialogue line: override-block braces and backslashes are neutralised, lines joined with \N. */
export function assText(lines: readonly string[]): string {
  return lines.map((line) => line.replace(/\\/g, "＼").replace(/\{/g, "(").replace(/\}/g, ")")).join("\\N");
}

const num = (n: number) => String(Math.round(n * 100) / 100);

function alignment(style: CaptionStyle): number {
  const column = style.align === "left" ? 1 : style.align === "right" ? 3 : 2;
  const row = style.vertical === "top" ? 6 : style.vertical === "middle" ? 3 : 0;
  return column + row;
}

export type AssOptions = { width: number; height: number; fontName?: string };

/** Cues after wrapping/paging to the style's box, ready for buildAss. */
export function wrapCuesForStyle(cues: readonly CaptionSegment[], style: CaptionStyle): WrappedCue[] {
  const innerWidth = Math.max(1, style.width - 2 * style.padding);
  const maxLines = effectiveMaxLines(style.maxLines, style.height, style.padding, style.fontSize);
  return layoutCues(cues, innerWidth, maxLines, { fontSize: style.fontSize, bold: style.bold });
}

/** Height of the background bar for `lineCount` lines: libass line height is the font cell (see ASS_FONT_CELL_FACTOR), plus padding above and below. */
export function boxHeightFor(style: CaptionStyle, lineCount: number): number {
  return Math.min(style.height, Math.round(lineCount * style.fontSize * ASS_FONT_CELL_FACTOR + 2 * style.padding));
}

/**
 * Builds the ASS document. PlayRes equals the video size so libass does no
 * scaling. The caption box maps onto the style margins: the text is anchored
 * to the box edge given by text-align/vertical-align (numpad alignment), so
 * wrapped text grows away from that edge inside the box, `padding` inside the
 * edges. A background colour is drawn as one vector rectangle per cue (layer 0)
 * spanning the caption box width and as tall as the cue's lines need, anchored
 * to the same edge; one shape avoids the darker overlap strips that libass'
 * per-line boxes (BorderStyle 3) give with translucent colours. Outline and
 * shadow are drawn on the text (BorderStyle 1).
 */
export function buildAss(cues: readonly WrappedCue[], style: CaptionStyle, options: AssOptions): string {
  const fontName = options.fontName ?? style.fontFamily;
  const outlineColor = style.outline?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  const backColor = style.shadow?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  const marginL = style.x + style.padding;
  const marginR = Math.max(0, options.width - (style.x + style.width) + style.padding);
  const marginV = style.vertical === "top" ? style.y + style.padding : Math.max(0, options.height - (style.y + style.height) + style.padding);
  const textStyle = [
    "Caption", fontName, num(style.fontSize * ASS_FONT_CELL_FACTOR), assColor(style.color), assColor(style.color), assColor(outlineColor), assColor(backColor),
    style.bold ? -1 : 0, 0, 0, 0, 100, 100, 0, 0, 1, num(style.outline?.width ?? 0), num(style.shadow?.depth ?? 0), alignment(style),
    Math.round(marginL), Math.round(marginR), Math.round(marginV), 1,
  ].join(",");
  const boxColor = style.box ?? { r: 0, g: 0, b: 0, a: 0 };
  const boxStyle = ["CaptionBox", fontName, 20, assColor(boxColor), assColor(boxColor), assColor(boxColor), assColor(boxColor), 0, 0, 0, 0, 100, 100, 0, 0, 1, 0, 0, 7, 0, 0, 0, 1].join(",");
  // MarginV is ignored for middle alignment, so vertically centred text is placed explicitly at the box centre.
  const anchorX = style.align === "left" ? style.x + style.padding : style.align === "right" ? style.x + style.width - style.padding : style.x + style.width / 2;
  const prefix = style.vertical === "middle" ? `{\\pos(${Math.round(anchorX)},${Math.round(style.y + style.height / 2)})}` : "";
  const dialogues: string[] = [];
  for (const cue of cues) {
    if (!(cue.endSeconds > cue.startSeconds) || !cue.lines.length) continue;
    const times = `${assTime(cue.startSeconds)},${assTime(cue.endSeconds)}`;
    if (style.box) {
      const h = boxHeightFor(style, cue.lines.length);
      const top = style.vertical === "top" ? style.y : style.vertical === "middle" ? style.y + (style.height - h) / 2 : style.y + style.height - h;
      dialogues.push(`Dialogue: 0,${times},CaptionBox,,0,0,0,,{\\pos(${style.x},${Math.round(top)})\\bord0\\shad0\\p1}m 0 0 l ${style.width} 0 ${style.width} ${h} 0 ${h}`);
    }
    dialogues.push(`Dialogue: 1,${times},Caption,,0,0,0,,${prefix}${assText(cue.lines)}`);
  }
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${options.width}`, `PlayResY: ${options.height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: ${textStyle}`, `Style: ${boxStyle}`, "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...dialogues, "",
  ].join("\n");
}
