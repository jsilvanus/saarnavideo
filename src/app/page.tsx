"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import GraphicsEditor, { parseLayers } from "@/components/GraphicsEditor";
import AssetPicker from "@/components/AssetPicker";
import { findAssetUsage } from "@/domain/asset-usage";
import { SourcePlayer, useSourcePlayer } from "@/components/SourcePlayer";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { formatTime, sourceLabel } from "@/components/format";
import CompositionEditor from "@/components/CompositionEditor";
import VoiceoverPanel from "@/components/VoiceoverPanel";
import PodcastPanel from "@/components/PodcastPanel";
import { baseItemDuration, isBaseItem, type PodcastSettings, type TimelineItem } from "@/domain/project";
import SectionManager from "@/components/SectionManager";
import TranscriptionEditor from "@/components/TranscriptionEditor";
import OutputSettings from "@/components/OutputSettings";
import TimelineView from "@/components/TimelineView";
import VariablesEditor from "@/components/VariablesEditor";
import { variableNames, type ProjectVariable } from "@/domain/variables";
import { findPreset, presetForSize } from "@/domain/output-presets";
import DurationNotice from "@/components/DurationNotice";
import ReframeEditor from "@/components/ReframeEditor";
import type { Reframe } from "@/domain/reframe";
import PublishPanel, { type Publication } from "@/components/PublishPanel";
import type { Section as SemanticSection } from "@/domain/sections";
import type { Graphic } from "@/domain/graphics";
import { createCaptionGraphic, isCaptionStyleGraphic } from "@/domain/caption-style";

