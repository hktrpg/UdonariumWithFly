import { CardSheetSliceError, sliceCardSheet } from './card-sheet-slice';

function coloredSheet(cols: number, rows: number, cell = 10): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d')!;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      ctx.fillStyle = `rgb(${(i * 37) % 256}, ${(i * 73) % 256}, ${(i * 19) % 256})`;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
  });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    image.src = url;
  });
}

async function samplePixel(blob: Blob): Promise<[number, number, number]> {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

describe('sliceCardSheet', () => {
  it('slices left-to-right, top-to-bottom in TTS order', async () => {
    const sheet = await coloredSheet(3, 2, 8);
    const files = await sliceCardSheet(sheet, { cols: 3, rows: 2, numCards: 5, baseName: 'deck' });
    expect(files.length).toBe(5);
    expect(files[0].name).toBe('deck-001.png');
    expect(files[4].name).toBe('deck-005.png');

    // Index 0 = (0,0), index 3 = row1 col0, index 4 = row1 col1
    const c0 = await samplePixel(files[0]);
    const c3 = await samplePixel(files[3]);
    const c4 = await samplePixel(files[4]);
    expect(c0).toEqual([(0 * 37) % 256, (0 * 73) % 256, (0 * 19) % 256]);
    expect(c3).toEqual([(3 * 37) % 256, (3 * 73) % 256, (3 * 19) % 256]);
    expect(c4).toEqual([(4 * 37) % 256, (4 * 73) % 256, (4 * 19) % 256]);

    const face = await loadImage(files[0]);
    expect(face.naturalWidth).toBe(8);
    expect(face.naturalHeight).toBe(8);
  });

  it('rejects invalid params', async () => {
    const sheet = await coloredSheet(2, 2);
    await expectAsync(sliceCardSheet(sheet, { cols: 0, rows: 2, numCards: 1 }))
      .toBeRejectedWith(jasmine.any(CardSheetSliceError));
    await expectAsync(sliceCardSheet(sheet, { cols: 2, rows: 2, numCards: 5 }))
      .toBeRejectedWith(jasmine.any(CardSheetSliceError));
  });

  it('applies outer % insets before equal grid slice', async () => {
    const sheet = await coloredSheet(4, 2, 20); // 80×40
    const files = await sliceCardSheet(sheet, {
      cols: 2,
      rows: 1,
      numCards: 2,
      insets: { top: 0, right: 25, bottom: 0, left: 0 },
      baseName: 'trim',
    });
    expect(files.length).toBe(2);
    const face = await loadImage(files[0]);
    // Right 25% of 80 → content width 60; each of 2 cells = 30.
    expect(face.naturalWidth).toBe(30);
    expect(face.naturalHeight).toBe(40);
  });

  it('clips autoTrim mark cells to manual % insets', async () => {
    const w = 800;
    const h = 600;
    const xs = [40, 220, 400, 580, 760];
    const ys = [50, 300, 550];
    const sheet = await markedSheetPng(w, h, xs, ys);
    const full = await sliceCardSheet(sheet, {
      cols: 4,
      rows: 2,
      numCards: 1,
      autoTrim: true,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const trimmed = await sliceCardSheet(sheet, {
      cols: 4,
      rows: 2,
      numCards: 1,
      autoTrim: true,
      // 10% of 800 = 80 → past outer mark at x=40, clips first column.
      insets: { top: 0, right: 0, bottom: 0, left: 10 },
    });
    const a = await loadImage(full[0]);
    const b = await loadImage(trimmed[0]);
    expect(a.naturalWidth).toBeGreaterThan(150);
    expect(b.naturalWidth).toBeLessThan(a.naturalWidth);
    expect(b.naturalWidth).toBeGreaterThan(50);
  });
});

/** White PNG with black crop-mark ticks (same pattern as card-sheet-trim.spec). */
function markedSheetPng(
  w: number,
  h: number,
  xs: number[],
  ys: number[],
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  const tickLen = 40;
  for (const y of ys) {
    ctx.fillRect(0, y, tickLen, 1);
    ctx.fillRect(w - tickLen, y, tickLen, 1);
  }
  for (const x of xs) {
    ctx.fillRect(x, 0, 1, tickLen);
    ctx.fillRect(x, h - tickLen, 1, tickLen);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
  });
}