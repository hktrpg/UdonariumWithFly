import { IMAGE_STORED_MAX_BYTES, normalizeImageBlob } from './image-normalize';

function pngWithAlpha(size: number, noisy = false): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  if (noisy) {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (Math.random() * 256) | 0;
      img.data[i + 1] = (Math.random() * 256) | 0;
      img.data[i + 2] = (Math.random() * 256) | 0;
      img.data[i + 3] = (i % 17 === 0) ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = 'rgba(180, 40, 40, 1)';
    const inset = Math.floor(size * 0.2);
    ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
  });
}

describe('normalizeImageBlob alpha', () => {
  it('keeps a small transparent PNG as PNG', async () => {
    const blob = await pngWithAlpha(64);
    const out = await normalizeImageBlob(blob);
    expect(out.blob.type).toBe('image/png');
  });

  it('does not flatten an oversized transparent PNG to white JPEG', async () => {
    const blob = await pngWithAlpha(1600, true);
    if (blob.size <= IMAGE_STORED_MAX_BYTES) {
      pending('PNG compressed under the stored cap; skip flatten check');
      return;
    }
    const out = await normalizeImageBlob(blob);
    expect(out.blob.type).not.toBe('image/jpeg');
    expect(out.blob.size).toBeLessThanOrEqual(IMAGE_STORED_MAX_BYTES);
  });
});
