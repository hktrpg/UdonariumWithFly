/**
 * Render PDF pages to PNG blobs for PnP / card-sheet import.
 * Uses the shared pdf.js loader (same worker as table notes).
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfDocument, evictPdfDocument } from '@udonarium/core/file-storage/pdf-render';
import { CardSheetSliceError } from '@udonarium/card-sheet-slice';

export type PdfSheetPageBlob = {
  page: number;
  blob: Blob;
  width: number;
  height: number;
};

function blobCacheTag(source: Blob): string {
  const file = source as File;
  const name = typeof file.name === 'string' ? file.name : 'blob';
  const modified = typeof file.lastModified === 'number' ? file.lastModified : 0;
  return `${source.size}:${source.type || ''}:${name}:${modified}`;
}

/**
 * Render selected 1-based pages to PNG blobs.
 * `maxWidthPx` caps the long edge for memory (default 2400 ≈ ~220dpi letter).
 */
export async function renderPdfPagesToPng(
  source: Blob,
  pages: number[],
  maxWidthPx = 2400,
): Promise<{ pageCount: number; pages: PdfSheetPageBlob[] }> {
  if (!source || !pages?.length) {
    throw new CardSheetSliceError('invalid_params', 'No PDF pages to render');
  }

  const cacheKey = `card-sheet-pdf:${blobCacheTag(source)}`;
  const url = URL.createObjectURL(source);
  let doc: PDFDocumentProxy;
  try {
    doc = await loadPdfDocument(url, cacheKey);
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new CardSheetSliceError('decode_failed', String((err as Error)?.message || err));
  }

  try {
    const pageCount = Math.max(1, doc.numPages | 0);
    const out: PdfSheetPageBlob[] = [];
    for (const raw of pages) {
      const pageNum = Math.floor(Number(raw));
      if (!Number.isFinite(pageNum) || pageNum < 1 || pageNum > pageCount) {
        throw new CardSheetSliceError('invalid_params', `Page ${raw} out of range 1..${pageCount}`);
      }
      const page = await doc.getPage(pageNum);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(3, maxWidthPx / Math.max(1, unscaled.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new CardSheetSliceError('to_blob_failed', 'Canvas unavailable');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvasToPng(canvas);
      out.push({ page: pageNum, blob, width: canvas.width, height: canvas.height });
    }
    return { pageCount, pages: out };
  } finally {
    URL.revokeObjectURL(url);
    evictPdfDocument(cacheKey);
  }
}

export async function peekPdfPageCount(source: Blob): Promise<number> {
  const cacheKey = `card-sheet-pdf-peek:${blobCacheTag(source)}`;
  const url = URL.createObjectURL(source);
  try {
    const doc = await loadPdfDocument(url, cacheKey);
    return Math.max(1, doc.numPages | 0);
  } finally {
    URL.revokeObjectURL(url);
    evictPdfDocument(cacheKey);
  }
}

/** Render one page for a small UI preview (cheap). */
export async function renderPdfPagePreviewPng(
  source: Blob,
  pageNumber = 1,
  maxWidthPx = 640,
): Promise<{ blob: Blob; pageCount: number; page: number; width: number; height: number }> {
  const pageCount = await peekPdfPageCount(source);
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(pageNumber)) || 1));
  const rendered = await renderPdfPagesToPng(source, [page], maxWidthPx);
  const first = rendered.pages[0];
  return {
    blob: first.blob,
    pageCount: rendered.pageCount,
    page: first.page,
    width: first.width,
    height: first.height,
  };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new CardSheetSliceError('to_blob_failed', 'toBlob failed'));
      else resolve(blob);
    }, 'image/png');
  });
}
