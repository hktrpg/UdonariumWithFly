/**
 * Detect PnP / print crop-mark grids and slice cards on trim lines
 * (drops outer marks, shared gutters are cut on the mark).
 */

export type CropMarkGrid = {
  /** Vertical cut lines, left → right (inclusive outer trims). */
  xs: number[];
  /** Horizontal cut lines, top → bottom (inclusive outer trims). */
  ys: number[];
};

export type DetectCropMarkOptions = {
  /** 3 = RGB, 4 = RGBA. Default 4. */
  channels?: 3 | 4;
  /** Max luma (r+g+b) to count as mark ink. Default 420. */
  darkSum?: number;
  /** Margin fraction of min(width,height) scanned for ticks. Default 0.06. */
  marginFrac?: number;
};

/**
 * Find axis-aligned crop / trim marks in page margins.
 * Returns null when a usable grid cannot be inferred.
 */
export function detectCropMarkGrid(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: DetectCropMarkOptions,
): CropMarkGrid | null {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const ch = options?.channels === 3 ? 3 : 4;
  if (w < 32 || h < 32 || !data || data.length < w * h * ch) return null;

  const darkSum = options?.darkSum ?? 420;
  const margin = Math.max(24, Math.floor(Math.min(w, h) * (options?.marginFrac ?? 0.06)));
  const thr = Math.max(10, Math.floor(margin * 0.12));

  const isDark = (x: number, y: number): boolean => {
    const i = (y * w + x) * ch;
    return data[i] + data[i + 1] + data[i + 2] < darkSum;
  };

  const ys = findMarks(h, margin, thr, (y, side) => {
    let n = 0;
    if (side === 0) {
      for (let x = 0; x < margin; x++) if (isDark(x, y)) n++;
    } else {
      for (let x = w - margin; x < w; x++) if (isDark(x, y)) n++;
    }
    return n;
  });

  const xs = findMarks(w, margin, thr, (x, side) => {
    let n = 0;
    if (side === 0) {
      for (let y = 0; y < margin; y++) if (isDark(x, y)) n++;
    } else {
      for (let y = h - margin; y < h; y++) if (isDark(x, y)) n++;
    }
    return n;
  });

  if (xs.length < 2 || ys.length < 2) return null;

  // Drop near-duplicate / tiny cells
  const xsClean = filterSpaced(xs, Math.max(8, Math.floor(w * 0.02)));
  const ysClean = filterSpaced(ys, Math.max(8, Math.floor(h * 0.02)));
  if (xsClean.length < 2 || ysClean.length < 2) return null;

  return { xs: xsClean, ys: ysClean };
}

function findMarks(
  length: number,
  margin: number,
  thr: number,
  countSide: (pos: number, side: 0 | 1) => number,
): number[] {
  const hits: number[] = [];
  for (let i = 0; i < length; i++) {
    const a = countSide(i, 0);
    const b = countSide(i, 1);
    if (a >= thr && b >= thr) hits.push(i);
  }
  return clusterCenters(hits, 3);
}

function clusterCenters(hits: number[], gap: number): number[] {
  if (!hits.length) return [];
  const clusters: { start: number; end: number }[] = [];
  for (const v of hits) {
    if (!clusters.length || v - clusters[clusters.length - 1].end > gap) {
      clusters.push({ start: v, end: v });
    } else {
      clusters[clusters.length - 1].end = v;
    }
  }
  return clusters.map(c => Math.round((c.start + c.end) / 2));
}

function filterSpaced(lines: number[], minGap: number): number[] {
  if (lines.length <= 1) return lines;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] - out[out.length - 1] >= minGap) out.push(lines[i]);
  }
  return out;
}

/** Cell rectangles from a crop-mark grid, row-major (L→R, T→B). */
export function cropMarkCells(grid: CropMarkGrid): { x: number; y: number; w: number; h: number }[] {
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < grid.ys.length - 1; r++) {
    for (let c = 0; c < grid.xs.length - 1; c++) {
      const x = grid.xs[c];
      const y = grid.ys[r];
      const w = grid.xs[c + 1] - x;
      const h = grid.ys[r + 1] - y;
      if (w >= 1 && h >= 1) cells.push({ x, y, w, h });
    }
  }
  return cells;
}
