import { GameCharacter } from '@udonarium/game-character';
import { ImageEffectSource } from '@udonarium/table-fx/image-effect';
import { MaskTokenFxConfig } from '@udonarium/table-fx/mask-appearance';

export interface MaskTokenFxSnapshot {
  isInverse: boolean;
  isHollow: boolean;
  isBlackPaint: boolean;
  isGrayscale: boolean;
  isSepia: boolean;
  isWhitePaint: boolean;
  isMatrix: boolean;
  isFlipVertical: boolean;
  isContrast: boolean;
  altitude: number;
  altitudeTouched: boolean;
}

const FX_KEYS: (keyof ImageEffectSource)[] = [
  'isInverse',
  'isHollow',
  'isBlackPaint',
  'isGrayscale',
  'isSepia',
  'isWhitePaint',
  'isMatrix',
  'isFlipVertical',
  'isContrast',
];

export function snapshotCharacterTokenFx(ch: GameCharacter): MaskTokenFxSnapshot {
  return {
    isInverse: !!ch.isInverse,
    isHollow: !!ch.isHollow,
    isBlackPaint: !!ch.isBlackPaint,
    isGrayscale: !!ch.isGrayscale,
    isSepia: !!ch.isSepia,
    isWhitePaint: !!ch.isWhitePaint,
    isMatrix: !!ch.isMatrix,
    isFlipVertical: !!ch.isFlipVertical,
    isContrast: !!ch.isContrast,
    altitude: Number(ch.altitude) || 0,
    altitudeTouched: false,
  };
}

/** Apply mask FX config to character; returns snapshot taken before apply. */
export function applyMaskTokenFxToCharacter(ch: GameCharacter, cfg: MaskTokenFxConfig): MaskTokenFxSnapshot {
  const snap = snapshotCharacterTokenFx(ch);
  if (!ch || !cfg) return snap;
  for (const key of FX_KEYS) {
    (ch as any)[key] = !!cfg[key];
  }
  const mode = cfg.altitudeMode || 'none';
  if (mode === 'set') {
    ch.altitude = Number(cfg.altitude) || 0;
    snap.altitudeTouched = true;
  } else if (mode === 'delta') {
    ch.altitude = (Number(ch.altitude) || 0) + (Number(cfg.altitude) || 0);
    snap.altitudeTouched = true;
  }
  ch.syncAppearanceToCurrentViewPlacement();
  return snap;
}

export function restoreMaskTokenFxSnapshot(ch: GameCharacter, snap: MaskTokenFxSnapshot): void {
  if (!ch || !snap) return;
  ch.isInverse = snap.isInverse;
  ch.isHollow = snap.isHollow;
  ch.isBlackPaint = snap.isBlackPaint;
  ch.isGrayscale = snap.isGrayscale;
  ch.isSepia = snap.isSepia;
  ch.isWhitePaint = snap.isWhitePaint;
  ch.isMatrix = snap.isMatrix;
  ch.isFlipVertical = snap.isFlipVertical;
  ch.isContrast = snap.isContrast;
  if (snap.altitudeTouched) {
    ch.altitude = snap.altitude;
  }
  ch.syncAppearanceToCurrentViewPlacement();
}
