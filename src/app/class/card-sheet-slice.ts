/** TTS Custom Deck sheet → individual card face files (left-to-right, top-to-bottom). */

import {
  CropMarkGrid,
  contentRectFromInsets,
  cropMarkCells,
  detectSheetGrid,
  detectSoftMargins,
} from './card-sheet-trim';
import {
  FloorCropInsets,
  clampFloorCropInsets,
  emptyFloorCropInsets,
} from './table-floor-crop';

export type CardSheetSliceParams = {
  cols: number;
  rows: number;
  numCards: number;
  /** Base name for output files (no extension). Default: sheet */
  baseName?: string;
  /**
   * When true, detect crop / trim marks (or gutters) and slice on those lines
   * inside the content rect. Falls back to equal cols×rows if detection fails.
   */
  autoTrim?: boolean;
  /** Outer edge trim percentages (map-style). Applied before grid slice. */
  insets?: FloorCropInsets;
};

export type CardSheetSliceErrorCode =
  | 'invalid_params'
  | 'decode_failed'
  | 'empty_cell'
  | 'to_blob_failed';

export class CardSheetSliceError extends Error {
  readonly code: CardSheetSliceErrorCode;

  constructor(code: CardSheetSliceErrorCode, message?: string) {
    super(message || code);
    this.name = 'CardSheetSliceError';
    this.code = code;
  }
}

/**
 * Slice a TTS-style card sheet into one PNG File per card.
 * Card index i (0-based): row = floor(i / cols), col = i % cols.
 * With `autoTrim`, prefer crop-mark / gutter grid when detected.
 */
export async function sliceCardSheet(
  source: Blob,
  params: CardSheetSliceParams,
): Promise<File[]> {
  const cols = Math.floor(Number(params.cols));
  const rows = Math.floor(Number(params.rows));
  const numCards = Math.floor(Number(params.numCards));
  const maxSlots = cols * rows;
  const insets = clampFloorCropInsets(params.insets || emptyFloorCropInsets());

  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
    throw new CardSheetSliceError('invalid_params', 'cols and rows must be >= 1');
  }
  if (!Number.isFinite(numCards) || numCards < 1 || numCards > maxSlots) {
    throw new CardSheetSliceError('invalid_params', `numCards must be 1..${maxSlots}`);
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageFromBlob(source);
  } catch {
    throw new CardSheetSliceError('decode_failed', 'Failed to decode image');
  }

  const sheetW = img.naturalWidth || img.width;
  const sheetH = img.naturalHeight || img.height;
  if (sheetW < 1 || sheetH < 1) {
    throw new CardSheetSliceError('empty_cell', 'Sheet has no pixels');
  }

  // Manual % trim always defines the content window (even when autoTrim finds marks).
  const content = contentRectFromInsets(sheetW, sheetH, insets);
  let cells: { x: number; y: number; w: number; h: number }[] | null = null;
  if (params.autoTrim) {
    cells =
      cellsFromMatchingGrid(
        readSheetGridFromImage(img, sheetW, sheetH, undefined, cols, rows),
        cols,
        rows,
        numCards,
        content,
      ) ||
      cellsFromMatchingGrid(
        readSheetGridFromImage(img, sheetW, sheetH, content, cols, rows),
        cols,
        rows,
        numCards,
        null,
      );
  }

  if (!cells) {
    const cellW = Math.floor(content.w / cols);
    const cellH = Math.floor(content.h / rows);
    if (cellW < 1 || cellH < 1) {
      throw new CardSheetSliceError('empty_cell', `Cell size too small (${cellW}×${cellH})`);
    }
    cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          x: content.x + c * cellW,
          y: content.y + r * cellH,
          w: cellW,
          h: cellH,
        });
      }
    }
  }

  const take = Math.min(numCards, cells.length);
  if (take < 1) {
    throw new CardSheetSliceError('empty_cell', 'No card cells');
  }

  const base = sanitizeBaseName(params.baseName) || 'sheet';
  const pad = String(take).length;
  const out: File[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new CardSheetSliceError('to_blob_failed', 'Canvas unavailable');
  }

  for (let i = 0; i < take; i++) {
    const cell = cells[i];
    canvas.width = cell.w;
    canvas.height = cell.h;
    ctx.clearRect(0, 0, cell.w, cell.h);
    ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
    const blob = await canvasToPngBlob(canvas);
    const index = String(i + 1).padStart(Math.max(3, pad), '0');
    out.push(new File([blob], `${base}-${index}.png`, { type: 'image/png' }));
  }

  return out;
}

