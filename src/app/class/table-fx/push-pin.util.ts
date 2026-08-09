/** Shared push-pin helpers for clue-board tokens / notes. */

export type PushPinColor = 'red' | 'white' | 'yellow' | 'green';
export type TokenFrameStyle = 'none' | 'polaroid' | 'photo' | 'card';
export type PaperStyle = 'none' | 'a4' | 'sticky';

export const PUSH_PIN_COLORS: PushPinColor[] = ['red', 'white', 'yellow', 'green'];
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

export function pinColorCss(color: string): string {
  switch (color) {
    case 'white': return '#f5f5f0';
    case 'yellow': return '#e8c84a';
    case 'green': return '#6bbf6b';
    case 'red':
    default: return '#d32f2f';
  }
}

/** A4 portrait aspect (width / height in grid units → height = width * √2). */
export function a4HeightForWidth(width: number): number {
  return Math.round(width * Math.SQRT2 * 100) / 100;
}

export interface PinHost {
  pushPin: boolean;
  pushPinAngle: number;
  pushPinColor: string;
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
