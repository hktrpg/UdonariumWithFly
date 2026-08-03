import { GameTable, WeatherType } from '@udonarium/game-table';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

interface WeatherLayer {
  canvas: HTMLCanvasElement;
  /** 0 = near floor, higher = farther above table. */
  index: number;
  /** Depth scale: larger = closer to camera / higher altitude. */
  depth: number;
  particles: Particle[];
}

/**
 * Volumetric weather: several Canvas2D sheets stacked in CSS 3D space
 * (different translateZ) so rain/snow/fog have parallax when the table tilts.
 */
export class WeatherRender {
  private layers: WeatherLayer[] = [];
  private lastType: WeatherType = 'none';
  private lastIntensity = -1;
  private lastW = 0;
  private lastH = 0;
  private rafId = 0;
  private running = false;

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
      for (const layer of this.layers) {
        const ctx = layer.canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.particles = [];
      }
    }
  }

  sync(table: GameTable) {
    const width = table.width * table.gridSize;
    const height = table.height * table.gridSize;
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
      this.rebuild(type, intensity, width, height);
    }
    this.setEnabled(true);
  }

  destroy() {
    this.setEnabled(false);
  }

  private rebuild(type: WeatherType, intensity: number, width: number, height: number) {
    const base = type === 'fog' ? 28 : 70;
    for (const layer of this.layers) {
      // More particles mid-air; fewer near floor / high (keeps cost down).
      const weight = layer.index === 1 ? 1.15 : layer.index === 2 ? 0.85 : 0.7;
      const count = Math.max(4, Math.floor(base * intensity * weight));
      layer.particles = [];
      for (let i = 0; i < count; i++) {
        layer.particles.push(this.spawn(type, width, height, layer.depth, true));
      }
    }
  }

  private spawn(type: WeatherType, width: number, height: number, depth: number, anywhere: boolean): Particle {
    const x = Math.random() * width;
    const y = anywhere ? Math.random() * height : -20 - Math.random() * 40;
    const phase = Math.random() * Math.PI * 2;
    if (type === 'rain') {
      return {
        x, y,
        vx: (-1.2 - Math.random() * 1.4) * depth,
        vy: (9 + Math.random() * 14) * depth,
        size: 0.7 + depth * 0.9,
        alpha: (0.25 + Math.random() * 0.4) * Math.min(1, 0.55 + depth * 0.35),
        phase,
      };
    }
    if (type === 'snow') {
      return {
        x, y,
        vx: (-0.6 + Math.random() * 1.2) * (0.6 + depth * 0.4),
        vy: (0.7 + Math.random() * 1.8) * (0.5 + depth * 0.5),
        size: (1.2 + Math.random() * 2.8) * depth,
        alpha: (0.4 + Math.random() * 0.45) * Math.min(1, 0.5 + depth * 0.4),
        phase,
      };
    }
    // fog — soft volumes; higher layers slightly thinner
    return {
      x,
      y: Math.random() * height,
      vx: (0.15 + Math.random() * 0.35) * (0.7 + depth * 0.2),
      vy: (Math.random() - 0.5) * 0.25,
      size: (50 + Math.random() * 100) * (0.7 + depth * 0.35),
      alpha: (0.035 + Math.random() * 0.055) / Math.max(0.7, depth * 0.85),
      phase,
    };
  }

  private tick() {
    const type = this.lastType;
    const intensity = this.lastIntensity;
    const width = this.lastW;
    const height = this.lastH;
    if (!width || !height) return;

    for (const layer of this.layers) {
      const ctx = layer.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, width, height);
      const depth = layer.depth;

      if (type === 'fog') {
        // Ground layer carries most of the haze; mid/high are drifting banks.
        const wash = layer.index === 0
          ? 0.1 * intensity
          : layer.index === 1
            ? 0.045 * intensity
            : 0.025 * intensity;
        ctx.fillStyle = `rgba(175, 188, 205, ${wash})`;
        ctx.fillRect(0, 0, width, height);
      }

      for (const p of layer.particles) {
        if (type === 'snow') {
          p.x += p.vx + Math.sin(p.phase) * 0.35 * depth;
          p.phase += 0.04 + depth * 0.02;
        } else if (type === 'fog') {
          p.x += p.vx;
          p.y += p.vy + Math.sin(p.phase) * 0.08;
          p.phase += 0.01;
        } else {
          p.x += p.vx;
          p.y += p.vy;
        }

        if (p.y > height + 30 || p.x < -60 || p.x > width + 60 || p.y < -80) {
          Object.assign(p, this.spawn(type, width, height, depth, false));
        }

        if (type === 'rain') {
          const len = 1.6 + depth * 1.4;
          ctx.strokeStyle = `rgba(185, 215, 255, ${p.alpha})`;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * len, p.y + p.vy * (0.9 + depth * 0.25));
          ctx.stroke();
        } else if (type === 'snow') {
          // Soft flake with slight depth glow
          const r = p.size;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.6);
          g.addColorStop(0, `rgba(255, 255, 255, ${p.alpha})`);
          g.addColorStop(0.55, `rgba(230, 240, 255, ${p.alpha * 0.55})`);
          g.addColorStop(1, 'rgba(230, 240, 255, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, `rgba(220, 230, 240, ${p.alpha})`);
          g.addColorStop(0.55, `rgba(200, 210, 225, ${p.alpha * 0.45})`);
          g.addColorStop(1, 'rgba(200, 210, 225, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}
