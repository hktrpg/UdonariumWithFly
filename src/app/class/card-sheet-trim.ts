/**
 * Detect PnP / print crop-mark grids, soft outer margins, and card gutters.
 * Slice cards on trim lines (drops outer marks; shared gutters cut on the mark).
 */

import {
  clampFloorCropInsets,
  emptyFloorCropInsets,
  FloorCropInsets,
} from './table-floor-crop';

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

export type DetectSoftMarginOptions = {
  channels?: 3 | 4;
  /** Min r+g+b to count as paper / empty. Default 720 (near-white). */
  paperSum?: number;
  /** Fraction of a row/col that must be paper to keep trimming. Default 0.92. */
  paperFrac?: number;
  /** Stop after this fraction of the short edge. Default 0.35. */
  maxFrac?: number;
};

export type DetectGutterOptions = {
  channels?: 3 | 4;
  /** Min r+g+b treated as gutter / paper. Default 700. */
  paperSum?: number;
  /** Expected columns (optional; helps validate). */
  expectCols?: number;
  /** Expected rows (optional). */
  expectRows?: number;
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

  // Drop 1px page-border false marks hugging the extreme edges.
  const edge = Math.max(2, Math.floor(Math.min(w, h) * 0.004));
  const xsInner = xsClean.filter(x => x >= edge && x <= w - 1 - edge);
  const ysInner = ysClean.filter(y => y >= edge && y <= h - 1 - edge);
  const xsUse = xsInner.length >= 2 ? xsInner : xsClean;
  const ysUse = ysInner.length >= 2 ? ysInner : ysClean;
  // Need ≥3 lines per axis (at least a 2×2 card field). Two lines are only
  // outer bounds (white margin → false 1×N grid like AgentDecker L/R).
  if (xsUse.length < 3 || ysUse.length < 3) return null;

  // Reject wildly uneven cells (e.g. white margin counted as a column).
  if (!gapsReasonablyUniform(xsUse) || !gapsReasonablyUniform(ysUse)) return null;

  return { xs: xsUse, ys: ysUse };
}

/**
 * Estimate outer paper margins as % insets (map-style trim seed).
 * Returns empty insets when margins are absent or unreliable.
 *
 * Skips a thin dark page-border fringe (common on PDF renders) so a
 * following white paper band still counts as left/right trim.
 */
export function detectSoftMargins(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: DetectSoftMarginOptions,
): FloorCropInsets {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const ch = options?.channels === 3 ? 3 : 4;
  if (w < 32 || h < 32 || !data || data.length < w * h * ch) {
    return emptyFloorCropInsets();
  }

  const paperSum = options?.paperSum ?? 720;
  const paperFrac = options?.paperFrac ?? 0.92;
  const maxFrac = options?.maxFrac ?? 0.35;
  const maxX = Math.floor(w * maxFrac);
  const maxY = Math.floor(h * maxFrac);

  const rowPaper = (y: number): boolean => {
    let n = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (data[i] + data[i + 1] + data[i + 2] >= paperSum) n++;
    }
    return n / w >= paperFrac;
  };

  const colPaper = (x: number): boolean => {
    let n = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * ch;
      if (data[i] + data[i + 1] + data[i + 2] >= paperSum) n++;
    }
    return n / h >= paperFrac;
  };

  const top = outerPaperRun(rowPaper, maxY);
  const bottom = outerPaperRun(y => rowPaper(h - 1 - y), maxY);
  const left = outerPaperRun(colPaper, maxX);
  const right = outerPaperRun(x => colPaper(w - 1 - x), maxX);

  // Ignore tiny noise margins (< 0.5%).
  const toPct = (px: number, span: number) => (px / span) * 100;
  const raw = {
    top: top >= 2 ? toPct(top, h) : 0,
    bottom: bottom >= 2 ? toPct(bottom, h) : 0,
    left: left >= 2 ? toPct(left, w) : 0,
    right: right >= 2 ? toPct(right, w) : 0,
  };
  return clampFloorCropInsets(raw);
}