/** Probe crop marks / gutters on a decoded sheet image (for UI preview). */
export function detectSheetCropMarks(
  img: HTMLImageElement | HTMLCanvasElement,
  content?: { x: number; y: number; w: number; h: number },
  expectCols?: number,
  expectRows?: number,
): CropMarkGrid | null {
  const w = 'naturalWidth' in img ? (img.naturalWidth || img.width) : img.width;
  const h = 'naturalHeight' in img ? (img.naturalHeight || img.height) : img.height;
  return readSheetGridFromImage(img, w, h, content, expectCols, expectRows);
}

/** Soft outer paper margins as % insets (seed for map-style sliders). */
export function detectSheetSoftMargins(img: HTMLImageElement | HTMLCanvasElement): FloorCropInsets {
  const w = 'naturalWidth' in img ? (img.naturalWidth || img.width) : img.width;
  const h = 'naturalHeight' in img ? (img.naturalHeight || img.height) : img.height;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return emptyFloorCropInsets();
  try {
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    return detectSoftMargins(data, w, h, { channels: 4 });
  } catch {
    return emptyFloorCropInsets();
  }
}

export function cardSheetSliceErrorI18nKey(err: unknown): string {
  if (err instanceof CardSheetSliceError) {
    return `cardSheet.error.${err.code}`;
  }
  return 'cardSheet.error.generic';
}

function readSheetGridFromImage(
  img: CanvasImageSource,
  sheetW: number,
  sheetH: number,
  content?: { x: number; y: number; w: number; h: number },
  expectCols?: number,
  expectRows?: number,
): CropMarkGrid | null {
  const probe = document.createElement('canvas');
  probe.width = sheetW;
  probe.height = sheetH;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, sheetW, sheetH);
    return detectSheetGrid(data, sheetW, sheetH, {
      channels: 4,
      content,
      expectCols,
      expectRows,
    });
  } catch {
    return null;
  }
}

type SheetCell = { x: number; y: number; w: number; h: number };

/** Use mark/gutter cells only when they match cols×rows; optionally clip to insets. */
function cellsFromMatchingGrid(
  grid: CropMarkGrid | null,
  cols: number,
  rows: number,
  numCards: number,
  clipTo: SheetCell | null,
): SheetCell[] | null {
  if (!grid || grid.xs.length - 1 !== cols || grid.ys.length - 1 !== rows) return null;
  let detected = cropMarkCells(grid);
  if (clipTo) {
    detected = detected
      .map(cell => clipCellToRect(cell, clipTo))
      .filter((cell): cell is SheetCell => !!cell);
  }
  return detected.length >= numCards ? detected : null;
}

function clipCellToRect(cell: SheetCell, rect: SheetCell): SheetCell | null {
  const x = Math.max(cell.x, rect.x);
  const y = Math.max(cell.y, rect.y);
  const x2 = Math.min(cell.x + cell.w, rect.x + rect.w);
  const y2 = Math.min(cell.y + cell.h, rect.y + rect.h);
  const w = Math.floor(x2 - x);
  const h = Math.floor(y2 - y);
  if (w < 1 || h < 1) return null;
  return { x, y, w, h };
}

function sanitizeBaseName(name: string | undefined): string {
  const raw = (name || '').replace(/\.[^.]+$/, '').trim();
  return raw.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
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

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new CardSheetSliceError('to_blob_failed', 'toBlob failed'));
          return;
        }
        resolve(blob);
      },
      'image/png',
    );
  });
}
