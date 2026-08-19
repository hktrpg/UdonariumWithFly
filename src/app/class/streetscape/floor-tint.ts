/**
 * Sample average RGB (0–1) from a floor/aerial image around UV.
 * Used to tint Open3Dhk GLTF0 buildings (official COLOR_0 is flat gray).
 */
export async function sampleBlobRgbAtUv(
  blob: Blob,
  u: number,
  v: number,
  radiusPx = 6,
): Promise<{ r: number; g: number; b: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = Math.max(1, img.naturalWidth || img.width);
    const h = Math.max(1, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { r: 0.7, g: 0.68, b: 0.64 };
    ctx.drawImage(img, 0, 0);
    const cx = Math.round(clamp01(u) * (w - 1));
    const cy = Math.round(clamp01(v) * (h - 1));
    const x0 = Math.max(0, cx - radiusPx);
    const y0 = Math.max(0, cy - radiusPx);
    const x1 = Math.min(w, cx + radiusPx + 1);
    const y1 = Math.min(h, cy + radiusPx + 1);
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 8) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (n < 1) return { r: 0.7, g: 0.68, b: 0.64 };
    // Slightly lift dark asphalt samples so facades stay readable.
    const lift = 1.15;
    return {
      r: clamp01((r / n / 255) * lift),
      g: clamp01((g / n / 255) * lift),
      b: clamp01((b / n / 255) * lift),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('FLOOR_TINT_IMAGE'));
    img.src = url;
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
