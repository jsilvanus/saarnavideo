export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function snapValue(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

export function snapAngle(angle: number, increment = 15): number {
  return Math.round(angle / increment) * increment;
}

export function snapRectToLayers(
  rect: Rect,
  others: Rect[],
  threshold = 10,
): Rect {
  let { x, y } = rect;
  const right = x + rect.width;
  const bottom = y + rect.height;

  for (const other of others) {
    const otherRight = other.x + other.width;
    const otherBottom = other.y + other.height;

    if (Math.abs(x - other.x) <= threshold) x = other.x;
    else if (Math.abs(x - otherRight) <= threshold) x = otherRight;
    else if (Math.abs(right - other.x) <= threshold) x = other.x - rect.width;
    else if (Math.abs(right - otherRight) <= threshold) x = otherRight - rect.width;

    if (Math.abs(y - other.y) <= threshold) y = other.y;
    else if (Math.abs(y - otherBottom) <= threshold) y = otherBottom;
    else if (Math.abs(bottom - other.y) <= threshold) y = other.y - rect.height;
    else if (Math.abs(bottom - otherBottom) <= threshold) y = otherBottom - rect.height;
  }

  return { ...rect, x: Math.round(x), y: Math.round(y) };
}
