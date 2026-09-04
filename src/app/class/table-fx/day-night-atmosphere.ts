import { FilterType, GameTable } from '../game-table';

/** Day / dusk / night targets for darkness + ambient (環境光) bars. */
export const DAY_NIGHT_ATMOSPHERE = {
  day: { darkness: 0, ambient: 1 },
  dusk: { darkness: 0.4, ambient: 0.55 },
  /** Deep night: cool and dark (amber warmth is dusk-only). */
  night: { darkness: 0.85, ambient: 0.08 },
} as const;

export type DayNightPreset = keyof typeof DAY_NIGHT_ATMOSPHERE;

/** Darkness value at which night / black backdrop filter kicks in. */
export const NIGHT_DARKNESS_THRESHOLD = 0.7;

/**
 * Map darkness veil opacity.
 * Soft through dusk so mid slider has levels; steep into night so presets feel dark.
 */
export function darknessOverlayAlpha(darkness: number): number {
  const d = Math.max(0, Math.min(1, darkness ?? 0));
  if (d <= 0) return 0;
  if (d < NIGHT_DARKNESS_THRESHOLD) {
    // 0→0.7 → 0→~0.48 (lighter than linear mid)
    return Math.pow(d / NIGHT_DARKNESS_THRESHOLD, 1.35) * 0.48;
  }
  // 0.7→1 → 0.48→0.95 (commit to night black)
  const t = (d - NIGHT_DARKNESS_THRESHOLD) / (1 - NIGHT_DARKNESS_THRESHOLD);
  return 0.48 + t * 0.47;
}

/**
 * Amber only around dusk; fully cool by night threshold so night is not yellow.
 * Returns 0–1 warmth mix for the overlay RGB.
 */
export function darknessOverlayWarmth(darkness: number): number {
  const d = Math.max(0, Math.min(1, darkness ?? 0));
  if (d >= NIGHT_DARKNESS_THRESHOLD) return 0;
  const duskCenter = 0.4;
  // Zero warmth by ~0.68 (just before night).
  return Math.max(0, 1 - Math.abs(d - duskCenter) / 0.28);
}

/** Solid CSS color for map plane AA / underlay (matches lighting veil RGB). */
export function darknessOverlayRgb(darkness: number): string {
  const { r, g, b } = darknessOverlayRgbChannels(darkness);
  return `rgb(${r}, ${g}, ${b})`;
}

export function darknessOverlayCssColor(darkness: number, alpha?: number): string {
  const a = Math.min(0.94, alpha ?? darknessOverlayAlpha(darkness));
  const { r, g, b } = darknessOverlayRgbChannels(darkness);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function darknessOverlayRgbChannels(darkness: number): { r: number; g: number; b: number } {
  const warmth = darknessOverlayWarmth(darkness);
  const cool = 1 - warmth;
  return {
    r: Math.round(4 + 220 * warmth + 2 * cool),
    g: Math.round(2 + 140 * warmth + 4 * cool),
    b: Math.round(10 + 8 * warmth + 22 * cool),
  };
}

/**
 * Parallax / surroundings dim (環境光).
 * Ambient 1 = fully bright surroundings; 0 = fully dimmed.
 */
export function surroundingsDimAlpha(ambient: number): number {
  const a = Math.max(0, Math.min(1, ambient ?? 1));
  return 1 - a;
}

/** Tween darkness + ambient together (map setting + toolbox day/night). */
export function animateDayNightAtmosphere(
  table: GameTable,
  preset: DayNightPreset,
  durationMs = 800,
): void {
  const target = DAY_NIGHT_ATMOSPHERE[preset];
  table.backgroundFilterType =
    target.darkness >= NIGHT_DARKNESS_THRESHOLD ? FilterType.BLACK : FilterType.NONE;
  const startDarkness = table.darkness ?? 0;
  const startAmbient = table.globalIllumination ?? 1;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / durationMs);
    if (p >= 1) {
      table.darkness = target.darkness;
      table.globalIllumination = target.ambient;
      return;
    }
    table.darkness = startDarkness + (target.darkness - startDarkness) * p;
    table.globalIllumination = startAmbient + (target.ambient - startAmbient) * p;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function isDayAtmosphere(darkness: number): boolean {
  return darkness < 0.2;
}

export function isDuskAtmosphere(darkness: number): boolean {
  return darkness >= 0.2 && darkness < NIGHT_DARKNESS_THRESHOLD;
}

export function isNightAtmosphere(darkness: number): boolean {
  return darkness >= NIGHT_DARKNESS_THRESHOLD;
}
