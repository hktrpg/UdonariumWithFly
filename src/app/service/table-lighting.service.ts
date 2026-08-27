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

/** One decorative silhouette cast by a single light (away from the source). */
export interface TokenShadowCast {
  dx: number;
  dy: number;
  strength: number;
}

/** @deprecated Prefer TokenShadowCast[]; kept for callers that expect a blend. */
export interface TokenShadowVector {
  dx: number;
  dy: number;
  strength: number;
}

const MAX_SHADOWS_PER_TOKEN = 5;

@Injectable({ providedIn: 'root' })
export class TableLightingService {
  private shadowsByCharacterId = new Map<string, TokenShadowCast[]>();

  /** Latest per-light shadow casts for a tabletop character (updated by game-table refreshFx). */
  getShadowsForCharacter(characterId: string): TokenShadowCast[] {
    return this.shadowsByCharacterId.get(characterId) ?? [];
  }

  /** Blended single vector (legacy). Prefer getShadowsForCharacter. */
  getShadowForCharacter(characterId: string): TokenShadowVector | null {
    const casts = this.getShadowsForCharacter(characterId);
    if (!casts.length) return null;
    let sumDx = 0;
    let sumDy = 0;
    let strength = 0;
    for (const c of casts) {
      sumDx += c.dx;
      sumDy += c.dy;
      strength = Math.max(strength, c.strength);
    }
    return { dx: sumDx / casts.length, dy: sumDy / casts.length, strength };
  }

  clearShadows() {
    this.shadowsByCharacterId.clear();
  }

  /**
   * Recompute per-token decorative shadows from map/token lights.
   * When lights are present, each nearby light casts its own silhouette.
   * Called from game-table refreshFx alongside the lighting canvas.
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
      const casts = shadowCastsForPoint(center.x, center.y, sources, ch.identifier);
      if (casts.length) this.shadowsByCharacterId.set(ch.identifier, casts);
    }
  }
}

/** Tabletop center in map pixels (live drag pose when available). */
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

/** Map-space offset → token-local offset (pedestal rotateZ). */
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

export function collectPointLightSources(
  table: GameTable,
  lightCharacters: VisionLightActor[],
  darkness: number,
): PointLightSource[] {
  const grid = table.gridSize || 50;
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

/** One cast per contributing light, strongest first (capped). */
export function shadowCastsForPoint(
  x: number,
  y: number,
  sources: PointLightSource[],
  excludeActorId?: string,
): TokenShadowCast[] {
  const casts: TokenShadowCast[] = [];

  for (const light of sources) {
    if (excludeActorId && light.actorId === excludeActorId) continue;
    const dx = x - light.x;
    const dy = y - light.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const reach = Math.max(light.dimRadius, light.brightRadius, 1);
    if (dist > reach * 1.35) continue;

    const falloff = 1 - Math.min(1, dist / (reach * 1.35));
    const proximity = falloff;
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    const strength = Math.min(1, intensity * (0.25 + 0.75 * proximity));
    if (strength < 0.06) continue;
    if (dist < 8) continue;

    // Closer + brighter → longer cast; far or dim → shorter (5–64px).
    const lengthFactor = proximity * proximity * intensity;
    const scale = 5 + 59 * lengthFactor;
    casts.push({
      dx: (dx / dist) * scale,
      dy: (dy / dist) * scale,
      strength,
    });
  }

  casts.sort((a, b) => b.strength - a.strength);
  return casts.slice(0, MAX_SHADOWS_PER_TOKEN);
}

/** Blended single vector (tests / legacy). */
export function shadowVectorForPoint(
  x: number,
  y: number,
  sources: PointLightSource[],
): TokenShadowVector {
  const casts = shadowCastsForPoint(x, y, sources);
  if (!casts.length) return { dx: 0, dy: 0, strength: 0 };
  let sumDx = 0;
  let sumDy = 0;
  let strength = 0;
  for (const c of casts) {
    sumDx += c.dx;
    sumDy += c.dy;
    strength = Math.max(strength, c.strength);
  }
  return { dx: sumDx / casts.length, dy: sumDy / casts.length, strength };
}
