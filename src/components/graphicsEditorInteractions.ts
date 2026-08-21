export type LayerRect = { x: number; y: number; width: number; height: number };

export function moveLayer(
  layer: LayerRect,
  dx: number,
  dy: number,
  options: { grid?: boolean; gridSize?: number; snapTargets?: LayerRect[]; snapThreshold?: number } = {},
): LayerRect {
  const gridSize = options.gridSize ?? 20;
  let next = { ...layer, x: layer.x + dx, y: layer.y + dy };
  if (options.grid) {
    next.x = Math.round(next.x / gridSize) * gridSize;
    next.y = Math.round(next.y / gridSize) * gridSize;
  }
  if (options.snapTargets?.length) {
    const threshold = options.snapThreshold ?? 10;
    const right = next.x + next.width;
    const bottom = next.y + next.height;
    for (const target of options.snapTargets) {
      const tr = target.x + target.width;
      const tb = target.y + target.height;
      const xs = [target.x, tr];
      const ys = [target.y, tb];
      const xCandidates = [next.x, right];
      const yCandidates = [next.y, bottom];
      for (const x of xs) for (const candidate of xCandidates) {
        if (Math.abs(candidate - x) <= threshold) {
          next.x += x - candidate;
          break;
        }
      }
      for (const y of ys) for (const candidate of yCandidates) {
        if (Math.abs(candidate - y) <= threshold) {
          next.y += y - candidate;
          break;
        }
      }
    }
  }
  return { ...next, x: Math.round(next.x), y: Math.round(next.y) };
}

export function nudgeLayer(layer: LayerRect, key: string, amount = 1): LayerRect {
  switch (key) {
    case "ArrowLeft": return { ...layer, x: layer.x - amount };
    case "ArrowRight": return { ...layer, x: layer.x + amount };
    case "ArrowUp": return { ...layer, y: layer.y - amount };
    case "ArrowDown": return { ...layer, y: layer.y + amount };
    default: return layer;
  }
}

export function pushHistory<T>(history: T[][], current: T[], limit = 50): T[][] {
  return [...history, current].slice(-limit);
}

export function undo<T>(history: T[][], current: T[]): { history: T[][]; current: T[] } | null {
  if (!history.length) return null;
  const nextHistory = history.slice(0, -1);
  return { history: nextHistory, current: history[history.length - 1] };
}

export function redo<T>(history: T[][], current: T[]): { history: T[][]; current: T[] } | null {
  if (!history.length) return null;
  return { history: history.slice(0, -1), current };
}
