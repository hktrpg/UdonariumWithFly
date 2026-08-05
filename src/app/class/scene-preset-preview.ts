import { domToJpeg } from 'modern-screenshot';
import { CanvasUtil } from './core/file-storage/canvas-util';

/** Longest edge of stored preview JPEG (finer than list thumb for hover zoom). */
const PREVIEW_MAX_EDGE = 480;
const PREVIEW_JPEG_QUALITY = 0.82;
/** Capture scale cap before shrink — more pixels → sharper downsample. */
const CAPTURE_MAX_EDGE = 1600;

/**
 * Capture the map layer (#app-game-table) as a JPEG data URL.
 * Panels / chat live outside this node, so they are not included.
 */
export async function captureMapPreviewDataUrl(): Promise<string> {
  const el = document.getElementById('app-game-table');
  if (!el) return '';

  try {
    const edge = Math.max(el.clientWidth || 1, el.clientHeight || 1);
    const raw = await domToJpeg(el, {
      quality: 0.92,
      scale: Math.min(1, CAPTURE_MAX_EDGE / edge),
      backgroundColor: '#2a241c',
    });
    return await shrinkDataUrl(raw, PREVIEW_MAX_EDGE, PREVIEW_JPEG_QUALITY);
  } catch (e) {
    console.warn('[ScenePreset] map preview capture failed', e);
    return '';
  }
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
