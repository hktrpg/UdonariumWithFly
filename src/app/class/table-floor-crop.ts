import { EventSystem } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';

/** Edge trim percentages (0–45 each side). Display-only — never rewrites the floor bitmap. */
export type FloorCropInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function emptyFloorCropInsets(): FloorCropInsets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function clampFloorInset(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(45, Math.round(n * 10) / 10);
}

export function clampFloorCropInsets(insets: FloorCropInsets): FloorCropInsets {
  let top = clampFloorInset(insets.top);
  let right = clampFloorInset(insets.right);
  let bottom = clampFloorInset(insets.bottom);
  let left = clampFloorInset(insets.left);
  // Keep at least 10% remaining on each axis.
  if (top + bottom > 90) {
    const s = 90 / (top + bottom);
    top *= s;
    bottom *= s;
  }
  if (left + right > 90) {
    const s = 90 / (left + right);
    left *= s;
    right *= s;
  }
  return {
    top: clampFloorInset(top),
    right: clampFloorInset(right),
    bottom: clampFloorInset(bottom),
    left: clampFloorInset(left),
  };
}

export function floorCropInsetsAlmostZero(insets: FloorCropInsets | null | undefined): boolean {
  const i = clampFloorCropInsets(insets || emptyFloorCropInsets());
  return i.top + i.right + i.bottom + i.left < 1e-6;
}

/** CSS clip-path — trims edges without stretching / distorting the map. */
export function floorCropClipPath(insets: FloorCropInsets | null | undefined): string {
  const i = clampFloorCropInsets(insets || emptyFloorCropInsets());
  if (floorCropInsetsAlmostZero(i)) return 'none';
  return `inset(${i.top}% ${i.right}% ${i.bottom}% ${i.left}%)`;
}

export function parseFloorCropJson(raw: string | null | undefined): FloorCropInsets {
  if (!raw || typeof raw !== 'string') return emptyFloorCropInsets();
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return emptyFloorCropInsets();
    return clampFloorCropInsets({
      top: Number(o.top) || 0,
      right: Number(o.right) || 0,
      bottom: Number(o.bottom) || 0,
      left: Number(o.left) || 0,
    });
  } catch {
    return emptyFloorCropInsets();
  }
}

export function serializeFloorCropJson(insets: FloorCropInsets | null | undefined): string {
  const i = clampFloorCropInsets(insets || emptyFloorCropInsets());
  if (floorCropInsetsAlmostZero(i)) return '';
  return JSON.stringify({ top: i.top, right: i.right, bottom: i.bottom, left: i.left });
}

export function readTableFloorCrop(table: GameTable | null | undefined): FloorCropInsets {
  if (!table) return emptyFloorCropInsets();
  return parseFloorCropJson(table.floorCropJson);
}

/**
 * Persist display-only edge trim %. Does not modify the floor image,
 * table size, or object positions (models stay aligned with the aerial).
 */
export function setTableFloorCrop(
  table: GameTable,
  insets: FloorCropInsets | null | undefined,
): boolean {
  if (!table) return false;
  const next = serializeFloorCropJson(insets);
  if ((table.floorCropJson || '') === next) return false;
  table.floorCropJson = next;
  EventSystem.trigger('UPDATE_GAME_OBJECT', table.toContext());
  return true;
}
