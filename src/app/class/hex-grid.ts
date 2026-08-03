import { MathUtil } from '@udonarium/core/system/util/math-util';
import { GridType } from '@udonarium/game-table';

/** Shared hexagonal grid helpers (DodontoF-compatible brick spacing). */

export function isHexGrid(gridType: GridType): boolean {
  return gridType === GridType.HEX_VERTICAL || gridType === GridType.HEX_HORIZONTAL;
}

/** Top-left of the cell's bounding square (matches grid-line-render positions). */
export function hexCellOrigin(col: number, row: number, gridSize: number, gridType: GridType): { x: number; y: number } {
  if (gridType === GridType.HEX_VERTICAL) {
    return {
      x: col * gridSize,
      y: row * gridSize + ((col % 2 === 0) ? gridSize / 2 : 0),
    };
  }
  if (gridType === GridType.HEX_HORIZONTAL) {
    return {
      x: col * gridSize + ((row % 2 === 0) ? gridSize / 2 : 0),
      y: row * gridSize,
    };
  }
  return { x: col * gridSize, y: row * gridSize };
}

export function hexCellCenter(col: number, row: number, gridSize: number, gridType: GridType): { x: number; y: number } {
  const o = hexCellOrigin(col, row, gridSize, gridType);
  return { x: o.x + gridSize / 2, y: o.y + gridSize / 2 };
}

/** Snap pixel position (object top-left) to nearest hex cell origin. */
export function snapToHexCell(x: number, y: number, gridSize: number, gridType: GridType): { x: number; y: number } {
  if (gridSize <= 0 || !isHexGrid(gridType)) {
    return { x, y };
  }
  const approxCol = Math.round(x / gridSize);
  const approxRow = Math.round(y / gridSize);
  let best = hexCellOrigin(approxCol, approxRow, gridSize, gridType);
  let bestDist = (best.x - x) * (best.x - x) + (best.y - y) * (best.y - y);
  for (let dc = -2; dc <= 2; dc++) {
    for (let dr = -2; dr <= 2; dr++) {
      if (dc === 0 && dr === 0) continue;
      const o = hexCellOrigin(approxCol + dc, approxRow + dr, gridSize, gridType);
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
  }
  return best;
}

/** Snap for square (or none) using half-cell interval like legacy movable default. */
export function snapToSquareGrid(x: number, y: number, gridSize: number): { x: number; y: number } {
  const interval = Math.max(1, gridSize / 2);
  return {
    x: snapInterval(x, interval),
    y: snapInterval(y, interval),
  };
}

export function snapToGridPixel(x: number, y: number, gridSize: number, gridType: GridType): { x: number; y: number } {
  if (gridType === GridType.NONE || gridSize <= 0) return { x, y };
  if (isHexGrid(gridType)) return snapToHexCell(x, y, gridSize, gridType);
  return snapToSquareGrid(x, y, gridSize);
}

function snapInterval(num: number, interval: number): number {
  if (interval <= 0) return num;
  num = num < 0 ? num - interval / 2 : num + interval / 2;
  return num - (num % interval);
}

/**
 * Build hex path centered in the cell bounding square at (gx, gy).
 * HEX_VERTICAL = pointy-top; HEX_HORIZONTAL = flat-top (DodontoF).
 */
export function buildHexPath(
  context: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gridSize: number,
  gridType: GridType,
): void {
  let deg = gridType === GridType.HEX_HORIZONTAL ? -30 : 0;
  const radius = gridSize / Math.sqrt(3);
  const cx = gx + gridSize / 2;
  const cy = gy + gridSize / 2;
  context.beginPath();
  for (let i = 0; i < 6; i++) {
    deg += 60;
    const radian = MathUtil.radians(deg);
    const x = Math.cos(radian) * radius + cx;
    const y = Math.sin(radian) * radius + cy;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

export function strokeHexCell(
  context: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gridSize: number,
  gridType: GridType,
): void {
  buildHexPath(context, gx, gy, gridSize, gridType);
  context.stroke();
}

export function fillHexCell(
  context: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gridSize: number,
  gridType: GridType,
): void {
  buildHexPath(context, gx, gy, gridSize, gridType);
  context.fill();
}
