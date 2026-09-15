/** Safe canvas downscale — never allocates a full-resolution intermediate buffer. */

export type DrawToMaxEdgeResult = {
  canvas: HTMLCanvasElement;
  dstW: number;
  dstH: number;
};

export function scaledDimensions(srcW: number, srcH: number, maxEdge: number): { dstW: number; dstH: number } {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH, 1));
  return {
    dstW: Math.max(1, Math.round(srcW * scale)),
    dstH: Math.max(1, Math.round(srcH * scale)),
  };
}

export function drawImageToMaxEdge(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxEdge: number,
  opts?: { fillWhite?: boolean },
): DrawToMaxEdgeResult {
  const { dstW, dstH } = scaledDimensions(srcW, srcH, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  if (opts?.fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dstW, dstH);
  }
  ctx.drawImage(img, 0, 0, dstW, dstH);
  return { canvas, dstW, dstH };
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = image.onabort = () => reject(new Error('Failed to decode image'));
    image.src = url;
  });
}

export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = image.onabort = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    image.src = url;
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

/** Downscale and encode (PNG when keepAlpha, else JPEG). */
export async function encodeImageToMaxEdge(
  img: HTMLImageElement,
  srcW: number,
  srcH: number,
  maxEdge: number,
  keepAlpha: boolean,
  jpegQuality: number,
): Promise<Blob> {
  const { canvas } = drawImageToMaxEdge(img, srcW, srcH, maxEdge, { fillWhite: !keepAlpha });
  const type = keepAlpha ? 'image/png' : 'image/jpeg';
  const quality = keepAlpha ? undefined : jpegQuality;
  return canvasToBlob(canvas, type, quality);
}

/** Thumbnail helper (128px long edge). */
export async function createThumbnailBlob(source: Blob, mimeType: string): Promise<Blob> {
  const img = await loadImageFromBlob(source);
  const srcW = Math.max(0, img.naturalWidth || img.width || 0);
  const srcH = Math.max(0, img.naturalHeight || img.height || 0);
  if (srcW < 1 || srcH < 1) throw new Error('Invalid image dimensions');
  const { canvas } = drawImageToMaxEdge(img, srcW, srcH, 128);
  return canvasToBlob(canvas, mimeType || 'image/png');
}
