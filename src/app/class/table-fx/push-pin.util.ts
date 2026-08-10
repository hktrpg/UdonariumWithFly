/** Shared push-pin helpers for clue-board tokens / notes. */

export type TokenFrameStyle = 'none' | 'polaroid' | 'photo' | 'card';
export type PaperStyle = 'none' | 'a4' | 'sticky';

export const TOKEN_FRAME_STYLES: TokenFrameStyle[] = ['none', 'polaroid', 'photo', 'card'];
export const PAPER_STYLES: PaperStyle[] = ['none', 'a4', 'sticky'];

/** Deterministic angle in [-25, 25] from an identifier string. */
export function pinAngleFromId(id: string): number {
  let h = 0;
  const s = id || 'pin';
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 51) - 25);
}

export function randomPinAngle(): number {
  return Math.round((Math.random() * 50 - 25) * 10) / 10;
}

/** Oblique pin styles used in-game (random pick). */
export const PUSH_PIN_ACTIVE_STYLES = [2, 3, 6, 7] as const;
export type PushPinActiveStyleId = typeof PUSH_PIN_ACTIVE_STYLES[number];

const PIN_ANGLED_DIR = './assets/images/clue-board/pins/angled/';

export function pushPinStyleUrl(styleId: number): string {
  const id = isActivePushPinStyle(styleId) ? styleId : 3;
  return `${PIN_ANGLED_DIR}style-${id}.png`;
}

export function isActivePushPinStyle(style: number | null | undefined): style is PushPinActiveStyleId {
  return !!style && (PUSH_PIN_ACTIVE_STYLES as readonly number[]).includes(style);
}

/** Random style from the active pool {2, 3, 6, 7}. */
export function randomPushPinStyle(): PushPinActiveStyleId {
  const pool = PUSH_PIN_ACTIVE_STYLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Deterministic pool pick (for legacy style=0 without re-rolling every frame). */
export function pushPinStyleFromId(id: string): PushPinActiveStyleId {
  let h = 0;
  const s = id || 'pin';
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const pool = PUSH_PIN_ACTIVE_STYLES;
  return pool[Math.abs(h) % pool.length];
}

export function normalizePushPinStyle(
  style: number | null | undefined,
  hostId?: string,
): PushPinActiveStyleId {
  if (isActivePushPinStyle(style)) return style;
  return pushPinStyleFromId(hostId || '');
}

/**
 * Oblique pin asset. Fine tilt still applied via CSS rotate(pushPinAngle).
 * `color` is ignored (kept for call-site compat); art is chosen by styleId.
 */
export function pushPinAssetUrl(
  _color: string,
  _angleDeg?: number,
  styleId?: number,
  hostId?: string,
): string {
  return pushPinStyleUrl(normalizePushPinStyle(styleId, hostId));
}

/** A4 portrait aspect (width / height in grid units → height = width * √2). */
export function a4HeightForWidth(width: number): number {
  return Math.round(width * Math.SQRT2 * 100) / 100;
}

export interface PinHost {
  pushPin: boolean;
  pushPinAngle: number;
  pushPinStyle?: number;
  location: { x: number; y: number };
  rotate?: number;
}

/**
 * Token-style host: location is the top-left of the footprint.
 * Pin sits near that corner (with inset), then rotated around footprint center.
 */
export function pinAnchorPx(
  host: PinHost,
  widthPx: number,
  heightPx: number,
  inset = 10,
): { x: number; y: number } {
  const lx = inset;
  const ly = inset;
  return rotateAround(
    host.location.x + widthPx / 2,
    host.location.y + heightPx / 2,
    host.location.x + lx,
    host.location.y + ly,
    host.rotate || 0,
  );
}

/**
 * TextNote geometry: movable origin is the bottom-center of the paper
 * (content uses translateX(-50%), face hinged at bottom:0).
 * Table Y grows downward, so the title/top edge is at location.y - height.
 * Pin sits at the visual top-left (title-bar corner).
 */
export function notePinAnchorPx(
  host: PinHost,
  widthPx: number,
  heightPx: number,
  inset = 12,
): { x: number; y: number } {
  const lx = -widthPx / 2 + inset;
  const ly = -heightPx + inset;
  return rotateAround(
    host.location.x,
    host.location.y,
    host.location.x + lx,
    host.location.y + ly,
    host.rotate || 0,
  );
}

function rotateAround(
  cx: number,
  cy: number,
  x: number,
  y: number,
  deg: number,
): { x: number; y: number } {
  const rot = (deg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/** Quadratic Bezier path approximating a sagging string (catenary look). */
export function stringPathD(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag = 0.22,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const drop = dist * Math.max(0.05, Math.min(0.55, sag));
  return `M ${x1} ${y1} Q ${mx} ${my + drop} ${x2} ${y2}`;
}