type Source = {
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
};
type Asset = {
  id: string;
  assetKey: string;
  type: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sizeBytes?: string;
};
type Output = {
  id: string;
  type: string;
  preview?: boolean;
  mimeType?: string;
  language?: string | null;
  storagePath?: string;
  createdAt?: string;
};
type CaptionMode = "none" | "soft" | "burn" | "both";
type CaptionRequest = { mode: CaptionMode; styleGraphicId?: string };
type Job = {
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
type Segment = { id: string; label: string; startSeconds: number; endSeconds: number; sourceId?: string };
type Transition = { type: "cut" | "fade" | "crossfade"; durationSeconds: number };
type Item = {
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
type Definition = {
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
  };
  composition: { sourceStartSeconds: number; sourceEndSeconds: number; items: Item[] };
  podcast?: PodcastSettings;
  variables?: ProjectVariable[];
};
type Project = {
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
type Step = "source" | "structure" | "publish";
const STEPS: Array<{ id: Step; title: string; sub: string }> = [
  { id: "source", title: "Lähde", sub: "Tiedot, lähteet, litteroinnit, koko" },
  { id: "structure", title: "Rakenne", sub: "Osiot, grafiikat, ääni, aikajana" },
  { id: "publish", title: "Julkaisu", sub: "Video, tiedostot, kanavat, podcast" },
];
type DurationMismatch = {
  sourceId: string;
  originalName?: string | null;
  referenceDurationMs?: number | null;
  actualDurationMs?: number | null;
  violations?: Array<{ label: string; endSeconds: number; durationSeconds: number }>;
};

const ACTIVE_JOB_STATUSES = ["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING", "CANCELLATION_REQUESTED"];

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [uploadFiles, setUploadFiles] = useState<File[]>([]),
    [uploadMode, setUploadMode] = useState<"now" | "later">("now"),
    [pendingFiles, setPendingFiles] = useState<Record<string, File>>({}),
    [youtubeUrl, setYoutubeUrl] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null),
    [assetKey, setAssetKey] = useState(""),
    [assetType, setAssetType] = useState("OVERLAY"),
    [libraryOpen, setLibraryOpen] = useState(false),
    [removeAsset, setRemoveAsset] = useState<{ asset: Asset; usage: string[] } | null>(null);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [captionMode, setCaptionMode] = useState<CaptionMode>("none"),
    [captionStyleId, setCaptionStyleId] = useState(""),
    [menuId, setMenuId] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState<Project | null>(null),
    [durationMismatch, setDurationMismatch] = useState<DurationMismatch | null>(null),
    [acceptedClamp, setAcceptedClamp] = useState(false),
    [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null),
    [confirmDeleteGraphicId, setConfirmDeleteGraphicId] = useState<string | null>(null),
    [previewBusy, setPreviewBusy] = useState(false);

  async function withBusy(fallback: string, fn: () => Promise<void>, setFlag: (busy: boolean) => void = setBusy) {
    setFlag(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setFlag(false);
    }
  }
  async function refreshProjects() {
    const r = await fetch("/api/projects", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as Project[];
    setProjects(data);
    if (selectedId && !data.some((p) => p.id === selectedId)) {
      setSelected(null);
      setSelectedId(null);
    }
    if (!selectedId && data[0]) await openProject(data[0].id);
  }
  async function openProject(id: string) {
    const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setError("Could not load project");
      return;
    }
    setSelected((await r.json()) as Project);
    setSelectedId(id);
    setMessage("");
    setError("");
    setSelectedGraphicId(null);
  }
  useEffect(() => {
    void refreshProjects();
  }, []);
  async function createProject(e: FormEvent) {
    e.preventDefault();
    await withBusy("Project creation failed", async () => {
      setError("");
      const data = await requestJson<{ id: string }>(
        "/api/projects",
        jsonInit("POST", { title, templateKey: "basic" }),
        "Project creation failed",
      );
      setCreating(false);
      setTitle("");
      await refreshProjects();
      await openProject(data.id);
      setMessage("Project created.");
    });
  }
  async function duplicateProject(project: Project) {
    setMenuId(null);
    await withBusy("Could not duplicate project", async () => {
      const data = await requestJson<{ id?: string; project?: { id: string } }>(
        `/api/projects/${project.id}/duplicate`,
        { method: "POST" },
        "Could not duplicate project",
      );
      await refreshProjects();
      await openProject((data.id ?? data.project?.id)!);
      setMessage("Project duplicated.");
    });
  }
  async function deleteProject() {
    if (!confirmDelete) return;
    const p = confirmDelete;
    setConfirmDelete(null);
    setMenuId(null);
    await withBusy("Could not delete project", async () => {
      await requestJson(`/api/projects/${p.id}`, { method: "DELETE" }, "Could not delete project");
      await refreshProjects();
      setMessage("Project deleted.");
    });
  }
  async function getVideoDurationMs(file: File) {
    return new Promise<number | undefined>((resolve) => {
      const url = URL.createObjectURL(file),
        video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const n = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
        URL.revokeObjectURL(url);
        resolve(n);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      video.src = url;
    });
  }
  async function sourceUploadForm(file: File) {
    const form = new FormData();
    form.set("file", file);
    const d = await getVideoDurationMs(file);
    if (d !== undefined) form.set("durationMs", String(d));
    return form;
  }
  async function addUploads() {
    if (!selected || !uploadFiles.length) return;
    await withBusy("Upload failed", async () => {
      for (const file of uploadFiles)
        await requestJson(`/api/projects/${selected.id}/source`, { method: "POST", body: await sourceUploadForm(file) }, "Upload failed");
      setUploadFiles([]);
      await openProject(selected.id);
      setMessage("Source(s) uploaded.");
    });
  }
  async function addDeferredUploads() {
    if (!selected || !uploadFiles.length) return;
    await withBusy("Could not add local source", async () => {
      for (const file of uploadFiles) {
        const data = await requestJson<{ id: string }>(
          `/api/projects/${selected.id}/source`,
          jsonInit("POST", { localFileName: file.name }),
          "Could not add local source",
        );
        setPendingFiles((p) => ({ ...p, [data.id]: file }));
      }
      setUploadFiles([]);
      await openProject(selected.id);
      setMessage("Pending local source added.");
    });
  }
  async function uploadPendingSource(source: Source) {
    if (!selected) return false;
    const file = pendingFiles[source.id];
    if (!file) {
      setError(`Choose the local file for “${source.originalName || source.id}” first.`);
      return false;
    }
    const r = await fetch(`/api/projects/${selected.id}/source/${source.id}`, { method: "PUT", body: await sourceUploadForm(file) });
    const data = await r.json();
    if (!r.ok) {
      setError(data.error ?? "Upload failed");
      return false;
    }
    setPendingFiles((p) => {
      const n = { ...p };
      delete n[source.id];
      return n;
    });
    await openProject(selected.id);
    if (data.durationWarning) {
      setDurationMismatch({
        sourceId: source.id,
        originalName: source.originalName,
        referenceDurationMs: data.durationWarning.referenceDurationMs,
        actualDurationMs: data.durationWarning.actualDurationMs,
      });
      return false;
    }
    return true;
  }
  async function addYoutube() {
    if (!selected || !youtubeUrl.trim()) return;
    await withBusy("Could not add YouTube source", async () => {
      await requestJson(`/api/projects/${selected.id}/source`, jsonInit("POST", { youtubeUrl }), "Could not add YouTube source");
      setYoutubeUrl("");
      await openProject(selected.id);
      setMessage("YouTube source added.");
    });
  }
  function currentDefinition(): Definition {
    return (
      selected?.definition ?? {
        version: 1,
        semanticSegments: [],
        sections: [],
        graphics: [],
        template: {
          key: selected?.templateKey ?? "basic",
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: "black",
          textColor: "white",
        },
        composition: { sourceStartSeconds: 0, sourceEndSeconds: 0.001, items: [] },
      }
    );
  }
  async function saveDefinition(definition: Definition) {
    if (!selected) return;
    const updated = await requestJson<Partial<Project>>(
      `/api/projects/${selected.id}`,
      jsonInit("PATCH", { definition }),
      "Could not save project",
    );
    setSelected((p) => (p ? { ...p, ...updated, definition: updated.definition ?? definition } : p));
  }
  async function addSegment(sourceId: string, label: string, start: number, end: number) {
    if (!selected || !(end > start)) {
      setError("End must be greater than start.");
      return;
    }
    const def = currentDefinition();
    const segment = { id: crypto.randomUUID(), label: label || "Section", startSeconds: start, endSeconds: end, sourceId };
    const section = { ...segment, scope: "SOURCE" as const, origin: "MANUAL" as const };
    await saveDefinition({
      ...def,
      semanticSegments: [...def.semanticSegments, segment],
      sections: [...(def.sections ?? []), section],
      composition: {
        ...def.composition,
        sourceStartSeconds: Math.min(def.composition.sourceStartSeconds, start),
        sourceEndSeconds: Math.max(def.composition.sourceEndSeconds, end),
        items: [...def.composition.items, { type: "source-clip", sourceId, startSeconds: start, endSeconds: end }],
      },
    });
    setMessage("Section saved.");
  }
  async function removeSegment(id: string) {
    const def = currentDefinition(),
      s = def.semanticSegments.find((x) => x.id === id);
    if (!s) return;
    await saveDefinition({
      ...def,
      semanticSegments: def.semanticSegments.filter((x) => x.id !== id),
      sections: (def.sections ?? []).filter((x) => x.id !== id && x.parentId !== id),
      composition: {
        ...def.composition,
        items: def.composition.items.filter(
          (i) =>
            !(
              i.type === "source-clip" &&
              i.sourceId === s.sourceId &&
              i.startSeconds === s.startSeconds &&
              i.endSeconds === s.endSeconds
            ) && !(i.type === "overlay" && i.sectionId === id),
        ),
      },
    });
  }
  async function saveSections(sections: SemanticSection[]) {
    const def = currentDefinition();
    await saveDefinition({ ...def, sections });
  }
  async function saveVariables(variables: ProjectVariable[]) {
    await saveDefinition({ ...currentDefinition(), variables });
    setMessage("Muuttujat tallennettu.");
  }
  async function saveTitle(title: string) {
    if (!selected) return;
    const updated = await requestJson<Partial<Project>>(`/api/projects/${selected.id}`, jsonInit("PATCH", { title }), "Otsikkoa ei voitu tallentaa");
    setSelected((p) => (p ? { ...p, title: updated.title ?? title } : p));
    setProjects((list) => list.map((p) => (p.id === selected.id ? { ...p, title: updated.title ?? title } : p)));
  }
  /** Moves a source section (and its subsections) to another source; the composition clips cut from it follow. */
  async function changeSectionSource(id: string, sourceId: string) {
    const def = currentDefinition();
    const section = def.sections?.find((x) => x.id === id);
    if (!section || section.sourceId === sourceId) return;
    const ids = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of def.sections ?? []) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
    }
    const moved = (def.sections ?? []).filter((x) => ids.has(x.id));
    const cutFrom = (i: Item) =>
      i.type === "source-clip" && moved.some((x) => x.sourceId === i.sourceId && x.startSeconds === i.startSeconds && x.endSeconds === i.endSeconds);
    await saveDefinition({
      ...def,
      sections: (def.sections ?? []).map((x) => (ids.has(x.id) ? { ...x, sourceId } : x)),
      semanticSegments: def.semanticSegments.map((x) => (ids.has(x.id) ? { ...x, sourceId } : x)),
      composition: { ...def.composition, items: def.composition.items.map((i) => (cutFrom(i) ? { ...i, sourceId } : i)) },
    });
    setMessage(`Osio “${section.label}” käyttää nyt lähdettä ${sourceNames[sourceId] ?? sourceId}.`);
  }
  async function saveOutput(patch: Record<string, unknown>) {
    const def = currentDefinition(),
      next = { ...(def.template ?? currentDefinition().template!), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
    await saveDefinition({ ...def, template: next as Definition["template"] });
    setMessage("Tulosteen asetukset tallennettu.");
  }
  async function saveSectionReframe(id: string, reframe: Reframe | undefined) {
    const def = currentDefinition();
    await saveDefinition({
      ...def,
      sections: (def.sections ?? []).map((x) => {
        if (x.id !== id) return x;
        const { reframe: _old, ...rest } = x;
        return reframe ? { ...rest, reframe } : rest;
      }),
    });
    setMessage("Rajaus tallennettu.");
  }
  const durationNotice = selected ? <DurationNotice definition={currentDefinition()} assets={selected.assets} /> : null;
  function compositionDurationSeconds() {
    return (currentDefinition().composition.items as TimelineItem[])
      .filter(isBaseItem)
      .reduce((total, item) => total + Math.max(0, baseItemDuration(item)), 0);
  }
  async function refreshAssets() {
    if (!selected) return;
    const r = await fetch(`/api/projects/${selected.id}`, { cache: "no-store" });
    if (!r.ok) return;
    const p = (await r.json()) as Project;
    setSelected((cur) => (cur && cur.id === p.id ? { ...cur, assets: p.assets } : cur));
  }
  function askRemoveAsset(asset: Asset) {
    setRemoveAsset({ asset, usage: selected ? findAssetUsage(currentDefinition(), asset) : [] });
  }
  async function confirmRemoveAsset() {
    if (!selected || !removeAsset) return;
    const { asset } = removeAsset;
    setRemoveAsset(null);
    await withBusy("Could not remove the asset from the project", async () => {
      await requestJson(
        `/api/projects/${selected.id}/assets/${asset.id}?force=1`,
        { method: "DELETE" },
        "Could not remove the asset from the project",
      );
      await refreshAssets();
      setMessage(`“${asset.assetKey}” removed from this project. It is still in the library.`);
    });
  }
  async function uploadAsset() {
    if (!selected || !assetFile || !assetKey.trim()) {
      setError("Choose an image and give it an asset key.");
      return;
    }
    await withBusy("Asset upload failed", async () => {
      const form = new FormData();
      form.set("file", assetFile);
      form.set("assetKey", assetKey.trim());
      form.set("type", assetType);
      await requestJson(`/api/projects/${selected.id}/assets`, { method: "POST", body: form }, "Asset upload failed");
      setAssetFile(null);
      setAssetKey("");
      await openProject(selected.id);
      setMessage("Graphic asset uploaded.");
    });
  }
  async function createGraphic() {
    if (!selected) return;
    const def = currentDefinition();
    const graphic: Graphic = {
      id: crypto.randomUUID(),
      name: `Graphic ${(def.graphics?.length ?? 0) + 1}`,
      width: 1920,
      height: 1080,
      backgroundColor: "transparent",
      layers: [
        {
          id: "title",
          type: "text",
          x: 160,
          y: 300,
          width: 1600,
          height: 180,
          rotation: 0,
          text: selected.title,
          style: { "font-size": "92px", "font-weight": "700", color: "#ffffff", "text-align": "center", "text-shadow": "0 3px 10px #000" },
        },
      ],
    };
    await saveDefinition({ ...def, graphics: [...(def.graphics ?? []), graphic] });
    setSelectedGraphicId(graphic.id);
    setMessage("Graphic created.");
  }
  const captionStyles = (selected?.definition?.graphics ?? []).filter(isCaptionStyleGraphic);
  function captionRequest(): CaptionRequest {
    const burn = captionMode === "burn" || captionMode === "both";
    return burn && captionStyleId && captionStyles.some((g) => g.id === captionStyleId)
      ? { mode: captionMode, styleGraphicId: captionStyleId }
      : { mode: captionMode };
  }
  async function createCaptionStyle() {
    if (!selected) return;
    const def = currentDefinition();
    const graphic = createCaptionGraphic(
      crypto.randomUUID(),
      `Caption style ${(def.graphics ?? []).filter(isCaptionStyleGraphic).length + 1}`,
      def.template?.width ?? 1920,
      def.template?.height ?? 1080,
    );
    await saveDefinition({ ...def, graphics: [...(def.graphics ?? []), graphic] });
    setStep("structure");
    setSelectedGraphicId(graphic.id);
    setCaptionStyleId(graphic.id);
    setMessage("Caption style created. Move and style the caption box in the editor; it is used for burned-in captions.");
  }
  async function duplicateGraphic(id: string) {
    const def = currentDefinition(),
      source = def.graphics?.find((g) => g.id === id);
    if (!source) return;
    const copy: Graphic = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
      layers: source.layers.map((l) => ({ ...l, id: `${l.type}-${crypto.randomUUID()}` })),
    };
    await saveDefinition({ ...def, graphics: [...(def.graphics ?? []), copy] });
    setSelectedGraphicId(copy.id);
    setMessage("Graphic duplicated.");
  }
  async function updateGraphic(id: string, item: Item) {
    const def = currentDefinition();
    const graphic = def.graphics?.find((g) => g.id === id);
    if (!graphic) return;
    const layers = parseLayers<Graphic["layers"][number]>(item.data?.layers) ?? graphic.layers;
    await saveDefinition({ ...def, graphics: (def.graphics ?? []).map((g) => (g.id === id ? { ...g, layers } : g)) });
  }
  async function deleteGraphic(id: string) {
    const def = currentDefinition();
    if ((def.composition.items ?? []).some((i) => i.graphicId === id)) {
      setError("This graphic is used in the composition. Remove its uses there first.");
      return;
    }
    await saveDefinition({ ...def, graphics: (def.graphics ?? []).filter((g) => g.id !== id) });
    setSelectedGraphicId(null);
    setConfirmDeleteGraphicId(null);
  }
  async function stopJob(job: Job) {
    if (!selected) return;
    try {
      await requestJson(`/api/projects/${selected.id}/jobs/${job.id}/cancel`, { method: "POST" }, "Could not stop generation");
      setMessage("Generation stop requested.");
      await openProject(selected.id);
    } catch (e) {
      setError(errorMessage(e, "Could not stop generation"));
    }
  }
  async function uploadPendingSources() {
    if (!selected) return false;
    for (const s of selected.sources.filter((s) => s.type === "UPLOAD" && s.status === "PENDING"))
      if (!(await uploadPendingSource(s))) return false;
    return true;
  }
  /** Queues a full or preview render; returns the job response, or null when stopped by a pending upload or a duration mismatch. */
  async function queueGeneration(preview: boolean, fallback: string, captions: CaptionRequest = { mode: "none" }) {
    if (!selected || !(await uploadPendingSources())) return null;
    const r = await fetch(
      `/api/projects/${selected.id}/generate`,
      jsonInit("POST", preview ? { allowClamping: acceptedClamp, preview: true, captions } : { allowClamping: acceptedClamp, captions }),
    );
    const data = await r.json();
    if (!r.ok) {
      if (data.code === "SOURCE_DURATION_MISMATCH") {
        const sourceId = data.violations?.[0]?.sourceId;
        setDurationMismatch({
          sourceId: sourceId ?? "",
          originalName: selected.sources.find((s) => s.id === sourceId)?.originalName,
          violations: data.violations,
        });
        return null;
      }
      throw new Error(data.error ?? fallback);
    }
    return data as { id: string; clamped?: boolean; durationWarnings?: Array<{ message: string }> };
  }
  function withWarnings(text: string, data: { durationWarnings?: Array<{ message: string }> }) {
    return data.durationWarnings?.length ? `${text} ${data.durationWarnings.map((w) => w.message).join(" ")}` : text;
  }
  async function generate() {
    if (!selected) return;
    await withBusy("Generation failed", async () => {
      const data = await queueGeneration(false, "Could not queue generation", captionRequest());
      if (!data) return;
      setAcceptedClamp(false);
      setStep("publish");
      setMessage(
        withWarnings(
          data.clamped
            ? "Generation queued; affected sections will end at EOF as explicitly requested."
            : `Generation queued (${data.id}).`,
          data,
        ),
      );
      await openProject(selected.id);
    });
  }
  async function previewRender() {
    if (!selected) return;
    setError("");
    await withBusy(
      "Preview failed",
      async () => {
        const data = await queueGeneration(true, "Could not queue preview", captionRequest());
        if (!data) return;
        setStep("publish");
        setMessage(withWarnings(`Preview render queued (${data.id}).`, data));
        await openProject(selected.id);
      },
      setPreviewBusy,
    );
  }
  const sourceNames = useMemo(() => Object.fromEntries((selected?.sources ?? []).map((s) => [s.id, sourceLabel(s)])), [selected]);
  const selectedGraphic = selectedGraphicId ? selected?.definition?.graphics?.find((g) => g.id === selectedGraphicId) : undefined;
  const editorItem = useMemo(
    () =>
      selectedGraphic
        ? {
            type: "slate" as const,
            template: "rich",
            mode: "standalone" as const,
            durationSeconds: 5,
            data: { layers: JSON.stringify(selectedGraphic.layers) },
          }
        : undefined,
    [selectedGraphic],
  );
  const activeJob = selected?.jobs?.find((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const previewJob = selected?.jobs?.find((j) => j.preview && ACTIVE_JOB_STATUSES.includes(j.status));
  const latestPreview = selected?.outputs?.find((o) => o.preview && o.type === "VIDEO");
  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">SaarnaVideo</div>
        <button className="new" onClick={() => setCreating(true)}>
          ＋ Uusi projekti
        </button>
        <div className="projects">
          {projects.map((p) => (
            <div key={p.id} className={`project ${selectedId === p.id ? "selected" : ""}`}>
              <button className="project-main" onClick={() => void openProject(p.id)}>
                <strong>{p.title}</strong>
              </button>
              <button className="more" aria-label={`Toiminnot: ${p.title}`} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
                ⋯
              </button>
              {menuId === p.id && (
                <div className="menu">
                  <button onClick={() => void duplicateProject(p)}>Monista</button>
                  <button
                    className="danger"
                    onClick={() => {
                      setConfirmDelete(p);
                      setMenuId(null);
                    }}
                  >
                    Poista…
                  </button>
                </div>
              )}
            </div>
          ))}
          {!projects.length && <p className="muted">Ei vielä projekteja.</p>}
        </div>
      </aside>
      <section className="workspace">
        {!selected ? (
          <div className="empty">
            <h1>Luo projekti</h1>
            <button onClick={() => setCreating(true)}>＋ Uusi projekti</button>
          </div>
        ) : (
          <>
            <header>
              <div>
                <h1>{selected.title}</h1>
                <p className="muted">
                  {selected.sources.length} {selected.sources.length === 1 ? "lähde" : "lähdettä"} · {outputSizeLabel(currentDefinition().template)}
                </p>
              </div>
              <div className="header-actions">
                <button disabled={previewBusy || busy} onClick={() => void previewRender()}>
                  {previewBusy ? "Esikatselu jonoon…" : "Esikatselu"}
                </button>
                <button className="primary" disabled={busy} onClick={() => void generate()}>
                  Tee video
                </button>
              </div>
            </header>
            <nav className="stepper" aria-label="Työvaiheet">
              {STEPS.map((s, index) => (
                <button key={s.id} className={step === s.id ? "active" : ""} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)}>
                  <span className="step-badge">{index + 1}</span>
                  <span className="step-text">
                    <strong>{s.title}</strong>
                    <small>{s.sub}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="content">
              {step === "source" && (
                <div className="step-grid">
                  <div className="step-main">
                    <Panel title="Lähteet" text="Yksi tai useampi tallenne. Paikallisen tiedoston voi ladata heti tai myöhemmin; YouTube-lähde noudetaan, kun video tehdään.">
                      <div className="form-grid">
                        <label>
                          Paikalliset videot
                          <input type="file" accept="video/*" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))} />
                          <select value={uploadMode} onChange={(e) => setUploadMode(e.target.value as "now" | "later")}>
                            <option value="now">Lataa nyt</option>
                            <option value="later">Lataa myöhemmin</option>
                          </select>
                          <button
                            onClick={() => void (uploadMode === "now" ? addUploads() : addDeferredUploads())}
                            disabled={busy || !uploadFiles.length}
                          >
                            {uploadMode === "now" ? "Lataa valitut" : "Lisää odottava lähde"}
                          </button>
                        </label>
                        <label>
                          YouTube-linkki
                          <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
                          <button onClick={() => void addYoutube()} disabled={busy || !youtubeUrl.trim()}>
                            Lisää YouTube-lähde
                          </button>
                        </label>
                      </div>
                      <div className="cards">
                        {selected.sources.map((s) => (
                          <article className="card" key={s.id}>
                            <b>
                              {s.type === "YOUTUBE" ? "YouTube" : "Tiedosto"} · {s.status === "PENDING" ? "odottaa tiedostoa" : "valmis"}
                            </b>
                            <strong>{sourceLabel(s)}</strong>
                            <small>
                              {s.status === "PENDING"
                                ? "Odottaa paikallista tiedostoa. Valitse varsinainen tiedosto, kun se on valmis."
                                : s.durationMs
                                  ? `Kesto ${formatTime(s.durationMs / 1000)}`
                                  : "YouTube-video noudetaan, kun video tehdään."}
                            </small>
                            {s.status === "PENDING" && (
                              <div className="pending-upload">
                                <input
                                  type="file"
                                  accept="video/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) setPendingFiles((p) => ({ ...p, [s.id]: f }));
                                  }}
                                />
                                <button onClick={() => void uploadPendingSource(s)} disabled={busy || !pendingFiles[s.id]}>
                                  Lataa nyt
                                </button>
                                {pendingFiles[s.id] && <small>Valittu: {pendingFiles[s.id].name}</small>}
                              </div>
                            )}
                          </article>
                        ))}
                        {!selected.sources.length && <p className="muted">Ei vielä lähteitä.</p>}
                      </div>
                    </Panel>
                    <Panel title="Litteroinnit" text="Litteroi lähde kokonaan tai valitulta väliltä ja muokkaa tekstitysraitaa. Litterointi kuuluu lähteelle, joten se näkyy kaikissa projekteissa, jotka käyttävät samaa lähdettä.">
                      <TranscriptionEditor
                        projectId={selected.id}
                        sources={selected.sources}
                        pendingFiles={pendingFiles}
                        jobs={selected.jobs ?? []}
                        sections={selected.definition?.sections}
                        onProjectRefresh={() => void openProject(selected.id)}
                      />
                    </Panel>
                    <Panel title="Tulosteen koko" text="Videon koko ja oletusrajaus. Rajauksen voi vaihtaa osioittain vaiheessa Rakenne.">
                      <OutputSettings template={currentDefinition().template!} onChange={saveOutput} />
                    </Panel>
                  </div>
                  <aside className="step-aside">
                    <Panel title="Projektin tiedot">
                      <ProjectTitle title={selected.title} onSave={saveTitle} />
                      <h3 className="subhead">Muuttujat</h3>
                      <p className="muted">Grafiikat käyttävät muuttujia muodossa {"{{nimi}}"}. Arvot täytetään, kun video tehdään.</p>
                      <VariablesEditor variables={currentDefinition().variables ?? []} graphics={selected.definition?.graphics} onSave={saveVariables} />
                    </Panel>
                  </aside>
                </div>
              )}
              {step === "structure" && (
                <div className="step-stack">
                  <Panel title="Osiot" text="Osiot jäsentävät tallenteen. Jokainen osio valitsee lähteensä ja rajauksensa. Luo ensin luettelo ja sijoita se, kun lähteen kohta tiedetään.">
                    <SectionManager
                      scope="SOURCE"
                      sections={selected.definition?.sections ?? []}
                      sources={selected.sources}
                      onChange={saveSections}
                      renderActions={(section) => (
                        <>
                          {section.scope === "SOURCE" && !section.parentId && selected.sources.length > 1 && (
                            <select
                              aria-label={`Lähde: ${section.label}`}
                              className="inline-select"
                              value={section.sourceId ?? ""}
                              onChange={(e) => void changeSectionSource(section.id, e.target.value)}
                            >
                              {selected.sources.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {sourceLabel(s)}
                                </option>
                              ))}
                            </select>
                          )}
                          {section.startSeconds !== undefined && (
                            <ReframeEditor
                              title={`Osio “${section.label}”`}
                              current={section.reframe}
                              defaultLabel="Projektin oletus"
                              source={selected.sources.find((x) => x.id === section.sourceId)}
                              atSeconds={section.startSeconds}
                              outWidth={currentDefinition().template?.width ?? 1920}
                              outHeight={currentDefinition().template?.height ?? 1080}
                              onSave={(r) => saveSectionReframe(section.id, r)}
                            />
                          )}
                        </>
                      )}
                    />
                    <SectionPicker
                      projectId={selected.id}
                      sources={selected.sources}
                      pendingFiles={pendingFiles}
                      onAdd={(id, l, s, e) => void addSegment(id, l, s, e)}
                    />
                    <div className="list">
                      {(selected.definition?.semanticSegments ?? []).map((s) => (
                        <div className="row" key={s.id}>
                          <span>
                            <strong>{s.label}</strong>
                            <small>
                              {sourceNames[s.sourceId ?? ""] ?? "lähde"} · {formatTime(s.startSeconds)} → {formatTime(s.endSeconds)}
                            </small>
                          </span>
                          <button onClick={() => void removeSegment(s.id)}>Poista</button>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title="Grafiikat" text="Uudelleenkäytettävät grafiikat. Aikajanalla päätetään, tuleeko grafiikasta oma välikuva vai kuvan päälle tuleva grafiikka. Tekstiin voi kirjoittaa projektin muuttujia, esim. {{saarnaaja}}.">
                    <div className="form-grid four">
                      <label>
                        Kuvatiedosto
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)} />
                      </label>
                      <label>
                        Nimi
                        <input value={assetKey} onChange={(e) => setAssetKey(e.target.value)} placeholder="logo" />
                      </label>
                      <label>
                        Tyyppi
                        <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
                          <option value="OVERLAY">Päällyskuva</option>
                          <option value="BACKGROUND">Tausta</option>
                          <option value="LOGO">Logo</option>
                        </select>
                      </label>
                      <button onClick={() => void uploadAsset()} disabled={busy}>
                        Lataa kuva
                      </button>
                    </div>
                    <div className="button-row">
                      <button data-testid="add-from-library" onClick={() => setLibraryOpen(true)}>
                        Lisää kirjastosta
                      </button>
                      <button className="primary" onClick={() => void createGraphic()}>
                        ＋ Uusi grafiikka
                      </button>
                      <button onClick={() => void createCaptionStyle()}>＋ Uusi tekstitystyyli</button>
                    </div>
                    <div className="graphic-list">
                      {(selected.definition?.graphics ?? []).map((g) => (
                        <button key={g.id} className={selectedGraphicId === g.id ? "graphic-selected" : ""} onClick={() => setSelectedGraphicId(g.id)}>
                          <strong>{g.name}</strong>
                          <small>
                            {g.width} × {g.height}
                            {isCaptionStyleGraphic(g) ? " · tekstitystyyli" : ""}
                            {graphicVariables(g).length ? ` · ${graphicVariables(g).map((n) => `{{${n}}}`).join(" ")}` : ""}
                          </small>
                        </button>
                      ))}
                      {!selected.definition?.graphics?.length && <p className="muted">Ei vielä grafiikoita.</p>}
                    </div>
                    {selectedGraphic && editorItem && (
                      <>
                        <div className="graphic-editor-header" id="graphic-editor">
                          <div>
                            <strong>{selectedGraphic.name}</strong>
                            <small>
                              {selectedGraphic.width} × {selectedGraphic.height}
                            </small>
                          </div>
                          <div className="graphic-editor-actions">
                            <button
                              className="icon-button"
                              title="Monista grafiikka"
                              aria-label="Monista grafiikka"
                              onClick={() => void duplicateGraphic(selectedGraphic.id)}
                            >
                              ⧉
                            </button>
                            <button
                              className="icon-button danger-icon"
                              title="Poista grafiikka"
                              aria-label="Poista grafiikka"
                              onClick={() => setConfirmDeleteGraphicId(selectedGraphic.id)}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                        <GraphicsEditor
                          projectId={selected.id}
                          graphicId={selectedGraphic.id}
                          item={editorItem}
                          assets={selected.assets ?? []}
                          title={selectedGraphic.name}
                          onChange={(item) => void updateGraphic(selectedGraphic.id, item)}
                          onAssetsChanged={refreshAssets}
                        />
                      </>
                    )}
                    <div className="cards">
                      {(selected.assets ?? []).map((a) => (
                        <article className="card" key={a.id}>
                          <b>{a.type}</b>
                          <strong>{a.assetKey}</strong>
                          <small>
                            {a.type === "AUDIO" ? "Ääni" : `${a.width} × ${a.height}`} · {a.mimeType}
                          </small>
                          <button data-testid="remove-asset" onClick={() => askRemoveAsset(a)} disabled={busy}>
                            Poista projektista
                          </button>
                        </article>
                      ))}
                    </div>
                    {libraryOpen && (
                      <AssetPicker
                        projectId={selected.id}
                        title="Lisää kirjastosta"
                        linkedIds={(selected.assets ?? []).map((a) => a.id)}
                        pickLinked={false}
                        onPick={async () => {
                          await refreshAssets();
                          setMessage("Lisätty projektiin.");
                        }}
                        onClose={() => setLibraryOpen(false)}
                      />
                    )}
                  </Panel>
                  <Panel title="Ääni" text="Äänitä spiikki selaimessa tai lataa äänitiedosto. Sen voi lisätä omaksi osiokseen tai miksata videon päälle.">
                    <VoiceoverPanel
                      projectId={selected.id}
                      assets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
                      definition={currentDefinition()}
                      onSaveDefinition={async (def) => {
                        await saveDefinition(def as Definition);
                      }}
                      onChanged={() => openProject(selected.id)}
                    />
                  </Panel>
                  <Panel title="Aikajana" text="Valmiin videon kuva, grafiikat ja ääni samalla aikajanalla. Työpöydällä vaakana, puhelimessa pystynä; suunnan voi vaihtaa.">
                    {durationNotice}
                    <TimelineView
                      items={currentDefinition().composition.items}
                      graphics={selected.definition?.graphics}
                      sections={selected.definition?.sections}
                      sources={selected.sources}
                      audioAssets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
                    />
                    <h3 className="subhead">Muokkaa koostusta</h3>
                    <CompositionEditor
                      definition={currentDefinition()}
                      sources={selected.sources}
                      audioAssets={(selected.assets ?? []).filter((a) => a.type === "AUDIO")}
                      onChange={async (def) => {
                        await saveDefinition(def as Definition);
                        setMessage("Koostus tallennettu.");
                      }}
                    />
                    <details className="composition-sections">
                      <summary>Koostuksen omat osiot</summary>
                      <SectionManager
                        scope="COMPOSITION"
                        sections={selected.definition?.sections ?? []}
                        durationSeconds={compositionDurationSeconds()}
                        onChange={saveSections}
                      />
                    </details>
                  </Panel>
                </div>
              )}
              {step === "publish" && (
                <div className="step-grid">
                  <div className="step-main">
                    <Panel title="Tee video" text="Lisää video työjonoon. Lyhyempi korvaava lähde ei koskaan muuta tallennettuja aikoja huomaamatta; katkaisu tiedoston loppuun vaatii vahvistuksen.">
                      {durationNotice}
                      <div className="job">
                        <label className="muted">
                          Tekstitys{" "}
                          <select value={captionMode} onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}>
                            <option value="none">Ei tekstitystä</option>
                            <option value="soft">Valittava raita (sekä SRT/VTT-tiedostot)</option>
                            <option value="burn">Poltettu kuvaan</option>
                            <option value="both">Molemmat</option>
                          </select>
                        </label>
                        {(captionMode === "burn" || captionMode === "both") && (
                          <div className="caption-style-row">
                            <label className="muted">
                              Tekstitystyyli{" "}
                              <select
                                value={captionStyles.some((g) => g.id === captionStyleId) ? captionStyleId : ""}
                                onChange={(e) => setCaptionStyleId(e.target.value)}
                              >
                                <option value="">Oletus (alhaalla keskellä, valkoinen tummalla)</option>
                                {captionStyles.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button onClick={() => void createCaptionStyle()}>＋ Uusi tekstitystyyli</button>
                            {captionStyles.some((g) => g.id === captionStyleId) && (
                              <button
                                onClick={() => {
                                  setStep("structure");
                                  setSelectedGraphicId(captionStyleId);
                                }}
                              >
                                Muokkaa tyyliä
                              </button>
                            )}
                            <small className="muted">Sijainti, koko, fontti ja tausta tulevat grafiikan tekstitystasolta. Esikatselu käyttää samaa asetusta.</small>
                          </div>
                        )}
                        <div className="button-row">
                          <button disabled={previewBusy || busy} onClick={() => void previewRender()}>
                            {previewBusy ? "Esikatselu jonoon…" : "Nopea esikatselu (640 px)"}
                          </button>
                          <button className="primary" disabled={busy} onClick={() => void generate()}>
                            Tee lopullinen video
                          </button>
                        </div>
                        {selected.jobs?.map((j) => (
                          <div key={j.id} className="job-row">
                            <strong>
                              {j.preview ? "Esikatselu " : ""}
                              {j.type === "PODCAST" ? "Podcast " : ""}
                              {j.status}
                            </strong>
                            <span>{j.progress}%</span>
                            {j.errorMessage && <small>{j.errorMessage}</small>}
                            {["QUEUED", "ACQUIRING_SOURCE", "PROCESSING", "RENDERING"].includes(j.status) && (
                              <button className="stop-button" onClick={() => void stopJob(j)}>
                                Pysäytä
                              </button>
                            )}
                          </div>
                        ))}
                        {!selected.jobs?.length && <p className="muted">Ei vielä töitä.</p>}
                        {activeJob && <small className="muted">Käynnissä: {activeJob.progress}% · pysäytys on turvallinen.</small>}
                      </div>
                    </Panel>
                    <Panel title="Esikatselu">
                      <div className="preview-panel">
                        {latestPreview ? (
                          <video controls preload="metadata" src={`/api/outputs/${latestPreview.id}`} />
                        ) : (
                          <div className="preview-empty">
                            <strong>Esikatselua ei ole vielä tehty.</strong>
                            <p>Tee nopea esikatselu, kun koostus on valmis.</p>
                          </div>
                        )}
                        {previewJob && (
                          <span className="muted">
                            Esikatselu: {previewJob.status} · {previewJob.progress}%
                          </span>
                        )}
                      </div>
                    </Panel>
                    <Panel title="Valmiit tiedostot">
                      {selected.outputs?.length ? (
                        <div className="downloads">
                          {selected.outputs.map((o) => (
                            <a key={o.id} href={`/api/outputs/${o.id}`}>
                              {outputLabel(o)} ↓
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">Ei vielä valmiita tiedostoja.</p>
                      )}
                    </Panel>
                  </div>
                  <aside className="step-aside">
                    <Panel title="Julkaise">
                      <PublishPanel
                        projectId={selected.id}
                        publications={selected.publications ?? []}
                        hasVideo={!!selected.outputs?.some((o) => o.type === "VIDEO" && !o.preview)}
                        onRefresh={() => void openProject(selected.id)}
                      />
                    </Panel>
                    <Panel title="Podcast">
                      <PodcastPanel
                        projectId={selected.id}
                        projectTitle={selected.title}
                        preacher={selected.preacher}
                        gospelRef={selected.gospelRef}
                        definition={currentDefinition()}
                        outputs={selected.outputs ?? []}
                        jobs={selected.jobs ?? []}
                        onSaveDefinition={async (def) => {
                          await saveDefinition(def as Definition);
                        }}
                        onQueued={() => openProject(selected.id)}
                      />
                    </Panel>
                  </aside>
                </div>
              )}
              {message && <p className="success">{message}</p>}
              {error && <p className="error">{error}</p>}
            </div>
          </>
        )}
      </section>
      {creating && (
        <div className="backdrop">
          <form className="modal" onSubmit={createProject}>
            <h2>Uusi projekti</h2>
            <label>
              Otsikko
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <div className="actions">
              <button type="button" onClick={() => setCreating(false)}>
                Peruuta
              </button>
              <button className="primary" disabled={busy}>
                Luo projekti
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      )}
      {removeAsset && (
        <div className="backdrop">
          <div className="modal" role="dialog" aria-label="Remove asset from project">
            <h2>Remove “{removeAsset.asset.assetKey}” from this project?</h2>
            {removeAsset.usage.length > 0 && (
              <p className="error">It is still used by {removeAsset.usage.join(", ")}. Those will render without it.</p>
            )}
            <p className="muted">The asset stays in the graphics library and in other projects.</p>
            <div className="actions">
              <button onClick={() => setRemoveAsset(null)}>Cancel</button>
              <button className="dangerButton" data-testid="confirm-remove-asset" onClick={() => void confirmRemoveAsset()}>
                Remove from project
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="backdrop">
          <div className="modal">
            <h2>Delete “{confirmDelete.title}”?</h2>
            <p className="muted">The project is deleted. Shared sources/assets are retained when referenced elsewhere.</p>
            <div className="actions">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="dangerButton" onClick={() => void deleteProject()}>
                Delete project
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteGraphicId && (
        <div className="backdrop">
          <div className="modal">
            <h2>Delete graphic?</h2>
            <p className="muted">This cannot be undone. A graphic that is already used in Composition will be protected.</p>
            <div className="actions">
              <button onClick={() => setConfirmDeleteGraphicId(null)}>Cancel</button>
              <button className="dangerButton" onClick={() => void deleteGraphic(confirmDeleteGraphicId)}>
                Delete graphic
              </button>
            </div>
          </div>
        </div>
      )}
      {durationMismatch && (
        <div className="backdrop">
          <div className="modal">
            <h2>Source duration differs</h2>
            <p>The selected file differs from the recording used to define these sections.</p>
            <p>
              <strong>Reference:</strong>{" "}
              {durationMismatch.referenceDurationMs != null ? formatTime(durationMismatch.referenceDurationMs / 1000) : "unknown"}
              <br />
              <strong>Selected:</strong>{" "}
              {durationMismatch.actualDurationMs != null ? formatTime(durationMismatch.actualDurationMs / 1000) : "unknown"}
            </p>
            {durationMismatch.violations?.length && (
              <div className="warning-list">
                {durationMismatch.violations.map((v) => (
                  <div key={`${v.label}-${v.endSeconds}`}>
                    <strong>{v.label}</strong>: ends at {formatTime(v.endSeconds)}, file ends at {formatTime(v.durationSeconds)}
                  </div>
                ))}
              </div>
            )}
            <div className="actions">
              <button onClick={() => setDurationMismatch(null)}>Choose another file</button>
              <button
                className="primary"
                onClick={() => {
                  setAcceptedClamp(true);
                  setDurationMismatch(null);
                }}
              >
                Continue and clamp at EOF
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Global so the rules reach child components (CompositionEditor, TranscriptionEditor, SourcePlayer, SectionManager); styled-jsx removes them when this page unmounts. */}
      <style jsx global>{`
        * {
          box-sizing: border-box;
        }
        .app {
          min-height: 100vh;
          display: flex;
          background: #f6f7f9;
          color: #18202a;
          font-family: system-ui, sans-serif;
        }
        .sidebar {
          width: 270px;
          flex: none;
          background: #111827;
          color: white;
          padding: 20px 14px;
        }
        .brand {
          font-size: 21px;
          font-weight: 750;
          padding: 4px 8px 18px;
        }
        .new {
          width: 100%;
          padding: 10px;
          border: 0;
          border-radius: 8px;
          font-weight: 650;
          margin-bottom: 14px;
        }
        .projects {
          display: grid;
          gap: 4px;
        }
        .project {
          position: relative;
          display: flex;
          border-radius: 8px;
        }
        .project.selected {
          background: #273244;
        }
        .project-main {
          flex: 1;
          text-align: left;
          background: none;
          color: #e5e7eb;
          border: 0;
          padding: 10px;
        }
        .more {
          background: none;
          color: #cbd5e1;
          border: 0;
          padding: 0 10px;
          font-size: 20px;
        }
        .menu {
          position: absolute;
          right: 4px;
          top: 40px;
          background: white;
          color: #111827;
          border-radius: 8px;
          box-shadow: 0 8px 25px #0003;
          padding: 5px;
          z-index: 3;
          min-width: 150px;
        }
        .menu button {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: 0;
          padding: 9px;
          border-radius: 5px;
        }
        .danger,
        .dangerButton {
          color: #b91c1c !important;
        }
        .workspace {
          flex: 1;
          min-width: 0;
        }
        .workspace header {
          min-height: 92px;
          background: white;
          border-bottom: 1px solid #e5e7eb;
          padding: 20px 30px;
          padding-right: 340px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: space-between;
          align-items: center;
        }
        .header-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .header-actions button {
          min-height: 40px;
          padding: 8px 14px;
          border: 1px solid #d8dee8;
          border-radius: 8px;
          background: white;
          color: #18202a;
          font-weight: 650;
        }
        .workspace h1 {
          margin: 0 0 4px;
          font-size: 24px;
        }
        nav {
          display: flex;
          overflow: auto;
          background: white;
          border-bottom: 1px solid #e5e7eb;
          padding: 0 20px;
        }
        nav button {
          background: none;
          border: 0;
          padding: 14px 11px;
          color: #64748b;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
        }
        nav button.active {
          color: #111827;
          border-bottom-color: #111827;
          font-weight: 650;
        }
        .content {
          padding: 28px;
          max-width: none;
        }
        .panel {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px;
        }
        .panel h2 {
          margin: 0 0 5px;
        }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: end;
        }
        .form-grid.four {
          grid-template-columns: repeat(4, 1fr);
        }
        label {
          display: grid;
          gap: 6px;
          font-weight: 600;
          font-size: 14px;
        }
        input,
        select,
        textarea {
          width: 100%;
          padding: 10px;
          border: 1px solid #d8dee8;
          border-radius: 7px;
          background: white;
        }
        .form-grid button,
        .button-row button,
        .row button {
          padding: 10px 12px;
          border: 0;
          border-radius: 7px;
          background: #e5e7eb;
          color: #18202a;
        }
        .primary {
          background: #111827 !important;
          color: white !important;
          border: 0;
          border-radius: 8px;
          padding: 10px 15px;
          font-weight: 650;
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .card {
          border: 1px solid #e5e7eb;
          border-radius: 9px;
          padding: 13px;
          display: grid;
          gap: 7px;
        }
        .card b {
          font-size: 11px;
          color: #4338ca;
        }
        .pending-upload {
          display: grid;
          gap: 6px;
        }
        .list {
          display: grid;
          gap: 8px;
          margin-top: 20px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid #e5e7eb;
          padding: 12px;
          border-radius: 8px;
        }
        .row span,
        .row small {
          display: grid;
          gap: 3px;
        }
        .button-row {
          display: flex;
          gap: 9px;
          margin-top: 16px;
        }
        .graphic-list {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin: 18px 0;
        }
        .graphic-list button {
          display: grid;
          text-align: left;
          gap: 4px;
          border: 1px solid #d8dee8;
          background: #f8fafc;
          padding: 10px 12px;
          border-radius: 8px;
          color: #18202a;
          font-weight: 700;
        }
        .graphic-list button.graphic-selected {
          border-color: #111827;
          background: #eef2ff;
        }
        .graphic-list small {
          color: #475569;
          font-weight: 600;
        }
        .graphic-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
          margin-bottom: 8px;
          padding: 10px 12px;
          border: 1px solid #d8dee8;
          border-radius: 9px;
          background: #f8fafc;
        }
        .graphic-editor-header > div:first-child {
          display: grid;
          gap: 2px;
        }
        .graphic-editor-header small {
          color: #64748b;
        }
        .graphic-editor-actions {
          display: flex;
          gap: 6px;
        }
        .icon-button {
          width: 34px;
          height: 34px;
          padding: 0 !important;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          background: white;
          color: #334155;
          cursor: pointer;
        }
        .icon-button:hover {
          background: #e2e8f0;
        }
        .danger-icon {
          color: #b91c1c;
        }
        .composition-editor {
          display: grid;
          gap: 18px;
        }
        .resource-bin {
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          background: #f8fafc;
          padding: 14px;
        }
        .resource-bin-title {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .resource-bin-title span {
          color: #64748b;
          font-size: 13px;
        }
        .resource-bin-grid {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .resource-tile {
          width: 92px;
          height: 92px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: white;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 7px;
          cursor: grab;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          overflow: hidden;
        }
        .resource-tile span:last-child {
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .resource-tile.graphic {
          border-color: #818cf8;
          background: #eef2ff;
        }
        .resource-icon {
          font-size: 24px;
          line-height: 1;
        }
        .composition-timeline {
          display: grid;
          gap: 8px;
        }
        .composition-section {
          display: grid;
          gap: 7px;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 8px;
          background: #fff;
          box-shadow: 0 1px 2px #0000000a;
        }
        .composition-drop-zone {
          height: 28px;
          border: 1px dashed transparent;
          border-radius: 7px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          transition: 0.12s;
        }
        .composition-drop-zone.active {
          height: 44px;
          border-color: #6366f1;
          background: #eef2ff;
          color: #4338ca;
          font-weight: 700;
        }
        .section-header {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid #dfe4eb;
          border-radius: 10px;
          padding: 7px;
          background: white;
        }
        .section-thumbnail {
          width: 58px !important;
          height: 33px !important;
          border-radius: 5px;
          overflow: hidden;
          background: #111827;
          flex: none;
        }
        .section-thumbnail img,
        .section-thumbnail video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .section-header > div:last-child {
          display: grid;
          gap: 3px;
        }
        .section-header small {
          color: #64748b;
        }
        .section-body {
          display: grid;
          gap: 6px;
          padding-left: 14px;
          border-left: 3px solid #cbd5e1;
          margin-left: 5px;
        }
        .section-main-track {
          border-left: 3px solid #94a3b8;
          padding-left: 10px;
        }
        .composition-item-card {
          display: grid;
          grid-template-columns: 24px 1fr 30px;
          gap: 8px;
          align-items: center;
          border: 1px solid #dfe4eb;
          border-radius: 8px;
          padding: 9px;
          background: #fff;
          cursor: grab;
        }
        .composition-item-card > div {
          display: grid;
          gap: 2px;
        }
        .composition-item-card small {
          color: #64748b;
        }
        .composition-item-card button,
        .overlay-card button {
          border: 0;
          background: none;
          font-size: 18px;
          color: #64748b;
        }
        .item-handle {
          color: #94a3b8;
        }
        .overlay-track {
          min-height: 70px;
          border: 1px dashed #cbd5e1;
          border-radius: 8px;
          padding: 8px;
          background: #f8fafc;
          position: relative;
        }
        .overlay-track.drop-active {
          border-color: #6366f1;
          background: #eef2ff;
        }
        .track-label {
          font-size: 10px;
          font-weight: 800;
          color: #64748b;
          letter-spacing: 0.08em;
          margin-bottom: 7px;
        }
        .overlay-track-line {
          position: relative;
          min-height: 34px;
          background: linear-gradient(to right, #e2e8f0 1px, transparent 1px);
          background-size: 10% 100%;
          border-radius: 5px;
        }
        .overlay-card {
          position: absolute;
          top: 4px;
          height: 26px;
          border-radius: 5px;
          background: #6366f1;
          color: white;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          padding: 0 7px;
          min-width: 70px;
          overflow: hidden;
          font-size: 11px;
          font-weight: 700;
        }
        .overlay-card span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .overlay-card button {
          color: white;
          flex: none;
        }
        .overlay-hint {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #94a3b8;
          font-size: 12px;
        }
        .empty-composition {
          text-align: center;
          padding: 40px;
          color: #64748b;
          border: 1px dashed #cbd5e1;
          border-radius: 10px;
        }
        .preview-panel {
          display: grid;
          gap: 16px;
        }
        .preview-panel video {
          display: block;
          width: min(100%, 960px);
          max-height: 70vh;
          margin: 0 auto;
          border-radius: 10px;
          background: #111827;
        }
        .preview-empty {
          min-height: 280px;
          background: #111827;
          color: white;
          border-radius: 10px;
          display: grid;
          place-items: center;
          text-align: center;
          padding: 30px;
        }
        .preview-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .job {
          display: grid;
          gap: 12px;
          padding: 18px;
          background: #f8fafc;
          border-radius: 9px;
        }
        .job div {
          display: grid;
          gap: 4px;
        }
        .job .button-row,
        .job .job-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          margin: 0;
        }
        .job .stop-button {
          justify-self: start;
          background: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          border-radius: 7px;
          padding: 7px 10px;
          font-weight: 700;
        }
        .downloads {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .downloads a {
          padding: 11px 15px;
          border: 1px solid #d8dee8;
          border-radius: 8px;
          text-decoration: none;
          color: #111827;
        }
        .muted,
        .hint {
          color: #64748b;
          font-size: 14px;
        }
        .success {
          color: #047857;
        }
        .error {
          color: #b91c1c;
        }
        .empty {
          text-align: center;
          margin: 15vh auto;
        }
        .empty button {
          padding: 11px 16px;
          border: 0;
          border-radius: 8px;
          background: #111827;
          color: white;
        }
        .backdrop {
          position: fixed;
          inset: 0;
          background: #0008;
          display: grid;
          place-items: center;
          z-index: 100;
        }
        .modal {
          background: white;
          border-radius: 12px;
          padding: 24px;
          width: min(560px, calc(100% - 30px));
          box-shadow: 0 20px 50px #0004;
        }
        .modal label {
          margin: 15px 0;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 20px;
          flex-wrap: wrap;
        }
        .actions button {
          padding: 10px 14px;
          border: 0;
          border-radius: 7px;
        }
        .dangerButton {
          background: #fee2e2;
          border-radius: 7px;
          padding: 10px 14px;
          font-weight: 650;
        }
        .warning-list {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          border-radius: 8px;
          padding: 10px;
          display: grid;
          gap: 6px;
        }
        .section-picker {
          display: grid;
          gap: 16px;
        }
        .picker-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          align-items: end;
        }
        .picker-player {
          border-radius: 10px;
          overflow: hidden;
          background: #111827;
          min-height: 320px;
          display: grid;
          place-items: center;
        }
        .picker-player iframe,
        .picker-player video {
          display: block;
          width: 100%;
          aspect-ratio: 16/9;
          border: 0;
          background: #000;
        }
        .picker-time {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 0;
        }
        .picker-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .picker-buttons button {
          padding: 10px 12px;
          border: 0;
          border-radius: 7px;
          background: #e5e7eb;
        }
        .range-inputs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .transcription-editor {
          display: grid;
          gap: 16px;
        }
        .transcription-mode-toggle {
          display: flex;
          gap: 8px;
        }
        .transcription-mode-toggle button {
          padding: 9px 13px;
          border: 1px solid #d8dee8;
          border-radius: 7px;
          background: #f8fafc;
          color: #475569;
          font-weight: 650;
        }
        .transcription-mode-toggle button.mode-active {
          background: #111827;
          color: white;
          border-color: #111827;
        }
        .transcription-start-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          padding: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #f8fafc;
        }
        .transcription-upload {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .transcription-upload input[type="file"] {
          width: auto;
        }
        .job-progress {
          display: grid;
          gap: 8px;
          padding: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #f8fafc;
        }
        .job-status-line {
          font-weight: 650;
        }
        .progress-bar {
          height: 8px;
          border-radius: 4px;
          background: #e5e7eb;
          overflow: hidden;
        }
        .progress-bar > div {
          height: 100%;
          background: #111827;
          transition: width 0.2s;
        }
        .job-progress .stop-button {
          justify-self: start;
          background: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          border-radius: 7px;
          padding: 7px 10px;
          font-weight: 700;
        }
        .run-list {
          display: grid;
          gap: 10px;
        }
        .run-card {
          display: grid;
          gap: 6px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 13px;
          background: white;
        }
        .run-card-head {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: baseline;
        }
        .run-card-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .segment-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 20px;
        }
        .segment-list {
          display: grid;
          gap: 8px;
        }
        .segment-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: start;
          border: 1px solid #e5e7eb;
          border-radius: 9px;
          padding: 11px;
          background: white;
        }
        .segment-row.segment-current {
          border-color: #111827;
          background: #eef2ff;
        }
        .segment-times {
          display: grid;
          gap: 6px;
          width: 150px;
        }
        .segment-seek {
          padding: 8px;
          border: 1px solid #d8dee8;
          border-radius: 7px;
          background: #e5e7eb;
          font-weight: 650;
        }
        .segment-times label {
          font-size: 12px;
        }
        .segment-delete {
          align-self: start;
          border: 0;
          background: none;
          font-size: 16px;
          padding: 6px;
        }
        .add-line {
          display: grid;
          gap: 8px;
          border: 1px dashed #cbd5e1;
          border-radius: 10px;
          padding: 13px;
          margin-top: 6px;
        }
        .add-line-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .stepper {
          gap: 8px;
          padding: 12px 20px;
          flex-wrap: wrap;
        }
        .stepper button {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 52px;
          padding: 6px 14px 6px 8px;
          border: 1px solid transparent;
          border-radius: 10px;
          background: none;
          color: #18202a;
          text-align: left;
          cursor: pointer;
        }
        .stepper button.active {
          background: #eef2ff;
          border-color: #111827;
          border-bottom-color: #111827;
          font-weight: 400;
        }
        .step-badge {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: #e5e7eb;
          font-weight: 700;
          font-size: 14px;
          flex: none;
        }
        .stepper button.active .step-badge {
          background: #111827;
          color: white;
        }
        .step-text {
          display: grid;
          gap: 2px;
        }
        .step-text small {
          color: #64748b;
          font-size: 12px;
        }
        .step-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          align-items: flex-start;
        }
        .step-main {
          flex: 999 1 560px;
          min-width: 0;
          display: grid;
          gap: 20px;
        }
        .step-aside {
          flex: 1 1 340px;
          min-width: 0;
          display: grid;
          gap: 20px;
        }
        .step-stack {
          display: grid;
          gap: 20px;
        }
        .step-main,
        .step-aside,
        .step-stack {
          grid-template-columns: minmax(0, 1fr);
        }
        .subhead {
          margin: 20px 0 6px;
          font-size: 16px;
        }
        .inline-select {
          width: auto;
          padding: 5px 8px;
          font-size: 12px;
        }
        .composition-sections {
          margin-top: 18px;
        }
        .composition-sections summary {
          cursor: pointer;
          font-weight: 650;
          margin-bottom: 10px;
        }
        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .chip {
          margin-left: 6px;
          padding: 3px 10px;
          border: 1px solid #c7d2fe;
          border-radius: 999px;
          background: #eef2ff;
          color: #3730a3;
          font-size: 12px;
          cursor: pointer;
        }
        .variables-editor {
          display: grid;
          gap: 10px;
        }
        .variable-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 34px;
          gap: 6px;
          align-items: center;
        }
        .variable-row small {
          grid-column: 1 / -1;
          margin-top: -4px;
        }
        .podcast-range {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          align-items: end;
        }
        .podcast-range > button,
        .podcast-range > small,
        .podcast-range-bar {
          grid-column: 1 / -1;
        }
        .podcast-range > button {
          justify-self: start;
          padding: 8px 12px;
          border: 0;
          border-radius: 7px;
          background: #e5e7eb;
          color: #18202a;
        }
        .podcast-range-bar {
          position: relative;
          height: 14px;
          border-radius: 7px;
          background: #e5e7eb;
          overflow: hidden;
        }
        .podcast-range-bar div {
          position: absolute;
          top: 0;
          bottom: 0;
          background: #111827;
        }
        .segmented {
          display: inline-flex;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          overflow: hidden;
        }
        .segmented button {
          min-height: 36px;
          padding: 0 14px;
          border: 0;
          background: white;
          color: #18202a;
          font-weight: 650;
          cursor: pointer;
        }
        .segmented button[aria-pressed="true"] {
          background: #111827;
          color: white;
        }
        .timeline-view {
          display: grid;
          gap: 10px;
          margin-bottom: 8px;
        }
        .timeline-view-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .timeline-lane-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
        }
        .timeline-h {
          display: grid;
          gap: 6px;
          overflow-x: auto;
        }
        .timeline-h-ruler {
          position: relative;
          height: 16px;
          margin-left: 92px;
          min-width: 600px;
          font-size: 11px;
          color: #64748b;
        }
        .timeline-h-ruler span {
          position: absolute;
          top: 0;
        }
        .timeline-h-lane {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .timeline-h-lane .timeline-lane-label {
          width: 84px;
          flex: none;
        }
        .timeline-h-track {
          position: relative;
          flex: 1;
          min-width: 600px;
          height: 46px;
          border-radius: 8px;
          background: #f1f5f9;
        }
        .timeline-v {
          display: grid;
          grid-template-columns: 48px repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .timeline-v-ruler {
          position: relative;
          font-size: 11px;
          color: #64748b;
        }
        .timeline-v-ruler span {
          position: absolute;
          left: 0;
        }
        .timeline-v-track {
          position: relative;
          border-radius: 8px;
          background: #f1f5f9;
        }
        .timeline-block {
          position: absolute;
          display: grid;
          align-content: center;
          gap: 1px;
          padding: 2px 6px;
          border-radius: 6px;
          overflow: hidden;
          font-size: 12px;
          line-height: 1.25;
          box-shadow: inset 0 0 0 1px #ffffff;
        }
        .timeline-h .timeline-block {
          top: 3px;
          bottom: 3px;
        }
        .timeline-v .timeline-block {
          left: 3px;
          right: 3px;
          min-height: 18px;
        }
        .timeline-block strong,
        .timeline-block small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .timeline-block small {
          color: inherit;
          opacity: 0.8;
          font-size: 11px;
        }
        .tone-clip {
          background: #dbeafe;
          color: #1e3a8a;
        }
        .tone-slate {
          background: #e5e7eb;
          color: #1f2937;
        }
        .tone-voice-picture {
          background: #f3f4f6;
          color: #374151;
        }
        .tone-graphic {
          background: #ede9fe;
          color: #4c1d95;
        }
        .tone-audio {
          background: #ffedd5;
          color: #7c2d12;
        }
        @media (max-width: 760px) {
          .app {
            flex-direction: column;
          }
          .app .sidebar {
            width: 100% !important;
            padding: 12px !important;
          }
          .app .sidebar .projects {
            display: flex !important;
            overflow-x: auto;
          }
          .app .sidebar .brand,
          .app .sidebar .new {
            display: block !important;
          }
          .sidebar-toggle {
            display: none !important;
          }
          .project {
            flex: none;
          }
          .content {
            padding: 14px !important;
          }
          .panel {
            padding: 16px;
          }
          .panel :is(label, select, input, textarea, video, iframe) {
            min-width: 0;
            max-width: 100%;
          }
          .form-grid,
          .form-grid.four,
          .picker-controls,
          .range-inputs,
          .transcription-editor,
          .section-picker,
          .composition-editor,
          .composition-timeline,
          .composition-section,
          .section-body {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .resource-bin-title,
          .button-row,
          .transcription-upload,
          .slate-section-card,
          .section-header {
            flex-wrap: wrap;
          }
          .transcription-upload input[type="file"] {
            width: 100%;
          }
        }
        @media (max-width: 850px) {
          .workspace header {
            padding: 70px 16px 16px;
          }
          .stepper {
            padding: 10px 12px;
          }
          .stepper .step-text small {
            display: none;
          }
          .sidebar {
            width: 220px;
          }
          .content {
            padding: 18px;
          }
          .form-grid,
          .form-grid.four,
          .range-inputs,
          .picker-controls,
          .add-line-fields {
            grid-template-columns: 1fr;
          }
          .timeline-item {
            grid-template-columns: 25px 1fr;
          }
          .timeline-item > select {
            grid-column: 2;
          }
          .resource-bin-grid {
            overflow-x: auto;
            flex-wrap: nowrap;
          }
          .section-body {
            padding-left: 0;
          }
          .segment-row {
            grid-template-columns: 1fr;
          }
          .segment-times {
            width: auto;
          }
        }
      `}</style>
    </main>
  );
}

function outputLabel(o: Output) {
  const kind =
    o.type === "VIDEO"
      ? "Video"
      : o.type === "AUDIO"
        ? `Podcast (${o.mimeType === "audio/mp4" ? "M4A" : "MP3"})`
        : o.type === "CAPTIONS_SRT"
          ? "Captions (SRT)"
          : o.type === "CAPTIONS_VTT"
            ? "Captions (VTT)"
            : o.type;
  const lang = o.type.startsWith("CAPTIONS_") && o.language && o.language !== "und" ? ` · ${o.language}` : "";
  return `${o.preview ? "Preview " : ""}${kind}${lang}`;
}
function Panel({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
      {children}
    </section>
  );
}

function ProjectTitle({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
  const [value, setValue] = useState(title);
  const [error, setError] = useState("");
  useEffect(() => setValue(title), [title]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === title) return setValue(title);
    try {
      setError("");
      await onSave(next);
    } catch (e) {
      setError(errorMessage(e, "Otsikkoa ei voitu tallentaa"));
    }
  };
  return (
    <label>
      Otsikko
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && void save()} />
      {error && <small className="error">{error}</small>}
    </label>
  );
}

