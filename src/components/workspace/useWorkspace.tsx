"use client";

import { useT } from "@/i18n/I18nProvider";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { parseLayers } from "@/components/GraphicsEditor";
import { findAssetUsage } from "@/domain/asset-usage";
import { errorMessage, jsonInit, requestJson } from "@/components/api";
import { sourceLabel } from "@/components/format";
import type { ProjectDefinition, TimelineItem } from "@/domain/project";
import { timelineDuration } from "@/domain/timeline";
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
  const t = useT();
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
        t("ws.loadPublicationsFailed"),
      );
      setSelected((current) => (current && current.id === id ? { ...current, publications: data.publications } : current));
    } catch {
      // The next tick tries again.
    }
  }
  async function openProject(id: string) {
    const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setError(t("ws.loadProjectFailed"));
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
    // load the project list once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function createProject(e: FormEvent) {
    e.preventDefault();
    await withBusy(t("ws.createFailed"), async () => {
      setError("");
      const data = await requestJson<{ id: string }>(
        "/api/projects",
        jsonInit("POST", { title, ...selectionFromValue(templateValue) }),
        t("ws.createFailed"),
      );
      setCreating(false);
      setTitle("");
      await refreshProjects();
      await openProject(data.id);
      setStep("quick");
      setMessage(t("ws.created"));
    });
  }
  async function duplicateProject(project: Project) {
    setMenuId(null);
    await withBusy(t("ws.duplicateFailed"), async () => {
      const data = await requestJson<{ id?: string; project?: { id: string } }>(
        `/api/projects/${project.id}/duplicate`,
        { method: "POST" },
        t("ws.duplicateFailed"),
      );
      await refreshProjects();
      await openProject((data.id ?? data.project?.id)!);
      setMessage(t("ws.duplicated"));
    });
  }
  async function deleteProject() {
    if (!confirmDelete) return;
    const p = confirmDelete;
    setConfirmDelete(null);
    setMenuId(null);
    await withBusy(t("ws.deleteFailed"), async () => {
      await requestJson(`/api/projects/${p.id}`, { method: "DELETE" }, t("ws.deleteFailed"));
      await refreshProjects();
      setMessage(t("ws.deleted"));
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
  async function uploadFileToS3(presignedUrl: string, file: File) {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    });
    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
    }
  }

  async function addUploads() {
    if (!selected || !uploadFiles.length) return;
    await withBusy(t("ws.uploadFailed"), async () => {
      for (const file of uploadFiles) {
        // Step 1: Request presigned URL
        const presignedData = await requestJson<{ uploadUrl: string; sourceId: string }>(
          `/api/projects/${selected.id}/source/presigned-url`,
          jsonInit("POST", { fileName: file.name, sizeBytes: file.size, contentType: file.type || "application/octet-stream" }),
          t("ws.uploadFailed"),
        );

        // Step 2: Upload file directly to S3
        await uploadFileToS3(presignedData.uploadUrl, file);

        // Step 3: Finalize the upload
        const durationMs = await getVideoDurationMs(file);
        await requestJson(
          `/api/projects/${selected.id}/source/${presignedData.sourceId}/finalize`,
          jsonInit("POST", { durationMs }),
          t("ws.uploadFailed"),
        );
      }
      setUploadFiles([]);
      await openProject(selected.id);
      setMessage(t("ws.sourcesUploaded"));
    });
  }
  async function addDeferredUploads() {
    if (!selected || !uploadFiles.length) return;
    await withBusy(t("ws.addLocalFailed"), async () => {
      for (const file of uploadFiles) {
        const data = await requestJson<{ id: string }>(
          `/api/projects/${selected.id}/source`,
          jsonInit("POST", { localFileName: file.name }),
          t("ws.addLocalFailed"),
        );
        setPendingFiles((p) => ({ ...p, [data.id]: file }));
      }
      setUploadFiles([]);
      await openProject(selected.id);
      setMessage(t("ws.pendingAdded"));
    });
  }
  async function uploadPendingSource(source: Source) {
    if (!selected) return false;
    const file = pendingFiles[source.id];
    if (!file) {
      setError(t("ws.chooseLocalFile", { name: source.originalName || source.id }));
      return false;
    }

    try {
      // Step 1: Request presigned URL for this specific source
      const presignedData = await requestJson<{ uploadUrl: string }>(
        `/api/projects/${selected.id}/source/presigned-url`,
        jsonInit("POST", { fileName: file.name, sizeBytes: file.size, contentType: file.type || "application/octet-stream" }),
        t("ws.uploadFailed"),
      );

      // Step 2: Upload file directly to S3
      await uploadFileToS3(presignedData.uploadUrl, file);

      // Step 3: Finalize the upload
      const durationMs = await getVideoDurationMs(file);
      const data = await requestJson<{
        error?: string;
        durationWarning?: { referenceDurationMs: number; actualDurationMs: number };
      }>(
        `/api/projects/${selected.id}/source/${source.id}/finalize`,
        jsonInit("POST", { durationMs }),
        t("ws.uploadFailed"),
      );

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
    } catch (e) {
      setError(errorMessage(e, t("ws.uploadFailed")));
      return false;
    }
  }
  async function addYoutube() {
    if (!selected || !youtubeUrl.trim()) return;
    await withBusy(t("ws.addYoutubeFailed"), async () => {
      await requestJson(`/api/projects/${selected.id}/source`, jsonInit("POST", { youtubeUrl }), t("ws.addYoutubeFailed"));
      setYoutubeUrl("");
      await openProject(selected.id);
      setMessage(t("ws.youtubeAdded"));
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
      t("ws.saveFailed"),
    );
    setSelected((p) => (p ? { ...p, ...updated, definition: updated.definition ?? definition } : p));
  }
  async function addSegment(sourceId: string, label: string, start: number, end: number) {
    if (!selected || !(end > start)) {
      setError(t("ws.endAfterStart"));
      return;
    }
    // The template decides where the clip goes (before its ending slate) and whether the section gets an overlay.
    const next = addSourceSection(currentDefinition() as unknown as ProjectDefinition, {
      id: crypto.randomUUID(),
      label: label || t("ws.sectionDefault"),
      sourceId,
      startSeconds: start,
      endSeconds: end,
    });
    await saveDefinition(next as unknown as Definition);
    setMessage(t("ws.sectionSaved"));
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
    setMessage(t("ws.variablesSaved"));
  }
  async function saveTitle(title: string) {
    if (!selected) return;
    const updated = await requestJson<Partial<Project>>(
      `/api/projects/${selected.id}`,
      jsonInit("PATCH", { title }),
      t("project.titleSaveFailed"),
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
    setMessage(t("ws.sectionSourceChanged", { label: section.label, source: sourceNames[sourceId] ?? sourceId }));
  }
  async function saveOutput(patch: Record<string, unknown>) {
    const def = currentDefinition(),
      next = { ...(def.template ?? currentDefinition().template!), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
    await saveDefinition({ ...def, template: next as Definition["template"] });
    setMessage(t("ws.outputSaved"));
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
    setMessage(t("ws.reframeSaved"));
  }
  const durationNotice = selected ? <DurationNotice definition={currentDefinition()} assets={selected.assets} /> : null;
  function compositionDurationSeconds() {
    return timelineDuration(currentDefinition().composition.items as TimelineItem[]);
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
    await withBusy(t("ws.removeAssetFailed"), async () => {
      await requestJson(
        `/api/projects/${selected.id}/assets/${asset.id}?force=1`,
        { method: "DELETE" },
        t("ws.removeAssetFailed"),
      );
      await refreshAssets();
      setMessage(t("ws.assetRemoved", { name: asset.assetKey }));
    });
  }
  async function uploadAsset() {
    if (!selected || !assetFile || !assetKey.trim()) {
      setError(t("ws.chooseImage"));
      return;
    }
    await withBusy(t("ws.assetUploadFailed"), async () => {
      const form = new FormData();
      form.set("file", assetFile);
      form.set("assetKey", assetKey.trim());
      form.set("type", assetType);
      const asset = await requestJson<{ assetKey: string; reused?: boolean; requestedKey?: string }>(
        `/api/projects/${selected.id}/assets`,
        { method: "POST", body: form },
        t("ws.assetUploadFailed"),
      );
      setAssetFile(null);
      setAssetKey("");
      await openProject(selected.id);
      setMessage(
        asset.requestedKey
          ? t("ws.assetReused", { name: asset.assetKey, requested: asset.requestedKey })
          : t("ws.assetUploaded"),
      );
    });
  }
  async function createGraphic() {
    if (!selected) return;
    const def = currentDefinition();
    const graphic: Graphic = {
      id: crypto.randomUUID(),
      name: t("ws.graphicName", { n: (def.graphics?.length ?? 0) + 1 }),
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
    setMessage(t("ws.graphicCreated"));
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
      t("ws.captionStyleName", { n: (def.graphics ?? []).filter(isCaptionStyleGraphic).length + 1 }),
      def.template?.width ?? 1920,
      def.template?.height ?? 1080,
    );
    await saveDefinition({ ...def, graphics: [...(def.graphics ?? []), graphic] });
    setStep("structure");
    setSelectedGraphicId(graphic.id);
    setCaptionStyleId(graphic.id);
    setMessage(t("ws.captionStyleCreated"));
  }
  async function duplicateGraphic(id: string) {
    const def = currentDefinition(),
      source = def.graphics?.find((g) => g.id === id);
    if (!source) return;
    const copy: Graphic = {
      ...source,
      id: crypto.randomUUID(),
      name: t("ws.graphicCopy", { name: source.name }),
      layers: source.layers.map((l) => ({ ...l, id: `${l.type}-${crypto.randomUUID()}` })),
    };
    await saveDefinition({ ...def, graphics: [...(def.graphics ?? []), copy] });
    setSelectedGraphicId(copy.id);
    setMessage(t("ws.graphicDuplicated"));
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
      setError(t("ws.graphicInUse"));
      return;
    }
    await saveDefinition({ ...def, graphics: (def.graphics ?? []).filter((g) => g.id !== id) });
    setSelectedGraphicId(null);
    setConfirmDeleteGraphicId(null);
  }
  async function stopJob(job: Job) {
    if (!selected) return;
    try {
      await requestJson(`/api/projects/${selected.id}/jobs/${job.id}/cancel`, { method: "POST" }, t("ws.stopFailed"));
      setMessage(t("ws.stopRequested"));
      await openProject(selected.id);
    } catch (e) {
      setError(errorMessage(e, t("ws.stopFailed")));
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
    await withBusy(t("ws.generationFailed"), async () => {
      const data = await queueGeneration(false, t("ws.queueFailed"), captionRequest());
      if (!data) return;
      setAcceptedClamp(false);
      setStep((current) => (current === "quick" ? current : "publish"));
      setMessage(
        withWarnings(
          data.clamped
            ? t("ws.generationClamped")
            : t("ws.generationQueued", { id: data.id }),
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
      t("ws.previewFailed"),
      async () => {
        const data = await queueGeneration(true, t("ws.previewQueueFailed"), captionRequest());
        if (!data) return;
        setStep((current) => (current === "quick" ? current : "publish"));
        setMessage(withWarnings(t("ws.previewQueuedMsg", { id: data.id }), data));
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
    uploadFileToS3,
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
