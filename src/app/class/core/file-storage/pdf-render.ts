import { getDocument, GlobalWorkerOptions, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

let workerReady = false;

function ensureWorker() {
  if (workerReady) return;
  // Bundled via angular.json assets from node_modules/pdfjs-dist/build.
  GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
  workerReady = true;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export async function loadPdfDocument(url: string, cacheKey?: string): Promise<PDFDocumentProxy> {
  ensureWorker();
  const key = cacheKey || url;
  let pending = docCache.get(key);
  if (!pending) {
    pending = getDocument({ url, withCredentials: false }).promise;
    docCache.set(key, pending);
    pending.catch(() => docCache.delete(key));
  }
  return pending;
}

export async function renderPdfPage(
  canvas: HTMLCanvasElement,
  url: string,
  pageNumber: number,
  cacheKey?: string,
  maxWidthPx = 800
): Promise<{ pageCount: number; page: number }> {
  const doc = await loadPdfDocument(url, cacheKey);
  const pageCount = Math.max(1, doc.numPages | 0);
  // Clamp only — never wrap (e.g. last+1 must stay on last, not become 1).
  let page = Math.floor(Number(pageNumber));
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pageCount) page = pageCount;
  const pdfPage: PDFPageProxy = await doc.getPage(page);
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidthPx / Math.max(1, unscaled.width));
  const viewport = pdfPage.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return { pageCount, page };
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await pdfPage.render({ canvasContext: context, viewport }).promise;
  return { pageCount, page };
}

export function evictPdfDocument(cacheKey: string) {
  docCache.delete(cacheKey);
}
