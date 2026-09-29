import { z } from "zod";

export type OutputPreset = {
  key: string;
  label: string;
  group: "Landscape" | "Vertical" | "Square and portrait";
  width: number;
  height: number;
  /** Longest recommended duration in seconds; the duration notifier warns above it. */
  maxSeconds?: number;
  note?: string;
};

/** Single source of truth for output sizes, used by the size picker, the API validation and the duration notifier. */
export const OUTPUT_PRESETS: OutputPreset[] = [
  { key: "youtube-1080p", label: "YouTube / web 1080p", group: "Landscape", width: 1920, height: 1080 },
  { key: "youtube-720p", label: "YouTube / web 720p", group: "Landscape", width: 1280, height: 720 },
  { key: "youtube-4k", label: "YouTube 4K", group: "Landscape", width: 3840, height: 2160 },
  { key: "facebook-landscape", label: "Facebook landscape", group: "Landscape", width: 1280, height: 720, note: "Same picture as 720p; kept so the choice is visible in the project" },
  { key: "youtube-shorts", label: "YouTube Shorts", group: "Vertical", width: 1080, height: 1920, maxSeconds: 180 },
  { key: "instagram-reels", label: "Instagram Reels", group: "Vertical", width: 1080, height: 1920, maxSeconds: 90 },
  { key: "facebook-reels", label: "Facebook Reels", group: "Vertical", width: 1080, height: 1920, maxSeconds: 90 },
  { key: "tiktok", label: "TikTok", group: "Vertical", width: 1080, height: 1920, maxSeconds: 600 },
  { key: "instagram-story", label: "Instagram / Facebook Story", group: "Vertical", width: 1080, height: 1920, maxSeconds: 60 },
  { key: "square", label: "Square 1:1", group: "Square and portrait", width: 1080, height: 1080 },
  { key: "portrait-4-5", label: "Portrait 4:5 (feed)", group: "Square and portrait", width: 1080, height: 1350 },
];

/** Canvas graphics, caption styles and overlay pixel positions are authored on; the renderer scales them to the output size. */
export const DESIGN_CANVAS = { width: 1920, height: 1080 } as const;
export const DEFAULT_OUTPUT_SIZE = { width: 1920, height: 1080 } as const;
export const MIN_OUTPUT_DIMENSION = 128;
export const MAX_OUTPUT_DIMENSION = 7680;

export function findPreset(key: string | undefined): OutputPreset | undefined {
  return key ? OUTPUT_PRESETS.find((preset) => preset.key === key) : undefined;
}

/** Preset whose size matches, preferring the explicitly chosen key (several presets share a size). */
export function presetForSize(width: number, height: number, preferredKey?: string): OutputPreset | undefined {
  const preferred = findPreset(preferredKey);
  if (preferred && preferred.width === width && preferred.height === height) return preferred;
  return OUTPUT_PRESETS.find((preset) => preset.width === width && preset.height === height);
}

/** H.264 yuv420p needs even dimensions. */
export const evenDimension = z.number().int().min(MIN_OUTPUT_DIMENSION).max(MAX_OUTPUT_DIMENSION).refine((value) => value % 2 === 0, "Must be an even number");

export function aspectRatio(width: number, height: number): number {
  return width / height;
}

/** "16:9", "9:16", "1:1", "4:5" or "1.78:1" for anything else. */
export function aspectLabel(width: number, height: number): string {
  const known: Array<[number, number]> = [[16, 9], [9, 16], [1, 1], [4, 5], [5, 4], [4, 3], [3, 4], [21, 9]];
  for (const [w, h] of known) if (Math.abs(width / height - w / h) < 0.005) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}
