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
});
