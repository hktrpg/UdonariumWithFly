import { FilterType, GameTable } from '../game-table';

/** Day / dusk / night targets for darkness + ambient (環境光) bars. */
export const DAY_NIGHT_ATMOSPHERE = {
  day: { darkness: 0, ambient: 1 },
  dusk: { darkness: 0.4, ambient: 0.55 },
  night: { darkness: 0.85, ambient: 0.15 },
} as const;

export type DayNightPreset = keyof typeof DAY_NIGHT_ATMOSPHERE;

/**
 * Darkness overlay opacity.
 * Darkness sets the max veil; the ambient bar fully counters it (weight 1, not a weak factor).
 */
export function darknessOverlayAlpha(darkness: number, ambient: number): number {
  const d = Math.max(0, Math.min(1, darkness ?? 0));
  const a = Math.max(0, Math.min(1, ambient ?? 1));
  return d * (1 - a);
}

/** Tween darkness + ambient together (map setting + toolbox day/night). */
export function animateDayNightAtmosphere(
  table: GameTable,
  preset: DayNightPreset,
  durationMs = 800,
): void {
  const target = DAY_NIGHT_ATMOSPHERE[preset];
  table.backgroundFilterType = target.darkness >= 0.5 ? FilterType.BLACK : FilterType.NONE;
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
  return darkness >= 0.2 && darkness < 0.5;
}

export function isNightAtmosphere(darkness: number): boolean {
  return darkness >= 0.5;
}
