import {
  contentRectFromInsets,
  cropMarkCells,
  detectCropMarkGrid,
  detectGutterGrid,
  detectSoftMargins,
  insetsFromCropMarkGrid,
} from './card-sheet-trim';

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

/** Full-art style sheet: dark cards on white paper with gutters (AgentDecker-like). */
function sheetWithGutters(
  w: number,
  h: number,
  cols: number,
  rows: number,
  margin: number,
  gutter: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const innerW = w - margin * 2;
  const innerH = h - margin * 2;
  const cellW = Math.floor((innerW - gutter * (cols - 1)) / cols);
  const cellH = Math.floor((innerH - gutter * (rows - 1)) / rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = margin + c * (cellW + gutter);
      const y0 = margin + r * (cellH + gutter);
      for (let y = y0; y < y0 + cellH; y++) {
        for (let x = x0; x < x0 + cellW; x++) {
          const i = (y * w + x) * 4;
          data[i] = 40;
          data[i + 1] = 60;
          data[i + 2] = 90;
        }
      }
    }
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

  it('rejects outer-bounds-only marks that would become a false 1×N grid', () => {
    // Two vertical lines = content left/right only (AgentDecker L/R symptom).
    const w = 800;
    const h = 600;
    const data = sheetWithMarks(w, h, [34, 682], [53, 358, 663, 968]);
    expect(detectCropMarkGrid(data, w, h)).toBeNull();
  });
});

describe('detectSoftMargins', () => {
  it('seeds % insets from outer white paper (AgentDecker-like margins)', () => {
    const w = 400;
    const h = 600;
    const data = sheetWithGutters(w, h, 2, 2, 40, 8);
    const insets = detectSoftMargins(data, w, h);
    expect(insets.left).toBeGreaterThan(5);
    expect(insets.right).toBeGreaterThan(5);
    expect(insets.top).toBeGreaterThan(3);
    expect(insets.bottom).toBeGreaterThan(3);
    const rect = contentRectFromInsets(w, h, insets);
    expect(rect.w).toBeLessThan(w);
    expect(rect.h).toBeLessThan(h);
  });

  it('skips a 1px dark page border before the white band (L/R)', () => {
    const w = 200;
    const h = 200;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = 255;
    }
    // Hairline dark border on left/right.
    for (let y = 0; y < h; y++) {
      for (const x of [0, w - 1]) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    // Content block inset 20px.
    for (let y = 20; y < h - 20; y++) {
      for (let x = 20; x < w - 20; x++) {
        const i = (y * w + x) * 4;
        data[i] = 40;
        data[i + 1] = 60;
        data[i + 2] = 90;
      }
    }
    const insets = detectSoftMargins(data, w, h);
    expect(insets.left).toBeGreaterThan(8);
    expect(insets.right).toBeGreaterThan(8);
  });
});

describe('detectGutterGrid', () => {
  it('finds a 4×2 grid from light gutters without crop marks', () => {
    const w = 800;
    const h = 600;
    const data = sheetWithGutters(w, h, 4, 2, 30, 10);
    const grid = detectGutterGrid(data, w, h, { expectCols: 4, expectRows: 2 });
    expect(grid).not.toBeNull();
    expect(grid!.xs.length - 1).toBe(4);
    expect(grid!.ys.length - 1).toBe(2);
    expect(cropMarkCells(grid!).length).toBe(8);
  });
});

describe('insetsFromCropMarkGrid', () => {
  it('maps outer trim lines to % insets (auto 去邊)', () => {
    const grid = { xs: [40, 220, 400, 580, 760], ys: [50, 300, 550] };
    const insets = insetsFromCropMarkGrid(grid, 800, 600);
    expect(insets.left).toBeCloseTo(5, 0);
    expect(insets.right).toBeCloseTo(5, 0);
    expect(insets.top).toBeCloseTo(8.3, 0);
    expect(insets.bottom).toBeCloseTo(8.3, 0);
  });
});
