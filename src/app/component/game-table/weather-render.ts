import { GameTable, WeatherType } from '@udonarium/game-table';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

export class WeatherRender {
  private particles: Particle[] = [];
  private lastType: WeatherType = 'none';
  private lastIntensity = -1;
  private lastW = 0;
  private lastH = 0;
  private rafId = 0;
  private running = false;

  constructor(readonly canvasElement: HTMLCanvasElement) {}

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
      const ctx = this.canvasElement.getContext('2d');
      ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
  }

  sync(table: GameTable) {
    const width = table.width * table.gridSize;
    const height = table.height * table.gridSize;
    if (this.canvasElement.width !== width) this.canvasElement.width = width;
    if (this.canvasElement.height !== height) this.canvasElement.height = height;

    const type = table.weatherType || 'none';
    const intensity = Math.max(0, Math.min(1, table.weatherIntensity ?? 0.5));
    if (type === 'none' || intensity <= 0) {
      this.setEnabled(false);
      this.particles = [];
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
    const count = Math.floor((type === 'fog' ? 40 : 120) * intensity);
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(this.spawn(type, width, height, true));
    }
  }

  private spawn(type: WeatherType, width: number, height: number, anywhere: boolean): Particle {
    const x = Math.random() * width;
    const y = anywhere ? Math.random() * height : -10;
    if (type === 'rain') {
      return { x, y, vx: -1 - Math.random(), vy: 10 + Math.random() * 12, size: 1, alpha: 0.35 + Math.random() * 0.4 };
    }
    if (type === 'snow') {
      return { x, y, vx: -0.5 + Math.random(), vy: 1 + Math.random() * 2, size: 1.5 + Math.random() * 2.5, alpha: 0.5 + Math.random() * 0.4 };
    }
    // fog
    return { x, y: Math.random() * height, vx: 0.2 + Math.random() * 0.4, vy: (Math.random() - 0.5) * 0.2, size: 40 + Math.random() * 80, alpha: 0.04 + Math.random() * 0.06 };
  }

  private tick() {
    const ctx = this.canvasElement.getContext('2d');
    const width = this.canvasElement.width;
    const height = this.canvasElement.height;
    ctx.clearRect(0, 0, width, height);
    const type = this.lastType;

    if (type === 'fog') {
      ctx.fillStyle = `rgba(180, 190, 200, ${0.08 * this.lastIntensity})`;
      ctx.fillRect(0, 0, width, height);
    }

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y > height + 20 || p.x < -40 || p.x > width + 40) {
        Object.assign(p, this.spawn(type, width, height, false));
      }
      if (type === 'rain') {
        ctx.strokeStyle = `rgba(170, 200, 255, ${p.alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 2, p.y + p.vy * 1.2);
        ctx.stroke();
      } else if (type === 'snow') {
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(220, 230, 240, ${p.alpha})`);
        g.addColorStop(1, 'rgba(220, 230, 240, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
