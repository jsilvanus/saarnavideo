"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage, requestJson } from "./api";
import { formatTime } from "./format";

export type LibraryAsset = { id: string; assetKey: string; type: string; mimeType: string; width: number | null; height: number | null; durationMs?: number | null; sizeBytes: string; folderId: string | null; projectCount: number };
type Folder = { id: string; name: string; parentId: string | null };
export type AssetKind = "all" | "image" | "audio";

const isAudio = (a: LibraryAsset) => a.type === "AUDIO" || a.mimeType.startsWith("audio/");
const isImage = (a: LibraryAsset) => !isAudio(a) && a.type !== "FONT";

function folderPath(folders: Folder[], id: string | null): Folder[] {
  const out: Folder[] = [];
  let current = id;
  while (current) { const f = folders.find(x => x.id === current); if (!f) break; out.unshift(f); current = f.parentId; }
  return out;
}

const fmtDuration = (ms?: number | null) => ms ? formatTime(ms / 1000) : "?";

/**
 * Modal browser for the global asset library. Choosing an asset links it to the project (unless it already is) and then
 * calls `onPick`. `pickLinked` controls whether already linked assets can be chosen again (true for "use this image in
 * the layer", false for a plain "Add from library" where a linked asset has nothing left to do).
 */
export default function AssetPicker({ projectId, kind = "all", linkedIds, pickLinked = true, title = "Asset library", onPick, onClose }: {
  projectId: string; kind?: AssetKind; linkedIds: string[]; pickLinked?: boolean; title?: string;
  onPick: (asset: LibraryAsset) => void | Promise<void>; onClose: () => void;
}) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetKind>(kind);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [linked, setLinked] = useState(() => new Set(linkedIds));

  useEffect(() => {
    let alive = true;
    requestJson<{ assets: LibraryAsset[]; folders: Folder[] }>("/api/assets", { cache: "no-store" }, "Could not load the asset library")
      .then(d => { if (alive) { setAssets(d.assets ?? []); setFolders(d.folders ?? []); setLoaded(true); } })
      .catch(e => { if (alive) { setError(errorMessage(e, "Could not load the asset library")); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  const searching = query.trim().length > 0;
  const matches = (a: LibraryAsset) => (filter === "all" ? isImage(a) || isAudio(a) : filter === "audio" ? isAudio(a) : isImage(a));
  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter(a => matches(a) && (q ? a.assetKey.toLowerCase().includes(q) : a.folderId === currentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, query, currentId, filter]);
  const visibleFolders = useMemo(() => searching ? [] : folders.filter(f => f.parentId === currentId).sort((a, b) => a.name.localeCompare(b.name)), [folders, currentId, searching]);
  const path = useMemo(() => folderPath(folders, currentId), [folders, currentId]);
  const folderName = (id: string | null) => id ? folderPath(folders, id).map(f => f.name).join(" / ") : "Root";

  async function choose(asset: LibraryAsset) {
    setBusyId(asset.id); setError("");
    try {
      if (!linked.has(asset.id)) {
        await requestJson(`/api/projects/${projectId}/assets/${asset.id}`, { method: "POST" }, "Could not add the asset to the project");
        setLinked(prev => new Set(prev).add(asset.id));
      }
      await onPick(asset);
    } catch (e) { setError(errorMessage(e, "Could not add the asset to the project")); }
    finally { setBusyId(null); }
  }

  return <div role="dialog" aria-modal="true" aria-label={title} data-testid="asset-picker" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "#0009", display: "grid", placeItems: "center", zIndex: 1000, padding: 12 }}>
    <div style={{ background: "#fff", color: "#18202a", borderRadius: 10, width: "min(860px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 18, gap: 10, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h2 style={{ margin: 0, flex: 1, fontSize: 20 }}>{title}</h2><button onClick={onClose} aria-label="Close">✕</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input data-testid="asset-picker-search" placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1, minWidth: 160, padding: 7 }} />
        <select aria-label="Kind" data-testid="asset-picker-kind" value={filter} onChange={e => setFilter(e.target.value as AssetKind)} style={{ padding: 7 }}><option value="all">Images and audio</option><option value="image">Images</option><option value="audio">Audio</option></select>
      </div>
      {!searching && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}><button onClick={() => setCurrentId(null)} style={{ fontWeight: currentId ? 400 : 700 }}>Root</button>{path.map(f => <span key={f.id}>/ <button onClick={() => setCurrentId(f.id)}>{f.name}</button></span>)}</div>}
      {error && <div role="alert" style={{ padding: 8, background: "#fee" }}>{error}</div>}
      <div style={{ overflow: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12, alignContent: "start", minHeight: 200 }}>
        {visibleFolders.map(f => <button key={f.id} data-testid="asset-picker-folder" onClick={() => setCurrentId(f.id)} style={{ padding: 14, textAlign: "left", border: "1px solid #ccc", borderRadius: 8, background: "#fff" }}><span style={{ fontSize: 28 }}>📁</span><br /><strong>{f.name}</strong></button>)}
        {visibleAssets.map(a => {
          const inProject = linked.has(a.id);
          const disabled = busyId !== null || (inProject && !pickLinked);
          return <div key={a.id} data-testid="asset-picker-item" data-asset-key={a.assetKey} style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" }}>
            <div style={{ height: 100, background: "#f4f4f4", display: "grid", placeItems: "center" }}>
              {isAudio(a) ? <div style={{ width: "100%", padding: "0 6px", display: "grid", gap: 4, placeItems: "center" }}><span style={{ fontSize: 28 }}>🎙</span><audio controls preload="none" src={`/api/assets/${a.id}`} style={{ width: "100%", height: 30 }} /></div>
                : <img src={`/api/assets/${a.id}`} alt={a.assetKey} loading="lazy" style={{ maxWidth: "100%", maxHeight: 100, objectFit: "contain" }} />}
            </div>
            <div style={{ padding: 8, display: "grid", gap: 4, flex: 1 }}>
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.assetKey}>{a.assetKey}</strong>
              <small style={{ color: "#666" }}>{isAudio(a) ? `Audio · ${fmtDuration(a.durationMs)}` : `${a.width ?? "?"} × ${a.height ?? "?"}`}{searching ? ` · ${folderName(a.folderId)}` : ""}</small>
              {inProject && <small data-testid="asset-picker-linked" style={{ color: "#166534", fontWeight: 600 }}>✓ In this project</small>}
              <button disabled={disabled} onClick={() => void choose(a)} style={{ marginTop: "auto" }}>{busyId === a.id ? "Adding…" : inProject ? (pickLinked ? "Use" : "Added") : pickLinked ? "Add and use" : "Add to project"}</button>
            </div>
          </div>;
        })}
        {loaded && !visibleFolders.length && !visibleAssets.length && <div style={{ gridColumn: "1 / -1", padding: 30, textAlign: "center", color: "#777" }}>{searching ? "No assets match the search." : "Nothing here."}</div>}
        {!loaded && <div style={{ gridColumn: "1 / -1", padding: 30, textAlign: "center", color: "#777" }}>Loading…</div>}
      </div>
    </div>
  </div>;
}