/**
 * Count outer paper pixels, allowing a thin dark fringe (≤3px) before the paper band.
 * Returns the end index of the paper band (trim depth), or 0 if none.
 */
function outerPaperRun(isPaper: (pos: number) => boolean, max: number): number {
  let pos = 0;
  // Skip hairline dark border (PDF edge / registration).
  while (pos < Math.min(3, max) && !isPaper(pos)) pos++;
  if (pos >= max || !isPaper(pos)) return 0;
  let end = pos;
  while (end < max && isPaper(end)) end++;
  // Require a real band, not a single noisy paper column.
  if (end - pos < 2) return 0;
  return end;
}

/**
 * Infer a card grid from internal light gutters / seams when crop marks are absent.
 * Returns null when no confident regular grid is found.
 */
export function detectGutterGrid(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: DetectGutterOptions,
): CropMarkGrid | null {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const ch = options?.channels === 3 ? 3 : 4;
  if (w < 64 || h < 64 || !data || data.length < w * h * ch) return null;

  const paperSum = options?.paperSum ?? 700;
  const colScore = new Float64Array(w);
  const rowScore = new Float64Array(h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const paper = data[i] + data[i + 1] + data[i + 2] >= paperSum ? 1 : 0;
      colScore[x] += paper;
      rowScore[y] += paper;
    }
  }
  for (let x = 0; x < w; x++) colScore[x] /= h;
  for (let y = 0; y < h; y++) rowScore[y] /= w;

  const expectCols = options?.expectCols;
  const expectRows = options?.expectRows;
  const xs = guttersToCuts(colScore, w, expectCols);
  const ys = guttersToCuts(rowScore, h, expectRows);
  if (!xs || !ys) return null;
  if (xs.length < 2 || ys.length < 2) return null;

  const dCols = xs.length - 1;
  const dRows = ys.length - 1;
  if (expectCols != null && dCols !== expectCols) return null;
  if (expectRows != null && dRows !== expectRows) return null;
  // Reject absurd grids (too many tiny cells).
  if (dCols > 20 || dRows > 20) return null;
  if (w / dCols < 24 || h / dRows < 24) return null;

  return { xs, ys };
}

/**
 * Prefer classic crop marks / gutters on the **full** sheet first.
 * Outer crop marks live in the bleed — do not pre-crop before detecting them.
 */
export function detectSheetGrid(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: DetectCropMarkOptions & DetectGutterOptions & {
    content?: { x: number; y: number; w: number; h: number };
  },
): CropMarkGrid | null {
  // Always try full-page marks first (bleed ticks sit outside the card field).
  const full = detectCropMarkGrid(data, width, height, options);
  if (full) return full;

  const content = options?.content;
  if (!content) {
    return detectGutterGrid(data, width, height, options);
  }

  const { x: ox, y: oy, w: cw, h: ch } = content;
  if (cw < 32 || ch < 32) return null;
  const channels = options?.channels === 3 ? 3 : 4;
  const cropped = cropImageData(data, width, height, ox, oy, cw, ch, channels);
  // Inside content: gutters first (marks already failed on full page).
  const local = detectGutterGrid(cropped, cw, ch, options)
    || detectCropMarkGrid(cropped, cw, ch, options);
  if (!local) return null;
  return {
    xs: local.xs.map(v => v + ox),
    ys: local.ys.map(v => v + oy),
  };
}

function cropImageData(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  channels: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * channels);
  for (let y = 0; y < ch; y++) {
    const srcY = y0 + y;
    if (srcY < 0 || srcY >= height) continue;
    for (let x = 0; x < cw; x++) {
      const srcX = x0 + x;
      if (srcX < 0 || srcX >= width) continue;
      const si = (srcY * width + srcX) * channels;
      const di = (y * cw + x) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = data[si + c];
    }
  }
  return out;
}

