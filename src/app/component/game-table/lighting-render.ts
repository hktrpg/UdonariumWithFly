import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { TableLight } from '@udonarium/table-fx/table-light';
import { TableWall } from '@udonarium/table-fx/table-wall';

const MAX_LIGHTS = 48;
const MAX_OCCLUDERS = 80;

export interface LightOccluder {
  id: string;
  points: { x: number; y: number }[];
}

interface PointLightSource {
  x: number;
  y: number;
  brightRadius: number;
  dimRadius: number;
  color: string;
  intensity: number;
  /** Skip casting shadows from this occluder (e.g. character holding the light). */
  excludeOccluderId?: string;
}

export class LightingRender {
  constructor(readonly canvasElement: HTMLCanvasElement) {}

  render(
    table: GameTable,
    visionCharacters: GameCharacter[],
    lightCharacters: GameCharacter[],
    occluders: LightOccluder[],
    isGM: boolean,
  ) {
    const width = table.width * table.gridSize;
    const height = table.height * table.gridSize;
    if (this.canvasElement.width !== width) this.canvasElement.width = width;
    if (this.canvasElement.height !== height) this.canvasElement.height = height;

    const ctx = this.canvasElement.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const darkness = Math.max(0, Math.min(1, table.darkness ?? 0));
    const globalLight = Math.max(0, Math.min(1, table.globalIllumination ?? 1));
    const baseAlpha = darkness * (1 - globalLight * 0.35);
    if (baseAlpha <= 0.001 && !table.visionEnabled) return;

    const wallsLight = (table.walls || []).filter(w => w.blocksLight);
    const occluderList = (occluders || []).slice(0, MAX_OCCLUDERS);
    const sources = this.collectLightSources(table, lightCharacters, darkness).slice(0, MAX_LIGHTS);

    if (baseAlpha > 0.001) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.92, baseAlpha)})`;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'destination-out';
      for (const light of sources) {
        this.drawPointLight(ctx, light, wallsLight, occluderList, width, height);
      }

      ctx.globalCompositeOperation = 'source-over';
      for (const light of sources) {
        this.drawLightTint(ctx, light);
      }
    }

    if (table.visionEnabled && !isGM) {
      const wallsVision = (table.walls || []).filter(w => w.blocksVision);
      this.applyVisionMask(ctx, table, visionCharacters, wallsVision, occluderList, width, height);
    }
  }

  private collectLightSources(
    table: GameTable,
    lightCharacters: GameCharacter[],
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
        color: light.color || '#ffd080',
        intensity: light.intensity ?? 0.7,
      });
    }

    for (const ch of lightCharacters || []) {
      const dimGrid = ch.dimLightGrid;
      if (dimGrid <= 0) continue;
      const brightGrid = ch.brightLightGrid;
      sources.push({
        x: ch.location.x + (ch.size * grid) / 2,
        y: ch.location.y + (ch.size * grid) / 2,
        brightRadius: brightGrid * grid,
        dimRadius: dimGrid * grid,
        color: '#ffe2a8',
        intensity: 0.75,
        excludeOccluderId: ch.identifier,
      });
    }

    return sources;
  }

  private drawPointLight(
    ctx: CanvasRenderingContext2D,
    light: PointLightSource,
    walls: TableWall[],
    occluders: LightOccluder[],
    tableW: number,
    tableH: number,
  ) {
    const r = Math.max(light.dimRadius, light.brightRadius, 1);
    ctx.save();
    if (walls.length || occluders.length) {
      ctx.beginPath();
      ctx.rect(0, 0, tableW, tableH);
      for (const wall of walls) {
        this.appendPolylineShadowPath(ctx, light.x, light.y, wall.points, tableW, tableH);
      }
      for (const occ of occluders) {
        if (light.excludeOccluderId && occ.id === light.excludeOccluderId) continue;
        this.appendPolylineShadowPath(ctx, light.x, light.y, this.closedEdges(occ.points), tableW, tableH, true);
      }
      ctx.clip('evenodd');
    }

    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    const bright = Math.max(0, Math.min(r, light.brightRadius));
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    grad.addColorStop(0, `rgba(0,0,0,${0.95 * intensity})`);
    if (bright > 0 && bright < r) {
      grad.addColorStop(bright / r, `rgba(0,0,0,${0.8 * intensity})`);
      grad.addColorStop(Math.min(1, bright / r + 0.08), `rgba(0,0,0,${0.45 * intensity})`);
    } else {
      grad.addColorStop(0.55, `rgba(0,0,0,${0.7 * intensity})`);
    }
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLightTint(ctx: CanvasRenderingContext2D, light: PointLightSource) {
    const r = Math.max(light.dimRadius, 1);
    const rgb = this.hexToRgb(light.color || '#ffd080');
    if (!rgb) return;
    const intensity = Math.max(0, Math.min(1, light.intensity ?? 0.7));
    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.22 * intensity})`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Expand open polyline segments into shadow quads. */
  private appendPolylineShadowPath(
    ctx: CanvasRenderingContext2D,
    lx: number,
    ly: number,
    pts: { x: number; y: number }[],
    tableW: number,
    tableH: number,
    closed = false,
  ) {
    if (!pts || pts.length < 2) return;
    const extent = Math.max(tableW, tableH) * 3;
    const edgeCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ax = a.x - lx;
      const ay = a.y - ly;
      const bx = b.x - lx;
      const by = b.y - ly;
      const aLen = Math.hypot(ax, ay) || 1;
      const bLen = Math.hypot(bx, by) || 1;
      const aFar = { x: lx + (ax / aLen) * extent, y: ly + (ay / aLen) * extent };
      const bFar = { x: lx + (bx / bLen) * extent, y: ly + (by / bLen) * extent };
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(bFar.x, bFar.y);
      ctx.lineTo(aFar.x, aFar.y);
      ctx.closePath();
    }
  }

  private closedEdges(points: { x: number; y: number }[]): { x: number; y: number }[] {
    return points || [];
  }

  private applyVisionMask(
    ctx: CanvasRenderingContext2D,
    table: GameTable,
    characters: GameCharacter[],
    walls: TableWall[],
    occluders: LightOccluder[],
    width: number,
    height: number,
  ) {
    if (!characters.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const grid = table.gridSize || 50;
    const vision = document.createElement('canvas');
    vision.width = width;
    vision.height = height;
    const vctx = vision.getContext('2d');
    vctx.fillStyle = '#000';
    vctx.fillRect(0, 0, width, height);
    vctx.globalCompositeOperation = 'destination-out';

    for (const ch of characters) {
      const cx = ch.location.x + (ch.size * grid) / 2;
      const cy = ch.location.y + (ch.size * grid) / 2;
      const visionR = Math.max(1, ch.visionRangeGrid * grid);
      const brightR = Math.min(visionR, Math.max(0, ch.brightLightGrid * grid));
      const dimR = Math.min(visionR, Math.max(brightR, ch.dimLightGrid * grid || visionR * 0.65));

      vctx.save();
      if (walls.length || occluders.length) {
        vctx.beginPath();
        vctx.rect(0, 0, width, height);
        for (const wall of walls) {
          this.appendPolylineShadowPath(vctx, cx, cy, wall.points, width, height);
        }
        for (const occ of occluders) {
          if (occ.id === ch.identifier) continue;
          this.appendPolylineShadowPath(vctx, cx, cy, occ.points, width, height, true);
        }
        vctx.clip('evenodd');
      }
      const grad = vctx.createRadialGradient(cx, cy, 0, cx, cy, visionR);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      if (brightR > 0 && brightR < visionR) {
        grad.addColorStop(brightR / visionR, 'rgba(0,0,0,1)');
      }
      if (dimR > brightR && dimR < visionR) {
        grad.addColorStop(dimR / visionR, 'rgba(0,0,0,0.75)');
      } else {
        grad.addColorStop(0.7, 'rgba(0,0,0,0.85)');
      }
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      vctx.fillStyle = grad;
      vctx.beginPath();
      vctx.arc(cx, cy, visionR, 0, Math.PI * 2);
      vctx.fill();
      vctx.restore();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(vision, 0, 0);
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
}
