export const GRID_SIZE = 20;
export const SNAP_THRESHOLD = 10;

export type RectLike = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function handleAnchor(handle: string, layer: RectLike) {
  return {
    left: handle.includes("e") ? layer.x + layer.width : handle.includes("w") ? layer.x : layer.x + layer.width / 2,
    top: handle.includes("s") ? layer.y + layer.height : handle.includes("n") ? layer.y : layer.y + layer.height / 2,
  };
}

export function applyResize(handle: string, start: RectLike, dx: number, dy: number) {
  let { x, y, width, height } = start;
  if (handle.includes("e")) width += dx;
  if (handle.includes("w")) { x += dx; width -= dx; }
  if (handle.includes("s")) height += dy;
  if (handle.includes("n")) { y += dy; height -= dy; }
  return { x: Math.round(x), y: Math.round(y), width: Math.max(20, Math.round(width)), height: Math.max(20, Math.round(height)) };
}

export function gridSnap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/** Snap the moving rectangle's left/right/centre and top/bottom/centre to nearby layers. */
export function snapToLayerEdges(
  x: number,
  y: number,
  moving: RectLike,
  layers: RectLike[],
  movingIds: Set<string>,
) {
  const me = { l: x, r: x + moving.width, cx: x + moving.width / 2, t: y, b: y + moving.height, cy: y + moving.height / 2 };
  let bestX = SNAP_THRESHOLD;
  let bestY = SNAP_THRESHOLD;
  let dx = 0;
  let dy = 0;

  for (const other of layers) {
    if (movingIds.has(other.id)) continue;
    const oe = { l: other.x, r: other.x + other.width, cx: other.x + other.width / 2, t: other.y, b: other.y + other.height, cy: other.y + other.height / 2 };
    for (const a of ["l", "r", "cx"] as const) for (const b of ["l", "r", "cx"] as const) {
      const distance = Math.abs(me[a] - oe[b]);
      if (distance < bestX) { bestX = distance; dx = oe[b] - me[a]; }
    }
    for (const a of ["t", "b", "cy"] as const) for (const b of ["t", "b", "cy"] as const) {
      const distance = Math.abs(me[a] - oe[b]);
      if (distance < bestY) { bestY = distance; dy = oe[b] - me[a]; }
    }
  }

  return { x: x + dx, y: y + dy };
}

export function rotationFromPointerAngle(centerX: number, centerY: number, pointerX: number, pointerY: number) {
  return Math.atan2(pointerY - centerY, pointerX - centerX) * 180 / Math.PI + 90;
}

export function snapRotation(degrees: number, enabled: boolean) {
  return enabled ? Math.round(degrees / 15) * 15 : degrees;
}
