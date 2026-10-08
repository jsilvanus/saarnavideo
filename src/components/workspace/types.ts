import { type PodcastSettings } from "@/domain/project";
import { type ProjectVariable } from "@/domain/variables";
import type { Reframe } from "@/domain/reframe";
import { type Publication } from "@/components/PublishPanel";
import type { Section as SemanticSection } from "@/domain/sections";
import type { Graphic } from "@/domain/graphics";
import type { MessageKey } from "@/i18n/translate";
import type { SourceUploadSession } from "@/domain/source-upload";

export type Source = {
  id: string;
  type: "UPLOAD" | "YOUTUBE";
  status?: "PENDING" | "AVAILABLE";
  originalName?: string | null;
  youtubeUrl?: string | null;
  youtubeVideoId?: string | null;
  sizeBytes?: string | number | null;
  mimeType?: string | null;
  durationMs?: number | null;
  referenceDurationMs?: number | null;
  uploadSession?: SourceUploadSession | null;
};
export type Asset = {
  id: string;
  assetKey: string;
  type: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sizeBytes?: string;
};
export type Output = {
  id: string;
  type: string;
  preview?: boolean;
  mimeType?: string;
  language?: string | null;
  storagePath?: string;
  createdAt?: string;
};
export type CaptionMode = "none" | "soft" | "burn" | "both";
export type CaptionRequest = { mode: CaptionMode; styleGraphicId?: string };
export type Job = {
  id: string;
  type?: string | null;
  sourceId?: string | null;
  status: string;
  progress: number;
  phase?: string | null;
  etaSeconds?: number | null;
  currentMs?: string | number | null;
  totalMs?: string | number | null;
  error?: string | null;
  preview?: boolean;
  errorMessage?: string | null;
};
export type Segment = { id: string; label: string; startSeconds: number; endSeconds: number; sourceId?: string };
export type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
export type Item = {
  type: "source-clip" | "overlay" | "slate" | "audio-clip";
  assetId?: string;
  volume?: number;
  atSeconds?: number;
  duckSourceVolume?: number;
  backgroundImage?: string;
  sourceId?: string;
  graphicId?: string;
  sectionId?: string;
  startSeconds?: number;
  endSeconds?: number;
  template?: string;
  mode?: "standalone" | "overlay" | "mix";
  durationSeconds?: number;
  kind?: "text" | "rectangle" | "image";
  imageAsset?: string;
  opacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  data?: Record<string, string>;
  transitionIn?: Transition;
  transitionOut?: Transition;
  reframe?: Reframe;
};
export type Definition = {
  version?: 1;
  semanticSegments: Segment[];
  sections?: SemanticSection[];
  graphics?: Graphic[];
  template?: {
    key: string;
    width: number;
    height: number;
    fps: number;
    backgroundColor: string;
    textColor: string;
    presetKey?: string;
    targetSeconds?: number;
    reframe?: Reframe;
    endingGraphicId?: string;
    sectionOverlays?: Array<{ section: string; graphicId: string; durationSeconds: number }>;
    sectionNames?: string[];
  };
  composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] };
  podcast?: PodcastSettings;
  variables?: ProjectVariable[];
};
export type Project = {
  id: string;
  title: string;
  preacher?: string | null;
  gospelRef?: string | null;
  gospelText?: string | null;
  templateKey?: string;
  sources: Source[];
  assets?: Asset[];
  outputs?: Output[];
  publications?: Publication[];
  jobs?: Job[];
  definition?: Definition;
};
export type Step = "quick" | "source" | "structure" | "publish";
export const STEPS: Array<{ id: Step; titleKey: MessageKey; subKey: MessageKey }> = [
  { id: "quick", titleKey: "steps.quick", subKey: "steps.quick.sub" },
  { id: "source", titleKey: "steps.source", subKey: "steps.source.sub" },
  { id: "structure", titleKey: "steps.structure", subKey: "steps.structure.sub" },
  { id: "publish", titleKey: "steps.publish", subKey: "steps.publish.sub" },
];
export type DurationMismatch = {
  sourceId: string;
  originalName?: string | null;
  referenceDurationMs?: number | null;
  actualDurationMs?: number | null;
  violations?: Array<{ label: string; endSeconds: number; durationSeconds: number }>;
};

export const ACTIVE_JOB_STATUSES = ["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING", "CANCELLATION_REQUESTED"];
