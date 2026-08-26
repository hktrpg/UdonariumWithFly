export const CARD_STACK_HOLD_MS = 550;
export const CARD_STACK_QUICK_DRAG_PX = 8;
export const CARD_STACK_HOLD_HAPTIC_MS = 400;

/** Bottom drop-band height (px) used while quick-dragging a card into hand. */
export const HAND_RAIL_DROP_BAND_PX = 132;

export function isQuickDragMove(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > CARD_STACK_QUICK_DRAG_PX ** 2;
}

export function holdProgressAt(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / CARD_STACK_HOLD_MS));
}

export function shouldHoldHaptic(elapsedMs: number, alreadyVibrated: boolean): boolean {
  return !alreadyVibrated && elapsedMs >= CARD_STACK_HOLD_HAPTIC_MS;
}

export type QuickDragDropTarget = 'hand' | 'stack' | 'card' | 'table' | 'cancel';

/** Resolve quick-drag drop target (hand rail > card stack > card > table). */
export function resolveQuickDragDrop(
  isHandRail: boolean,
  isStack: boolean,
  isCard: boolean,
  isTable: boolean,
): QuickDragDropTarget {
  if (isHandRail) return 'hand';
  if (isStack) return 'stack';
  if (isCard) return 'card';
  if (isTable) return 'table';
  return 'cancel';
}

/** Find a tabletop card-stack under screen coordinates (topmost wins). Skips `excludeId`. */
export function findCardStackIdAtPoint(clientX: number, clientY: number, excludeId?: string): string | null {
  if (typeof document === 'undefined') return null;
  const hits = document.elementsFromPoint(clientX, clientY);
  for (const el of hits) {
    const host = el.closest?.('card-stack');
    if (!host) continue;
    const id = host.getAttribute('data-stack-id');
    if (!id || id === excludeId) continue;
    return id;
  }
  return null;
}

/** Find a tabletop card under screen coordinates (topmost wins). Skips `excludeId`. */
export function findCardIdAtPoint(clientX: number, clientY: number, excludeId?: string): string | null {
  if (typeof document === 'undefined') return null;
  const hits = document.elementsFromPoint(clientX, clientY);
  for (const el of hits) {
    const host = el.closest?.('card');
    if (!host) continue;
    // Prefer data-stack-id (game-table sets it for cards); fall back to nothing.
    const id = host.getAttribute('data-stack-id');
    if (!id || id === excludeId) continue;
    return id;
  }
  return null;
}

/** Prefer card-stack over loose card when both sit under the pointer. */
export function findCardOrStackIdAtPoint(clientX: number, clientY: number): string | null {
  return findCardStackIdAtPoint(clientX, clientY) || findCardIdAtPoint(clientX, clientY);
}

/** Viewport bottom strip used as hand drop zone (above optional mobile chrome). */
export function isInHandDropBand(clientX: number, clientY: number, bottomChromePx = 0, bandPx = HAND_RAIL_DROP_BAND_PX): boolean {
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (vw < 1 || vh < 1) return false;
  if (clientX < 0 || clientX > vw) return false;
  const top = vh - bottomChromePx - bandPx;
  return clientY >= top && clientY <= vh - bottomChromePx;
}
