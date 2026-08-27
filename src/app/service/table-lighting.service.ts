import { Injectable } from '@angular/core';

import { GameTable } from '@udonarium/game-table';
import { MovableDirective } from 'directive/movable.directive';
import { VisionLightActor } from 'component/game-table/vision-math';

export interface PointLightSource {
  x: number;
  y: number;
  brightRadius: number;
  dimRadius: number;
  intensity: number;
  /** Set for token-carried lights so self-shadow can be skipped. */
  actorId?: string;
}

/**
 * Directional under-foot shadow (map space).
 * Up to three strongest lights fan out from the feet.
 */
export interface TokenShadowCast {
  /** Unit direction away from the light (map space). */
  dirX: number;
  dirY: number;
  /** Elongation along dir: 1 = base floor length, up to {@link MAX_SHADOW_LENGTH_FACTOR}. */
  stretch: number;
  strength: number;
}

export interface ShadowCastMetrics {
  radiusPx: number;
  heightPx: number;
  excludeActorId?: string;
}

/** Up to three strongest casts when multiple lights are in range (fan-out). */
const MAX_SHADOWS_PER_TOKEN = 3;

@Injectable({ providedIn: 'root' })
export class TableLightingService {
  private shadowsByCharacterId = new Map<string, TokenShadowCast[]>();

  getShadowsForCharacter(characterId: string): TokenShadowCast[] {
    return this.shadowsByCharacterId.get(characterId) ?? [];
  }

  clearShadows() {
    this.shadowsByCharacterId.clear();
  }

  /**
   * Recompute under-foot directional shadows from map lamps + token-carried lights.
   * Self-lights are skipped via actorId (a lit token does not cast on itself).
   */
  updateTokenShadows(table: GameTable, lightCharacters: VisionLightActor[]) {
    this.shadowsByCharacterId.clear();
    if (!table) return;

    const darkness = Math.max(0, Math.min(1, table.darkness ?? 0));
    const sources = collectPointLightSources(table, lightCharacters, darkness);
    if (!sources.length) return;

    const grid = table.gridSize || 50;
    for (const ch of lightCharacters || []) {
      if (!ch?.identifier) continue;
      const center = actorCenter(ch, grid);
      const radiusPx = (ch.size * grid) / 2;
      const heightPx = Math.max(ch.size * grid, 1);
      const casts = shadowCastsForPoint(center.x, center.y, sources, {
        radiusPx,
        heightPx,
        excludeActorId: ch.identifier,
      });
      if (casts.length) this.shadowsByCharacterId.set(ch.identifier, casts);
    }
  }
}

export function actorCenter(
  ch: VisionLightActor,
  grid: number,
): { x: number; y: number } {
  const live = MovableDirective.livePoseFor(ch.identifier);
  const withPose = ch as VisionLightActor & { getPoseForView?: () => { x: number; y: number } };
  const pose = live ?? withPose.getPoseForView?.() ?? ch.location;
  return {
    x: pose.x + (ch.size * grid) / 2,
    y: pose.y + (ch.size * grid) / 2,
  };
}

export function rotateTableOffset(dx: number, dy: number, rotateDeg: number): { dx: number; dy: number } {
  if (!rotateDeg) return { dx, dy };
  const rad = (-rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: dx * cos - dy * sin,
    dy: dx * sin + dy * cos,
  };
}

/** Map-placed lamps only (see updateTokenShadows). */
export function collectMapLightSources(table: GameTable, darkness: number): PointLightSource[] {
  const sources: PointLightSource[] = [];
  for (const light of table.lights || []) {
    if (!light.isActiveAtDarkness(darkness)) continue;
    sources.push({
      x: light.x,
      y: light.y,
      brightRadius: Math.max(0, light.brightRadius),
      dimRadius: Math.max(0, light.dimRadius),
      intensity: light.intensity ?? 0.7,
    });
  }
  return sources;
}

/** Map lamps + token-carried lights (token lights tagged with actorId). */
export function collectPointLightSources(
  table: GameTable,
  lightCharacters: VisionLightActor[],
  darkness: number,
): PointLightSource[] {
  const grid = table.gridSize || 50;
  const sources = collectMapLightSources(table, darkness);
  for (const ch of lightCharacters || []) {
    const dimGrid = ch.dimLightGrid;
    if (dimGrid <= 0) continue;
    const center = actorCenter(ch, grid);
    sources.push({
      x: center.x,
      y: center.y,
      brightRadius: ch.brightLightGrid * grid,
      dimRadius: dimGrid * grid,
      intensity: 0.75,
      actorId: ch.identifier,
    });
  }
  return sources;
}

