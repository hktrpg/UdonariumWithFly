/** TTS Custom Deck sheet → individual card face files (left-to-right, top-to-bottom). */

export type CardSheetSliceParams = {
  cols: number;
  rows: number;
  numCards: number;
  /** Base name for output files (no extension). Default: sheet */
  baseName?: string;
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
  const cellW = Math.floor(sheetW / cols);
  const cellH = Math.floor(sheetH / rows);
  if (cellW < 1 || cellH < 1) {
    throw new CardSheetSliceError('empty_cell', `Cell size too small (${cellW}×${cellH})`);
  }

  const base = sanitizeBaseName(params.baseName) || 'sheet';
  const pad = String(numCards).length;
  const out: File[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = cellW;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new CardSheetSliceError('to_blob_failed', 'Canvas unavailable');
  }

  for (let i = 0; i < numCards; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sx = col * cellW;
    const sy = row * cellH;
    ctx.clearRect(0, 0, cellW, cellH);
    ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
    const blob = await canvasToPngBlob(canvas);
    const index = String(i + 1).padStart(Math.max(3, pad), '0');
    out.push(new File([blob], `${base}-${index}.png`, { type: 'image/png' }));
  }

  return out;
}

export function cardSheetSliceErrorI18nKey(err: unknown): string {
  if (err instanceof CardSheetSliceError) {
    return `cardSheet.error.${err.code}`;
  }
  return 'cardSheet.error.generic';
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
