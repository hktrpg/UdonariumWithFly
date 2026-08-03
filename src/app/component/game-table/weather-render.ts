import { GameTable, WeatherType } from '@udonarium/game-table';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  /** Variant: leaf/ember/ash/color band index. */
  kind?: number;
}

interface WeatherLayer {
  canvas: HTMLCanvasElement;
  index: number;
  depth: number;
  particles: Particle[];
}

type MotionMode = 'fall' | 'drift' | 'blow' | 'rise' | 'sky';

interface WeatherPreset {
  count: number;
  /** Floor layer particle scale (sky effects keep floor sparse). */
  floorScale: number;
  motion: MotionMode;
}

/** Display order for map settings / toolbox menus. */
export const WEATHER_MENU_ORDER: WeatherType[] = [
  'none',
  'rain',
  'thunderstorm',
  'snow',
  'fog',
  'wind',
  'sandstorm',
  'rainbow',
  'aurora',
  'burning',
];

export const WEATHER_LABEL_KEY: Record<WeatherType, string> = {
  none: 'table.none',
  rain: 'table.rain',
  thunderstorm: 'table.thunderstorm',
  snow: 'table.snow',
  fog: 'table.fog',
  wind: 'table.wind',
  sandstorm: 'table.sandstorm',
  rainbow: 'table.rainbow',
  aurora: 'table.aurora',
  burning: 'table.burning',
};

const PRESET: Record<Exclude<WeatherType, 'none'>, WeatherPreset> = {
  rain: { count: 95, floorScale: 1, motion: 'fall' },
  thunderstorm: { count: 115, floorScale: 1, motion: 'fall' },
  snow: { count: 88, floorScale: 1, motion: 'fall' },
  fog: { count: 72, floorScale: 1, motion: 'drift' },
  wind: { count: 105, floorScale: 1, motion: 'blow' },
  sandstorm: { count: 125, floorScale: 1, motion: 'blow' },
  rainbow: { count: 40, floorScale: 0.28, motion: 'sky' },
  aurora: { count: 32, floorScale: 0.28, motion: 'sky' },
  burning: { count: 135, floorScale: 1, motion: 'rise' },
};

const AURORA_SPARK = [
  [80, 255, 160],
  [90, 200, 255],
  [180, 120, 255],
] as const;

const RAINBOW_BANDS = [
  [255, 72, 72],
  [255, 148, 48],
  [255, 220, 64],
  [72, 205, 80],
  [64, 148, 255],
  [110, 88, 230],
  [190, 90, 230],
] as const;

/**
 * Volumetric weather: Canvas2D sheets at different translateZ for parallax.
 * Canvas is larger than the map so effects spill past the edges.
 */
export class WeatherRender {
  static marginFor(tableW: number, tableH: number): number {
    return Math.max(240, Math.round(Math.max(tableW, tableH) * 0.55));
  }

  private layers: WeatherLayer[] = [];
  private lastType: WeatherType = 'none';
  private lastIntensity = -1;
  private lastW = 0;
  private lastH = 0;
  private rafId = 0;
  private running = false;
  private flash = 0;
  private flashCooldown = 0;
  private frame = 0;
  /** Stable lightning polyline while a flash is active. */
  private bolt: { x: number; y: number }[] = [];

  constructor(canvases: HTMLCanvasElement[]) {
    const depths = [0.45, 0.8, 1.2];
    this.layers = canvases.map((canvas, index) => ({
      canvas,
      index,
      depth: depths[Math.min(index, depths.length - 1)],
      particles: [],
    }));
  }

  setEnabled(enabled: boolean) {
    if (enabled && !this.running) {
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.tick();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    } else if (!enabled && this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
      this.flash = 0;
      this.flashCooldown = 0;
      this.bolt = [];
      for (const layer of this.layers) {
        const ctx = layer.canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.particles = [];
      }
    }
  }

