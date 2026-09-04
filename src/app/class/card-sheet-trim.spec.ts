import { cropMarkCells, detectCropMarkGrid } from './card-sheet-trim';

/** White sheet with black crop-mark ticks matching a 4×2 poker-like grid. */
function sheetWithMarks(
  w: number,
  h: number,
  xs: number[],
  ys: number[],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  };
  const tickLen = 40;
  for (const y of ys) {
    for (let x = 0; x < tickLen; x++) ink(x, y);
    for (let x = w - tickLen; x < w; x++) ink(x, y);
  }
  for (const x of xs) {
    for (let y = 0; y < tickLen; y++) ink(x, y);
    for (let y = h - tickLen; y < h; y++) ink(x, y);
  }
  return data;
}

describe('detectCropMarkGrid', () => {
  it('finds 4×2 trim lines from margin ticks', () => {
    const w = 800;
    const h = 600;
    const xs = [40, 220, 400, 580, 760];
    const ys = [50, 300, 550];
    const data = sheetWithMarks(w, h, xs, ys);
    const grid = detectCropMarkGrid(data, w, h);
    expect(grid).not.toBeNull();
    expect(grid!.xs.length).toBe(5);
    expect(grid!.ys.length).toBe(3);
    for (let i = 0; i < xs.length; i++) {
      expect(Math.abs(grid!.xs[i] - xs[i])).toBeLessThanOrEqual(2);
    }
    for (let i = 0; i < ys.length; i++) {
      expect(Math.abs(grid!.ys[i] - ys[i])).toBeLessThanOrEqual(2);
    }
    expect(cropMarkCells(grid!).length).toBe(8);
  });

  it('returns null without marks', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8ClampedArray(w * h * 4);
    data.fill(255);
    expect(detectCropMarkGrid(data, w, h)).toBeNull();
  });
});