/** Stretch multiplier vs default floor length: 1 = base, max 2.3× when close to light. */
export const MAX_SHADOW_LENGTH_FACTOR = 2.3;
/** Default ground projection of standing art (same idea as former outer scale Y). */
const BASE_FLOOR_ALONG = 0.66;

/** Stretch factor from proximity (closer → longer), capped at {@link MAX_SHADOW_LENGTH_FACTOR}. */
export function shadowStretchForDistance(dist: number, reach: number, intensity: number): number {
  const falloff = 1 - Math.min(1, Math.max(0, dist) / Math.max(reach, 1));
  const intensity01 = Math.max(0, Math.min(1, intensity));
  return 1 + (MAX_SHADOW_LENGTH_FACTOR - 1) * falloff * falloff * intensity01;
}

/**
 * Feet-pinned cast (transform-origin: center bottom).
 * Aligns image “up” with the light-away direction, then elongates/deforms along
 * that axis up to {@link MAX_SHADOW_LENGTH_FACTOR}× the base floor length.
 * Floor squash is baked into the along-axis scale (not an outer scale(1,0.66)).
 */
export function directionalShadowStretch(dirX: number, dirY: number, stretch: number): string {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6) return 'none';
  const nx = dirX / len;
  const ny = dirY / len;
  const angleDeg = (Math.atan2(nx, -ny) * 180) / Math.PI;
  const angle = Math.abs(angleDeg) < 1e-6 ? 0 : angleDeg;
  const factor = Math.min(MAX_SHADOW_LENGTH_FACTOR, Math.max(1, stretch));
  const along = BASE_FLOOR_ALONG * factor;
  // Longer casts skim narrower (simple ground-projection deform).
  const t = (factor - 1) / (MAX_SHADOW_LENGTH_FACTOR - 1);
  const width = 0.95 - 0.22 * t;
  return `rotateZ(${angle}deg) scale(${width}, ${along})`;
}

/** @deprecated */
export function projectiveShadowTransform(
  dirX: number,
  dirY: number,
  length: number,
  _width: number,
  _imgW: number,
  imgH: number,
): string {
  const stretch = 1 + Math.min(0.85, Math.max(0, length) / Math.max(imgH, 1));
  return directionalShadowStretch(dirX, dirY, stretch);
}

/** @deprecated */
export function projectiveShadowMatrix(
  dirX: number,
  dirY: number,
  length: number,
  width: number,
  imgW: number,
  imgH: number,
): string {
  return projectiveShadowTransform(dirX, dirY, length, width, imgW, imgH);
}

/** @deprecated length helper kept for older specs */
export function clampedShadowLength(
  dist: number,
  _radiusPx: number,
  reach: number,
  heightPx: number,
): number {
  const H = Math.max(heightPx, 1);
  const stretch = shadowStretchForDistance(dist, reach, 1);
  return H * stretch;
}

export function shadowCastsForPoint(
  x: number,
  y: number,
  sources: PointLightSource[],
  metrics: ShadowCastMetrics,
): TokenShadowCast[] {
  const casts: TokenShadowCast[] = [];
  const excludeActorId = metrics.excludeActorId;

  for (const light of sources) {
    if (excludeActorId && light.actorId === excludeActorId) continue;
    const ox = x - light.x;
    const oy = y - light.y;
    const dist = Math.sqrt(ox * ox + oy * oy) || 1;
    const reach = Math.max(light.dimRadius, light.brightRadius, 1);
    if (dist > reach) continue;
    if (dist < 8) continue;

    const falloff = 1 - Math.min(1, dist / reach);
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    const strength = Math.min(1, intensity * (0.25 + 0.75 * falloff));
    if (strength < 0.06) continue;

    const stretch = shadowStretchForDistance(dist, reach, intensity);

    casts.push({
      dirX: ox / dist,
      dirY: oy / dist,
      stretch,
      strength,
    });
  }

  casts.sort((a, b) => b.strength - a.strength);
  // Weaker / shorter trailing casts so fan-out stays feet-anchored.
  return casts.slice(0, MAX_SHADOWS_PER_TOKEN).map((c, i) => ({
    ...c,
    stretch: 1 + (Math.max(1, c.stretch) - 1) * (1 - i * 0.28),
    strength: c.strength * (1 - i * 0.22),
  }));
}
