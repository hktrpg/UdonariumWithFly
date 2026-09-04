/** TTS Custom Deck sheet → individual card face files (left-to-right, top-to-bottom). */

import { CropMarkGrid, cropMarkCells, detectCropMarkGrid } from './card-sheet-trim';

export type CardSheetSliceParams = {
  cols: number;
  rows: number;
  numCards: number;
  /** Base name for output files (no extension). Default: sheet */
  baseName?: string;
  /**
   * When true, detect crop / trim marks and slice on those lines
   * (removes bleed outside marks, shared edges, and outer crop ticks).
   * Falls back to equal cols×rows if detection fails.
   */
  autoTrim?: boolean;
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
 * With `autoTrim`, prefer crop-mark grid when detected.
 */
export async function sliceCardSheet(
  source: Blob,
  params: CardSheetSliceParams,
): Promise<File[]> {
  const cols = Math.floor(Number(params.cols));
  const rows = Math.floor(Number(params.rows));
  const numCards = Math.floor(Number(params.numCards));
  const maxSlots = cols * rows;

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

  let cells: { x: number; y: number; w: number; h: number }[] | null = null;
  if (params.autoTrim) {
    const grid = readCropMarksFromImage(img, sheetW, sheetH);
    if (grid) {
      const detected = cropMarkCells(grid);
      const dCols = grid.xs.length - 1;
      const dRows = grid.ys.length - 1;
      if (detected.length && dCols === cols && dRows === rows) {
        cells = detected;
      } else if (detected.length && detected.length >= numCards) {
        cells = detected;
      }
    }
  }

  if (!cells) {
    const cellW = Math.floor(sheetW / cols);
    const cellH = Math.floor(sheetH / rows);
    if (cellW < 1 || cellH < 1) {
      throw new CardSheetSliceError('empty_cell', `Cell size too small (${cellW}×${cellH})`);
    }
    cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ x: c * cellW, y: r * cellH, w: cellW, h: cellH });
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

/** Probe crop marks on a decoded sheet image (for UI preview). */
export function detectSheetCropMarks(img: HTMLImageElement | HTMLCanvasElement): CropMarkGrid | null {
  const w = 'naturalWidth' in img ? (img.naturalWidth || img.width) : img.width;
  const h = 'naturalHeight' in img ? (img.naturalHeight || img.height) : img.height;
  return readCropMarksFromImage(img, w, h);
}

export function cardSheetSliceErrorI18nKey(err: unknown): string {
  if (err instanceof CardSheetSliceError) {
    return `cardSheet.error.${err.code}`;
  }
  return 'cardSheet.error.generic';
}

function readCropMarksFromImage(
  img: CanvasImageSource,
  sheetW: number,
  sheetH: number,
): CropMarkGrid | null {
  const probe = document.createElement('canvas');
  probe.width = sheetW;
  probe.height = sheetH;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, sheetW, sheetH);
    return detectCropMarkGrid(data, sheetW, sheetH, { channels: 4 });
  } catch {
    return null;
  }
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