function guttersToCuts(
  score: Float64Array,
  length: number,
  expectCells?: number,
): number[] | null {
  // Smooth a little to ignore thin noise.
  const smooth = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const a = score[Math.max(0, i - 1)];
    const b = score[i];
    const c = score[Math.min(length - 1, i + 1)];
    smooth[i] = (a + b * 2 + c) / 4;
  }

  let mean = 0;
  for (let i = 0; i < length; i++) mean += smooth[i];
  mean /= length;
  const thr = Math.max(0.55, mean + 0.12);

  // Outer content bounds: first/last positions that are not mostly paper.
  let left = 0;
  while (left < length && smooth[left] >= thr) left++;
  let right = length - 1;
  while (right > left && smooth[right] >= thr) right--;
  if (right - left < 40) return null;

  const valleyCenters: number[] = [];
  let i = left;
  while (i <= right) {
    if (smooth[i] < thr) {
      i++;
      continue;
    }
    // Enter a paper run (gutter candidate).
    const start = i;
    while (i <= right && smooth[i] >= thr) i++;
    const end = i - 1;
    const width = end - start + 1;
    // Ignore huge paper regions (outer margin already trimmed) and 1px noise.
    if (width >= 2 && width <= Math.max(8, Math.floor(length * 0.08))) {
      valleyCenters.push(Math.round((start + end) / 2));
    }
  }

  // Always include outer content edges as cut lines.
  const cuts = [left, ...valleyCenters, right + 1];
  const cleaned = filterSpaced(cuts, Math.max(12, Math.floor(length * 0.03)));
  if (cleaned.length < 2) return null;

  // Regularity: cell widths should be similar (outer-only = no internal gutters).
  if (cleaned.length < 3) return null;
  const gaps: number[] = [];
  for (let k = 1; k < cleaned.length; k++) gaps.push(cleaned[k] - cleaned[k - 1]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const maxDev = gaps.reduce((m, g) => Math.max(m, Math.abs(g - avg)), 0);
  if (maxDev > avg * 0.35) return null;

  if (expectCells != null && expectCells >= 1 && cleaned.length - 1 !== expectCells) {
    return null;
  }
  return cleaned;
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

/** True when consecutive gaps are similar (reject margin-as-column false grids). */
function gapsReasonablyUniform(lines: number[]): boolean {
  if (lines.length < 3) return true;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i] - lines[i - 1]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avg < 1) return false;
  const maxGap = Math.max(...gaps);
  const minGap = Math.min(...gaps);
  // One tiny "margin column" next to a huge card field → reject.
  if (maxGap > minGap * 3.5) return false;
  const maxDev = gaps.reduce((m, g) => Math.max(m, Math.abs(g - avg)), 0);
  return maxDev <= avg * 0.55;
}

/** Outer bleed outside a crop-mark grid, as map-style % insets. */
export function insetsFromCropMarkGrid(
  grid: CropMarkGrid,
  width: number,
  height: number,
): FloorCropInsets {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (!grid || grid.xs.length < 2 || grid.ys.length < 2) return emptyFloorCropInsets();
  const x0 = grid.xs[0];
  const x1 = grid.xs[grid.xs.length - 1];
  const y0 = grid.ys[0];
  const y1 = grid.ys[grid.ys.length - 1];
  return clampFloorCropInsets({
    left: (x0 / w) * 100,
    right: ((w - x1) / w) * 100,
    top: (y0 / h) * 100,
    bottom: ((h - y1) / h) * 100,
  });
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

/** Content rectangle from % insets on a sheet. */
export function contentRectFromInsets(
  sheetW: number,
  sheetH: number,
  insets: FloorCropInsets | null | undefined,
): { x: number; y: number; w: number; h: number } {
  const i = clampFloorCropInsets(insets || emptyFloorCropInsets());
  const x = Math.floor((sheetW * i.left) / 100);
  const y = Math.floor((sheetH * i.top) / 100);
  const x2 = Math.ceil(sheetW - (sheetW * i.right) / 100);
  const y2 = Math.ceil(sheetH - (sheetH * i.bottom) / 100);
  const w = Math.max(1, x2 - x);
  const h = Math.max(1, y2 - y);
  return { x, y, w, h };
}