function outputSizeLabel(template: Definition["template"]) {
  const width = template?.width ?? 1920,
    height = template?.height ?? 1080;
  const preset = findPreset(template?.presetKey) ?? presetForSize(width, height, template?.presetKey);
  return preset ? `${preset.label} (${width}×${height})` : `${width}×${height}`;
}

function graphicVariables(graphic: Graphic) {
  return [...new Set(graphic.layers.flatMap((layer) => variableNames(layer.text ?? "")))];
}

function SectionPicker({
  projectId,
  sources,
  pendingFiles,
  onAdd,
}: {
  projectId: string;
  sources: Source[];
  pendingFiles: Record<string, File>;
  onAdd: (sourceId: string, label: string, start: number, end: number) => void;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? ""),
    [label, setLabel] = useState("Section"),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(60);
  const source = sources.find((s) => s.id === sourceId) || sources[0];
  useEffect(() => {
    if (sources.length && !sources.some((s) => s.id === sourceId)) setSourceId(sources[0].id);
  }, [sources, sourceId]);
  const localFile = source ? pendingFiles[source.id] : undefined;
  const player = useSourcePlayer(source, sourceId, localFile, () => {
    setStart(0);
    setEnd(60);
  });
  const { current, seek } = player;
  if (!source) return <p className="muted">Add a source first.</p>;
  return (
    <div className="section-picker">
      <div className="picker-controls">
        <label>
          Source
          <select value={source.id} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.type} · {sourceLabel(s)}
                {s.status === "PENDING" ? " · upload later" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section name
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <SourcePlayer
        source={source}
        player={player}
        localFile={localFile}
        remoteSrc={`/api/projects/${projectId}/source/${source.id}`}
        onDuration={(d) => {
          if (end === 60) setEnd(Math.min(60, d));
        }}
      >
        <button onClick={() => setStart(current)}>Set start</button>
        <button onClick={() => setEnd(current)}>Set end</button>
      </SourcePlayer>
      <div className="range-inputs">
        <label>
          Start
          <input
            type="number"
            min="0"
            step=".1"
            value={start}
            onChange={(e) => {
              const n = Number(e.target.value);
              setStart(n);
              seek(n);
            }}
          />
        </label>
        <label>
          End
          <input type="number" min=".1" step=".1" value={end} onChange={(e) => setEnd(Number(e.target.value))} />
        </label>
      </div>
      <button className="primary" onClick={() => end > start && onAdd(source.id, label, start, end)}>
        ＋ Add section {formatTime(start)} → {formatTime(end)}
      </button>
    </div>
  );
}
