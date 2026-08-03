import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { TableLight } from '@udonarium/table-fx/table-light';
import { TableWall } from '@udonarium/table-fx/table-wall';

const MAX_LIGHTS = 32;

export class LightingRender {
  constructor(readonly canvasElement: HTMLCanvasElement) {}

  render(
    table: GameTable,
    visionCharacters: GameCharacter[],
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

    // Darkness fill
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.92, baseAlpha)})`;
    ctx.fillRect(0, 0, width, height);

    // Lights punch holes
    const lights = (table.lights || [])
      .filter(l => l.isActiveAtDarkness(darkness))
      .slice(0, MAX_LIGHTS);

    const walls = (table.walls || []).filter(w => w.blocksLight);

    ctx.globalCompositeOperation = 'destination-out';
    for (const light of lights) {
      this.drawLight(ctx, light, walls, width, height);
    }

    // Colored light tint (additive-ish via source-over after cut)
    ctx.globalCompositeOperation = 'source-over';
    for (const light of lights) {
      this.drawLightTint(ctx, light);
    }

    if (table.visionEnabled && !isGM) {
      this.applyVisionMask(ctx, table, visionCharacters, walls.filter(w => w.blocksVision), width, height);
    }
  }

  private drawLight(
    ctx: CanvasRenderingContext2D,
    light: TableLight,
    walls: TableWall[],
    tableW: number,
    tableH: number,
  ) {
    const r = Math.max(light.dimRadius, light.brightRadius, 1);
    ctx.save();
    if (walls.length) {
      ctx.beginPath();
      ctx.rect(0, 0, tableW, tableH);
      for (const wall of walls) {
        this.appendWallShadowPath(ctx, light.x, light.y, wall, tableW, tableH);
      }
      ctx.clip('evenodd');
    }

    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    const bright = Math.max(0, Math.min(r, light.brightRadius));
    grad.addColorStop(0, `rgba(0,0,0,${0.95 * light.intensity})`);
    grad.addColorStop(bright / r, `rgba(0,0,0,${0.75 * light.intensity})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLightTint(ctx: CanvasRenderingContext2D, light: TableLight) {
    const r = Math.max(light.dimRadius, 1);
    const color = light.color || '#ffd080';
    const rgb = this.hexToRgb(color);
    if (!rgb) return;
    const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.22 * light.intensity})`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(light.x, light.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private appendWallShadowPath(
    ctx: CanvasRenderingContext2D,
    lx: number,
    ly: number,
    wall: TableWall,
    tableW: number,
    tableH: number,
  ) {
    const pts = wall.points;
    if (pts.length < 2) return;
    const extent = Math.max(tableW, tableH) * 3;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
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

  private applyVisionMask(
    ctx: CanvasRenderingContext2D,
    table: GameTable,
    characters: GameCharacter[],
    walls: TableWall[],
    width: number,
    height: number,
  ) {
    if (!characters.length) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const vision = document.createElement('canvas');
    vision.width = width;
    vision.height = height;
    const vctx = vision.getContext('2d');
    vctx.fillStyle = '#000';
    vctx.fillRect(0, 0, width, height);
    vctx.globalCompositeOperation = 'destination-out';

    for (const ch of characters) {
      const cx = ch.location.x + (ch.size * table.gridSize) / 2;
      const cy = ch.location.y + (ch.size * table.gridSize) / 2;
      const radius = Math.max(1, (ch.visionRange || 6) * table.gridSize);
      vctx.save();
      if (walls.length) {
        vctx.beginPath();
        vctx.rect(0, 0, width, height);
        for (const wall of walls) {
          this.appendWallShadowPath(vctx, cx, cy, wall, width, height);
        }
        vctx.clip('evenodd');
      }
      const grad = vctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      vctx.fillStyle = grad;
      vctx.beginPath();
      vctx.arc(cx, cy, radius, 0, Math.PI * 2);
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
