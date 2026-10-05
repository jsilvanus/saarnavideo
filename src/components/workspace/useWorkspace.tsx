"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { parseLayers } from "@/components/GraphicsEditor";
import { findAssetUsage } from "@/domain/asset-usage";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { sourceLabel } from "@/components/format";
import { baseItemDuration, isBaseItem, type ProjectDefinition, type TimelineItem } from "@/domain/project";
import { selectionFromValue } from "@/components/TemplatePicker";
import { addSourceSection } from "@/domain/templates";
import { type ProjectVariable } from "@/domain/variables";
import DurationNotice from "@/components/DurationNotice";
import type { Reframe } from "@/domain/reframe";
import { type Publication } from "@/components/PublishPanel";
import type { Section as SemanticSection } from "@/domain/sections";
import type { Graphic } from "@/domain/graphics";
import { createCaptionGraphic, isCaptionStyleGraphic } from "@/domain/caption-style";
import { createContext, useContext } from "react";
import {
  ACTIVE_JOB_STATUSES,
  type Asset,
  type CaptionMode,
  type CaptionRequest,
  type Definition,
  type DurationMismatch,
  type Item,
  type Job,
  type Project,
  type Source,
  type Step,
} from "./types";

export function useWorkspaceState() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [templateValue, setTemplateValue] = useState("builtin:sermon"),
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
  /** Reloads only the publications (a few rows) of the open project; the publish panel polls this while an upload runs. */
  async function refreshPublications(id: string) {
    try {
      const data = await requestJson<{ publications: Publication[] }>(
        `/api/projects/${id}/publications`,
        { cache: "no-store" },
        "Could not load publications",
      );
      setSelected((current) => (current && current.id === id ? { ...current, publications: data.publications } : current));
    } catch {
      // The next tick tries again.
    }
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
        jsonInit("POST", { title, ...selectionFromValue(templateValue) }),
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
    // The template decides where the clip goes (before its ending slate) and whether the section gets an overlay.
    const next = addSourceSection(currentDefinition() as unknown as ProjectDefinition, {
      id: crypto.randomUUID(),
      label: label || "Section",
      sourceId,
      startSeconds: start,
      endSeconds: end,
    });
    await saveDefinition(next as unknown as Definition);
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
    const updated = await requestJson<Partial<Project>>(
      `/api/projects/${selected.id}`,
      jsonInit("PATCH", { title }),
      "Otsikkoa ei voitu tallentaa",
    );
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
      i.type === "source-clip" &&
      moved.some((x) => x.sourceId === i.sourceId && x.startSeconds === i.startSeconds && x.endSeconds === i.endSeconds);
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
      const asset = await requestJson<{ assetKey: string; reused?: boolean; requestedKey?: string }>(
        `/api/projects/${selected.id}/assets`,
        { method: "POST", body: form },
        "Asset upload failed",
      );
      setAssetFile(null);
      setAssetKey("");
      await openProject(selected.id);
      setMessage(
        asset.requestedKey
          ? `Sama kuva oli jo kirjastossa nimellä "${asset.assetKey}". Käytä tätä nimeä; "${asset.requestedKey}" ei ole käytössä.`
          : "Graphic asset uploaded.",
      );
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
    return data as { id: string; clamped?: boolean; durationWarnings?: Array<{ message: string }>; assetWarnings?: string[] };
  }
  function withWarnings(text: string, data: { durationWarnings?: Array<{ message: string }>; assetWarnings?: string[] }) {
    const warnings = [...(data.durationWarnings?.map((w) => w.message) ?? []), ...(data.assetWarnings ?? [])];
    return warnings.length ? `${text} ${warnings.join(" ")}` : text;
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
  return {
    projects,
    setProjects,
    selected,
    setSelected,
    selectedId,
    setSelectedId,
    step,
    setStep,
    creating,
    setCreating,
    title,
    setTitle,
    templateValue,
    setTemplateValue,
    uploadFiles,
    setUploadFiles,
    uploadMode,
    setUploadMode,
    pendingFiles,
    setPendingFiles,
    youtubeUrl,
    setYoutubeUrl,
    assetFile,
    setAssetFile,
    assetKey,
    setAssetKey,
    assetType,
    setAssetType,
    libraryOpen,
    setLibraryOpen,
    removeAsset,
    setRemoveAsset,
    message,
    setMessage,
    error,
    setError,
    busy,
    setBusy,
    captionMode,
    setCaptionMode,
    captionStyleId,
    setCaptionStyleId,
    menuId,
    setMenuId,
    confirmDelete,
    setConfirmDelete,
    durationMismatch,
    setDurationMismatch,
    acceptedClamp,
    setAcceptedClamp,
    selectedGraphicId,
    setSelectedGraphicId,
    confirmDeleteGraphicId,
    setConfirmDeleteGraphicId,
    previewBusy,
    setPreviewBusy,
    withBusy,
    refreshProjects,
    refreshPublications,
    openProject,
    createProject,
    duplicateProject,
    deleteProject,
    getVideoDurationMs,
    sourceUploadForm,
    addUploads,
    addDeferredUploads,
    uploadPendingSource,
    addYoutube,
    currentDefinition,
    saveDefinition,
    addSegment,
    removeSegment,
    saveSections,
    saveVariables,
    saveTitle,
    changeSectionSource,
    saveOutput,
    saveSectionReframe,
    durationNotice,
    compositionDurationSeconds,
    refreshAssets,
    askRemoveAsset,
    confirmRemoveAsset,
    uploadAsset,
    createGraphic,
    captionStyles,
    captionRequest,
    createCaptionStyle,
    duplicateGraphic,
    updateGraphic,
    deleteGraphic,
    stopJob,
    uploadPendingSources,
    queueGeneration,
    withWarnings,
    generate,
    previewRender,
    sourceNames,
    selectedGraphic,
    editorItem,
    activeJob,
    previewJob,
    latestPreview,
  };
}

export type Workspace = ReturnType<typeof useWorkspaceState>;
const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspaceState();
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return workspace;
}

/** For components that only render while a project is open. */
export function useOpenWorkspace(): Workspace & { selected: Project } {
  const workspace = useWorkspace();
  if (!workspace.selected) throw new Error("No project is open");
  return workspace as Workspace & { selected: Project };
}
