import { CanvasUtil } from './core/file-storage/canvas-util';

/** Longest edge of stored preview JPEG (finer than list thumb for hover zoom). */
const PREVIEW_MAX_EDGE = 480;
const PREVIEW_JPEG_QUALITY = 0.82;
/** Capture scale cap before shrink — more pixels → sharper downsample. */
const CAPTURE_MAX_EDGE = 1600;

/**
 * Capture the map layer (#app-game-table) as a JPEG data URL.
 * Zero-dep: paints CSS background + visible &lt;img&gt; descendants (tokens).
 * Panels / chat live outside this node, so they are not included.
 */
export async function captureMapPreviewDataUrl(): Promise<string> {
  const el = document.getElementById('app-game-table');
  if (!el) return '';

  try {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#2a241c';
    ctx.fillRect(0, 0, cw, ch);

    const bgUrl = parseCssUrl(getComputedStyle(el).backgroundImage);
    if (bgUrl) {
      try {
        const bg = await loadImage(bgUrl);
        drawCover(ctx, bg, cw, ch);
      } catch {
        /* ignore missing / tainted background */
      }
    }

    const rootRect = el.getBoundingClientRect();
    const imgs = el.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i] as HTMLImageElement;
      if (!img.complete || img.naturalWidth < 1 || img.naturalHeight < 1) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Skip off-viewport relative to the map root.
      if (r.right < rootRect.left || r.left > rootRect.right) continue;
      if (r.bottom < rootRect.top || r.top > rootRect.bottom) continue;
      const x = (r.left - rootRect.left) * scale;
      const y = (r.top - rootRect.top) * scale;
      try {
        ctx.drawImage(img, x, y, r.width * scale, r.height * scale);
      } catch {
        /* tainted canvas — skip this sprite */
      }
    }

    const raw = canvas.toDataURL('image/jpeg', 0.92);
    return await shrinkDataUrl(raw, PREVIEW_MAX_EDGE, PREVIEW_JPEG_QUALITY);
  } catch (e) {
    console.warn('[ScenePreset] map preview capture failed', e);
    return '';
  }
}

function parseCssUrl(value: string): string {
  if (!value || value === 'none') return '';
  const m = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(value);
  return m ? m[1] : '';
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cw: number, ch: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1) return;
  const cover = Math.max(cw / iw, ch / ih);
  const dw = iw * cover;
  const dh = ih * cover;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

async function shrinkDataUrl(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  if (!dataUrl) return '';
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < 1 || h < 1) return '';

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);

  if (tw !== w || th !== h) {
    CanvasUtil.resize(canvas, tw, th, true);
  }

  return canvas.toDataURL('image/jpeg', quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('preview image load failed'));
    img.src = src;
  });
}