  sync(table: GameTable) {
    const tableW = table.width * table.gridSize;
    const tableH = table.height * table.gridSize;
    const pad = WeatherRender.marginFor(tableW, tableH);
    const width = tableW + pad * 2;
    const height = tableH + pad * 2;
    for (const layer of this.layers) {
      if (layer.canvas.width !== width) layer.canvas.width = width;
      if (layer.canvas.height !== height) layer.canvas.height = height;
    }

    const type = table.weatherType || 'none';
    const intensity = Math.max(0, Math.min(1, table.weatherIntensity ?? 0.5));
    if (type === 'none' || intensity <= 0) {
      this.setEnabled(false);
      this.lastType = type;
      return;
    }

    if (type !== this.lastType || intensity !== this.lastIntensity || width !== this.lastW || height !== this.lastH) {
      this.lastType = type;
      this.lastIntensity = intensity;
      this.lastW = width;
      this.lastH = height;
      this.flash = 0;
      this.flashCooldown = 50 + Math.random() * 90;
      this.bolt = [];
      this.rebuild(type, intensity, width, height);
    }
    this.setEnabled(true);
  }

  destroy() {
    this.setEnabled(false);
  }

  private rebuild(type: WeatherType, intensity: number, width: number, height: number) {
    if (type === 'none') return;
    const preset = PRESET[type];
    const areaScale = Math.sqrt((width * height) / (800 * 800));
    const base = preset.count * Math.max(0.85, Math.min(1.65, areaScale));
    for (const layer of this.layers) {
      const weight = layer.index === 1 ? 1.15 : layer.index === 2 ? 0.92 : 0.88;
      const floor = layer.index === 0 ? preset.floorScale : 1;
      const count = Math.max(6, Math.floor(base * intensity * weight * floor));
      layer.particles = Array.from({ length: count }, () => this.spawn(type, width, height, layer.depth, true));
    }
  }

