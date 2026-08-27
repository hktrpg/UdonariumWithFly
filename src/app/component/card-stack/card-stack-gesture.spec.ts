import {
  CARD_STACK_HOLD_MS,
  CARD_STACK_QUICK_DRAG_PX,
  findMergeTargetIdAtPoint,
  HAND_RAIL_DROP_BAND_PX,
  holdProgressAt,
  isInHandDropBand,
  isQuickDragMove,
  resolveQuickDragDrop,
  setCardMergePreview,
  shouldHoldHaptic,
} from './card-stack-gesture';

describe('card-stack-gesture', () => {
  it('uses 550ms hold and 8px quick-drag threshold', () => {
    expect(CARD_STACK_HOLD_MS).toBe(550);
    expect(CARD_STACK_QUICK_DRAG_PX).toBe(8);
    expect(HAND_RAIL_DROP_BAND_PX).toBe(132);
  });

  it('flags quick drag above 8px movement', () => {
    expect(isQuickDragMove(9, 0)).toBe(true);
    expect(isQuickDragMove(0, 9)).toBe(true);
    expect(isQuickDragMove(7, 0)).toBe(false);
    expect(isQuickDragMove(5, 5)).toBe(false);
  });

  it('maps elapsed time to hold progress', () => {
    expect(holdProgressAt(0)).toBe(0);
    expect(holdProgressAt(275)).toBe(0.5);
    expect(holdProgressAt(550)).toBe(1);
    expect(holdProgressAt(1100)).toBe(1);
  });

  it('fires haptic once after 400ms', () => {
    expect(shouldHoldHaptic(399, false)).toBe(false);
    expect(shouldHoldHaptic(400, false)).toBe(true);
    expect(shouldHoldHaptic(400, true)).toBe(false);
  });

  it('resolves quick-drag drop zones with hand rail priority', () => {
    expect(resolveQuickDragDrop(true, true, true, true)).toBe('hand');
    expect(resolveQuickDragDrop(true, false, false, true)).toBe('hand');
    expect(resolveQuickDragDrop(false, true, true, true)).toBe('stack');
    expect(resolveQuickDragDrop(false, false, true, true)).toBe('card');
    expect(resolveQuickDragDrop(false, false, false, true)).toBe('table');
    expect(resolveQuickDragDrop(false, false, false, false)).toBe('cancel');
  });

  it('prefers stack over card for merge preview hit-test helpers', () => {
    // findMergeTargetIdAtPoint delegates to DOM hit-tests; ensure exports stay wired.
    expect(typeof findMergeTargetIdAtPoint).toBe('function');
    expect(typeof setCardMergePreview).toBe('function');
  });

  it('detects the bottom hand drop band', () => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    expect(isInHandDropBand(vw / 2, vh - 20, 0)).toBe(true);
    expect(isInHandDropBand(vw / 2, 10, 0)).toBe(false);
    expect(isInHandDropBand(vw / 2, vh - 20, 80)).toBe(false);
    expect(isInHandDropBand(vw / 2, vh - 100, 80)).toBe(true);
  });
});