  private spawn(type: WeatherType, width: number, height: number, depth: number, anywhere: boolean): Particle {
    const phase = Math.random() * Math.PI * 2;
    const dA = Math.min(1, 0.55 + depth * 0.4);

    if (type === 'rain' || type === 'thunderstorm') {
      const storm = type === 'thunderstorm' ? 1.4 : 1;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : -20 - Math.random() * 90,
        vx: (-1.4 - Math.random() * 2.0) * depth * storm,
        vy: (9.5 + Math.random() * 15) * depth * storm,
        size: (0.7 + depth * 0.95) * (type === 'thunderstorm' ? 1.2 : 1),
        alpha: (0.32 + Math.random() * 0.48) * dA,
        phase,
      };
    }
    if (type === 'snow') {
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : -20 - Math.random() * 70,
        vx: (-0.5 + Math.random() * 1.0) * (0.65 + depth * 0.4),
        vy: (1.2 + Math.random() * 2.0) * (0.5 + depth * 0.55),
        size: (1.8 + Math.random() * 3.6) * depth,
        alpha: (0.48 + Math.random() * 0.42) * dA,
        phase,
      };
    }
    if (type === 'sandstorm') {
      return {
        x: anywhere ? Math.random() * width : -25 - Math.random() * 50,
        y: Math.random() * height,
        vx: (5.5 + Math.random() * 9.5) * (0.7 + depth * 0.55),
        vy: (-0.9 + Math.random() * 1.8) * depth,
        size: (0.9 + Math.random() * 2.6) * depth,
        alpha: (0.28 + Math.random() * 0.42) * dA,
        phase,
      };
    }
    if (type === 'wind') {
      const leaf = Math.random() < 0.32 ? 1 : 0;
      return {
        x: anywhere ? Math.random() * width : -35 - Math.random() * 55,
        y: Math.random() * height,
        vx: (7.5 + Math.random() * 12) * (0.65 + depth * 0.6),
        vy: (-1.3 + Math.random() * 2.6) * depth,
        size: leaf ? (3.2 + Math.random() * 5.2) * depth : (0.65 + Math.random() * 1.9) * depth,
        alpha: (0.24 + Math.random() * 0.4) * dA,
        phase,
        kind: leaf,
      };
    }
    if (type === 'rainbow' || type === 'aurora') {
      return {
        x: Math.random() * width,
        y: Math.random() * height * (type === 'aurora' ? 0.72 : 1),
        vx: (0.12 + Math.random() * 0.32) * (0.7 + depth * 0.25),
        vy: (Math.random() - 0.5) * 0.22,
        size: (2.2 + Math.random() * 5.5) * depth,
        alpha: (0.14 + Math.random() * 0.24) * dA,
        phase,
        kind: type === 'aurora' ? Math.floor(Math.random() * 3) : 0,
      };
    }
    if (type === 'burning') {
      const ash = Math.random() < 0.28 ? 1 : 0;
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : height + 12 + Math.random() * 70,
        vx: (-0.9 + Math.random() * 1.8) * (0.7 + depth * 0.4),
        vy: ash
          ? (-0.7 - Math.random() * 1.5) * (0.5 + depth * 0.4)
          : (-2.4 - Math.random() * 4.8) * (0.6 + depth * 0.55),
        size: ash ? (1.6 + Math.random() * 3.8) * depth : (1.5 + Math.random() * 3.4) * depth,
        alpha: (0.38 + Math.random() * 0.48) * dA,
        phase,
        kind: ash,
      };
    }
    // fog
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (0.1 + Math.random() * 0.3) * (0.7 + depth * 0.2),
      vy: (Math.random() - 0.5) * 0.2,
      size: (100 + Math.random() * 170) * (0.85 + depth * 0.4),
      alpha: (0.11 + Math.random() * 0.15) * Math.min(1.2, 0.75 + depth * 0.25),
      phase,
    };
  }

  private tick() {
    const type = this.lastType;
    const intensity = this.lastIntensity;
    const width = this.lastW;
    const height = this.lastH;
    if (!width || !height || type === 'none') return;
    this.frame++;
    this.updateFlash(type, intensity, width, height);

    for (const layer of this.layers) {
      const ctx = layer.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, width, height);
      const { depth, index } = layer;

      this.drawAtmosphere(ctx, type, intensity, index, width, height);
      this.drawSkyFx(ctx, type, intensity, index, width, height);

      for (const p of layer.particles) {
        this.stepParticle(type, p, depth);
        if (this.isOut(type, p, width, height)) {
          Object.assign(p, this.spawn(type, width, height, depth, false));
        }
        this.drawParticle(ctx, type, p, depth);
      }
    }
  }

  private updateFlash(type: WeatherType, intensity: number, width: number, height: number) {
    if (type !== 'thunderstorm') {
      this.flash = 0;
      this.bolt = [];
      return;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - 0.065);
      if (this.flash <= 0) this.bolt = [];
      return;
    }
    this.flashCooldown -= 1;
    if (this.flashCooldown > 0) return;
    this.flash = 0.88 + Math.random() * 0.12;
    this.flashCooldown = 55 + Math.random() * (150 - intensity * 70);
    if (Math.random() < 0.4) this.flashCooldown = 10 + Math.random() * 16;
    this.rebuildBolt(width, height);
  }

  private rebuildBolt(width: number, height: number) {
    const pts: { x: number; y: number }[] = [];
    let x = width * (0.15 + Math.random() * 0.7);
    let y = height * 0.02;
    pts.push({ x, y });
    const segs = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < segs; i++) {
      x += (Math.random() - 0.5) * width * 0.08;
      y += height * (0.06 + Math.random() * 0.05);
      pts.push({ x, y });
    }
    this.bolt = pts;
  }

  private stepParticle(type: WeatherType, p: Particle, depth: number) {
    const motion = PRESET[type as Exclude<WeatherType, 'none'>]?.motion;
    if (motion === 'fall' && type === 'snow') {
      p.x += p.vx + Math.sin(p.phase) * (0.55 + depth * 0.35);
      p.y += p.vy;
      p.phase += 0.035 + depth * 0.02;
      return;
    }
    if (motion === 'drift' || motion === 'sky') {
      p.x += p.vx;
      p.y += p.vy + Math.sin(p.phase) * 0.1;
      p.phase += type === 'aurora' ? 0.02 : 0.012;
      return;
    }
    if (motion === 'blow') {
      p.x += p.vx;
      p.y += p.vy + Math.sin(p.phase) * (type === 'wind' ? 0.75 : 0.45) * depth;
      p.phase += 0.08 + depth * 0.03;
      return;
    }
    if (motion === 'rise') {
      p.x += p.vx + Math.sin(p.phase) * (0.45 + depth * 0.35);
      p.y += p.vy;
      p.phase += 0.09 + depth * 0.04;
      if (p.kind === 0) p.alpha = Math.max(0.05, p.alpha - 0.0028);
      return;
    }
    p.x += p.vx;
    p.y += p.vy;
  }

  private isOut(type: WeatherType, p: Particle, width: number, height: number): boolean {
    const motion = PRESET[type as Exclude<WeatherType, 'none'>]?.motion;
    if (motion === 'blow') return p.x > width + 50 || p.y < -80 || p.y > height + 80;
    if (motion === 'drift' || motion === 'sky') {
      return p.x > width + 40 || p.x < -40 || p.y < -40 || p.y > height + 40;
    }
    if (motion === 'rise') return p.y < -50 || p.x < -60 || p.x > width + 60 || p.alpha < 0.06;
    return p.y > height + 40 || p.x < -80 || p.x > width + 80 || p.y < -100;
  }

  private wash(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rgb: [number, number, number],
    alpha: number,
  ) {
    if (alpha <= 0) return;
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    ctx.fillRect(0, 0, width, height);
  }

  private layerWash(index: number, a0: number, a1: number, a2: number): number {
    return index === 0 ? a0 : index === 1 ? a1 : a2;
  }

  private drawAtmosphere(
    ctx: CanvasRenderingContext2D,
    type: WeatherType,
    intensity: number,
    index: number,
    width: number,
    height: number,
  ) {
    const i = intensity;
    switch (type) {
      case 'rain':
        this.wash(ctx, width, height, [150, 175, 205], this.layerWash(index, 0.1, 0.06, 0.035) * i);
        break;
      case 'snow':
        this.wash(ctx, width, height, [200, 215, 235], this.layerWash(index, 0.12, 0.07, 0.04) * i);
        break;
      case 'fog':
        this.wash(ctx, width, height, [168, 180, 198], this.layerWash(index, 0.3, 0.18, 0.11) * i);
        if (index === 0) this.wash(ctx, width, height, [215, 222, 232], 0.14 * i);
        break;
      case 'sandstorm':
        this.wash(ctx, width, height, [196, 150, 78], this.layerWash(index, 0.24, 0.15, 0.09) * i);
        if (index === 0) this.wash(ctx, width, height, [225, 180, 100], 0.11 * i);
        break;
      case 'wind':
        this.wash(ctx, width, height, [185, 205, 218], this.layerWash(index, 0.09, 0.055, 0.03) * i);
        break;
      case 'thunderstorm': {
        this.wash(ctx, width, height, [36, 48, 72], this.layerWash(index, 0.34, 0.22, 0.13) * i);
        if (this.flash > 0) {
          this.wash(ctx, width, height, [220, 235, 255], this.flash * this.layerWash(index, 0.2, 0.3, 0.48) * i);
        }
        break;
      }
      case 'rainbow':
        this.wash(ctx, width, height, [175, 205, 245], this.layerWash(index, 0.03, 0.04, 0.07) * i);
        break;
      case 'aurora':
        this.wash(ctx, width, height, [10, 16, 38], this.layerWash(index, 0.2, 0.13, 0.09) * i);
        break;
      case 'burning': {
        this.wash(ctx, width, height, [78, 24, 8], this.layerWash(index, 0.24, 0.15, 0.09) * i);
        const ha = this.layerWash(index, 0.38, 0.24, 0.14) * i;
        const heat = ctx.createLinearGradient(0, height * 0.5, 0, height);
        heat.addColorStop(0, 'rgba(255, 70, 15, 0)');
        heat.addColorStop(0.4, `rgba(255, 95, 25, ${ha * 0.4})`);
        heat.addColorStop(1, `rgba(255, 150, 40, ${ha})`);
        ctx.fillStyle = heat;
        ctx.fillRect(0, height * 0.4, width, height * 0.6);
        const flick = 0.035 + 0.028 * Math.sin(this.frame * 0.17 + index * 1.3);
        this.wash(ctx, width, height, [255, 105, 35], flick * i);
        break;
      }
      default:
        break;
    }
  }

  private drawSkyFx(
    ctx: CanvasRenderingContext2D,
    type: WeatherType,
    intensity: number,
    index: number,
    width: number,
    height: number,
  ) {
    if (type === 'rainbow' && index >= 1) this.drawRainbow(ctx, intensity, index, width, height);
    if (type === 'aurora' && index >= 1) this.drawAurora(ctx, intensity, index, width, height);
    if (type === 'thunderstorm' && this.flash > 0 && index === 2) this.drawBolt(ctx, intensity);
  }

  private drawBolt(ctx: CanvasRenderingContext2D, intensity: number) {
    if (this.bolt.length < 2) return;
    const a = this.flash * 0.7 * intensity;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Glow
    ctx.strokeStyle = `rgba(180, 210, 255, ${a * 0.35})`;
    ctx.lineWidth = 6 + intensity * 3;
    ctx.beginPath();
    ctx.moveTo(this.bolt[0].x, this.bolt[0].y);
    for (let i = 1; i < this.bolt.length; i++) ctx.lineTo(this.bolt[i].x, this.bolt[i].y);
    ctx.stroke();
    // Core
    ctx.strokeStyle = `rgba(245, 250, 255, ${a})`;
    ctx.lineWidth = 1.8 + intensity * 1.5;
    ctx.beginPath();
    ctx.moveTo(this.bolt[0].x, this.bolt[0].y);
    for (let i = 1; i < this.bolt.length; i++) ctx.lineTo(this.bolt[i].x, this.bolt[i].y);
    ctx.stroke();
    ctx.restore();
  }

  private drawAurora(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    index: number,
    width: number,
    height: number,
  ) {
    const t = this.frame * 0.011;
    const bands = index === 2
      ? [
        { y: height * 0.06, h: height * 0.44, rgb: [48, 255, 150] as const, phase: 0 },
        { y: height * 0.0, h: height * 0.4, rgb: [70, 205, 255] as const, phase: 1.15 },
        { y: height * 0.1, h: height * 0.36, rgb: [170, 100, 255] as const, phase: 2.3 },
      ]
      : [
        { y: height * 0.09, h: height * 0.34, rgb: [55, 235, 140] as const, phase: 0.55 },
        { y: height * 0.04, h: height * 0.3, rgb: [95, 175, 255] as const, phase: 1.75 },
      ];
    const alphaScale = (index === 2 ? 0.42 : 0.24) * intensity;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const band of bands) {
      const [r, g, b] = band.rgb;
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const x = width * (u * 1.22 - 0.11);
        const wave =
          Math.sin(u * 4.0 + t + band.phase) * height * 0.055 +
          Math.sin(u * 8.5 + t * 1.35 + band.phase) * height * 0.022;
        const top = band.y + wave;
        const bottom = top + band.h * (0.72 + 0.28 * Math.sin(u * 3.2 + t));
        const grad = ctx.createLinearGradient(x, top, x, bottom);
        const a = alphaScale * (0.5 + 0.5 * Math.sin(u * Math.PI));
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, ${a})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${a * 0.32})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - width / steps * 0.55, top, width / steps + 2.5, bottom - top);
      }
    }
    ctx.restore();
  }

  private drawRainbow(
    ctx: CanvasRenderingContext2D,
    intensity: number,
    index: number,
    width: number,
    height: number,
  ) {
    const cx = width * 0.5;
    const cy = height * 1.08;
    const baseR = Math.max(width, height) * (index === 2 ? 0.94 : 0.8);
    const bandW = Math.max(11, Math.min(width, height) * 0.019);
    const alpha = (index === 2 ? 0.58 : 0.34) * intensity;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    // Soft bloom behind bands
    ctx.beginPath();
    ctx.arc(cx, cy, baseR + bandW * 0.5, Math.PI * 1.04, Math.PI * 1.96);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * intensity})`;
    ctx.lineWidth = bandW * 8;
    ctx.stroke();
    for (let i = 0; i < RAINBOW_BANDS.length; i++) {
      const [r, g, b] = RAINBOW_BANDS[i];
      ctx.beginPath();
      ctx.arc(cx, cy, baseR - i * bandW, Math.PI * 1.04, Math.PI * 1.96);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.lineWidth = bandW * 1.08;
      ctx.stroke();
    }
    ctx.restore();
  }

  private glowDisk(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    stops: [number, string][],
  ) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [t, c] of stops) g.addColorStop(t, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawParticle(ctx: CanvasRenderingContext2D, type: WeatherType, p: Particle, depth: number) {
    switch (type) {
      case 'rain':
      case 'thunderstorm': {
        const len = 1.55 + depth * 1.35;
        ctx.strokeStyle = type === 'thunderstorm'
          ? `rgba(155, 180, 230, ${p.alpha})`
          : `rgba(190, 220, 255, ${p.alpha})`;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * len, p.y + p.vy * (0.88 + depth * 0.28));
        ctx.stroke();
        break;
      }
      case 'snow':
        this.glowDisk(ctx, p.x, p.y, p.size * 1.7, [
          [0, `rgba(255, 255, 255, ${p.alpha})`],
          [0.5, `rgba(232, 242, 255, ${p.alpha * 0.55})`],
          [1, 'rgba(220, 235, 255, 0)'],
        ]);
        break;
      case 'fog':
        this.glowDisk(ctx, p.x, p.y, p.size, [
          [0, `rgba(240, 244, 250, ${Math.min(0.58, p.alpha * 1.4)})`],
          [0.4, `rgba(200, 210, 225, ${p.alpha})`],
          [1, 'rgba(175, 188, 210, 0)'],
        ]);
        break;
      case 'sandstorm': {
        const len = 1.25 + depth * 1.15;
        ctx.strokeStyle = `rgba(215, 165, 75, ${p.alpha})`;
        ctx.lineWidth = Math.max(0.6, p.size * 0.55);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * len * 0.32, p.y - p.vy * 0.2);
        ctx.stroke();
        this.glowDisk(ctx, p.x, p.y, Math.max(0.8, p.size * 0.7), [
          [0, `rgba(200, 140, 55, ${Math.min(0.75, p.alpha + 0.12)})`],
          [1, 'rgba(160, 100, 35, 0)'],
        ]);
        break;
      }
      case 'wind':
        if (p.kind === 1) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.phase);
          const leaf = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
          leaf.addColorStop(0, `rgba(130, 185, 90, ${p.alpha})`);
          leaf.addColorStop(1, `rgba(70, 120, 55, ${p.alpha * 0.2})`);
          ctx.fillStyle = leaf;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          const len = 1.45 + depth * 1.25;
          ctx.strokeStyle = `rgba(205, 225, 235, ${p.alpha})`;
          ctx.lineWidth = Math.max(0.5, p.size * 0.55);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * len * 0.28, p.y - p.vy * 0.14);
          ctx.stroke();
        }
        break;
      case 'rainbow':
      case 'aurora': {
        const rgb = type === 'aurora'
          ? AURORA_SPARK[Math.max(0, Math.min(2, p.kind | 0))]
          : [210, 235, 255] as const;
        this.glowDisk(ctx, p.x, p.y, p.size, [
          [0, `rgba(255, 255, 255, ${Math.min(0.6, p.alpha * 1.7)})`],
          [0.45, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${p.alpha})`],
          [1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`],
        ]);
        break;
      }
      case 'burning':
        if (p.kind === 1) {
          this.glowDisk(ctx, p.x, p.y, p.size * 1.5, [
            [0, `rgba(55, 42, 36, ${p.alpha * 0.9})`],
            [1, 'rgba(35, 25, 20, 0)'],
          ]);
        } else {
          this.glowDisk(ctx, p.x, p.y, p.size * 2.3, [
            [0, `rgba(255, 248, 190, ${Math.min(0.95, p.alpha + 0.2)})`],
            [0.3, `rgba(255, 150, 45, ${p.alpha})`],
            [0.65, `rgba(230, 55, 12, ${p.alpha * 0.45})`],
            [1, 'rgba(100, 15, 0, 0)'],
          ]);
          ctx.strokeStyle = `rgba(255, 185, 70, ${p.alpha * 0.55})`;
          ctx.lineWidth = Math.max(0.6, p.size * 0.35);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.4, p.y - p.vy * 0.55);
          ctx.stroke();
        }
        break;
      default:
        break;
    }
  }
}
