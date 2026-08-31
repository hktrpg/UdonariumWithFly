import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;
let workerReady = false;
/** After a worker setup/runtime failure, skip further pdf.js work (prevents tab freeze). */
let fatalWorkerError: Error | null = null;

/** Stable key used by notes to avoid re-queueing the same page after success or hard fail. */
export function pdfPageRenderKey(identifier: string, page: number): string {
  return `${identifier}:${page}:hi`;
}

export function isPdfWorkerFatalError(err: unknown): boolean {
  const msg = String(
    (err && typeof err === 'object' && 'message' in err)
      ? (err as { message?: unknown }).message
      : err
  );
  return /fake worker|pdf\.worker|Failed to resolve module specifier|Setting up fake worker/i.test(msg);
}

/** @internal tests only */
export function resetPdfRenderStateForTests(): void {
  pdfjsPromise = null;
  workerReady = false;
  fatalWorkerError = null;
  docCache.clear();
}

/** @internal tests only */
export function markPdfWorkerFatalForTests(err: Error): void {
  fatalWorkerError = err;
}

/**
 * Hosts often serve `.mjs` as `application/octet-stream`. Chrome then rejects
 * `new Worker(..., { type: 'module' })` (pdf.js always uses a module worker).
 * Blob + explicit JS MIME avoids depending on server Content-Type.
 */
async function resolvePdfWorkerSrc(): Promise<string> {
  const workerUrl = new URL('assets/pdf.worker.min.mjs', document.baseURI).href;
  try {
    const res = await fetch(workerUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const source = await res.text();
    const blob = new Blob([source], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[pdf] worker blob fallback failed; using asset URL', err);
    return workerUrl;
  }
}

async function ensurePdfjs(): Promise<PdfjsModule> {
  if (fatalWorkerError) throw fatalWorkerError;
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist');
  }
  const pdfjs = await pdfjsPromise;
  if (!workerReady) {
    // Bundled via angular.json assets from node_modules/pdfjs-dist/build.
    pdfjs.GlobalWorkerOptions.workerSrc = await resolvePdfWorkerSrc();
    workerReady = true;
  }
  return pdfjs;
}

function noteFatalWorkerError(err: unknown): void {
  if (fatalWorkerError || !isPdfWorkerFatalError(err)) return;
  fatalWorkerError = err instanceof Error ? err : new Error(String(err));
  console.warn('[pdf] worker unavailable — further renders will fail fast');
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

/** One active render per canvas — PDF.js forbids overlapping render() on the same canvas. */
const activeCanvasRender = new WeakMap<HTMLCanvasElement, RenderTask>();
const canvasRenderSerial = new WeakMap<HTMLCanvasElement, number>();

function isRenderCancelled(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = String((err as { name?: string }).name || '');
  const msg = String((err as { message?: string }).message || '');
  return name === 'RenderingCancelledException'
    || name === 'AbortException'
    || /cancel/i.test(msg);
}

async function cancelActiveCanvasRender(canvas: HTMLCanvasElement): Promise<void> {
  const prev = activeCanvasRender.get(canvas);
  if (!prev) return;
  activeCanvasRender.delete(canvas);
  try {
    prev.cancel();
  } catch { /* already finished */ }
  try {
    await prev.promise;
  } catch {
    // Cancelled or interrupted — expected when flipping pages quickly.
  }
}

export async function loadPdfDocument(url: string, cacheKey?: string): Promise<PDFDocumentProxy> {
  if (fatalWorkerError) throw fatalWorkerError;
  const pdfjs = await ensurePdfjs();
  const key = cacheKey || url;
  let pending = docCache.get(key);
  if (!pending) {
    pending = pdfjs.getDocument({ url, withCredentials: false }).promise;
    docCache.set(key, pending);
    pending.catch(err => {
      docCache.delete(key);
      noteFatalWorkerError(err);
    });
  }
  return pending;
}

/**
 * Render one PDF page onto canvas.
 * Returns null when a newer render superseded this call (rapid page flips).
 */
export async function renderPdfPage(
  canvas: HTMLCanvasElement,
  url: string,
  pageNumber: number,
  cacheKey?: string,
  maxWidthPx = 800
): Promise<{ pageCount: number; page: number } | null> {
  if (fatalWorkerError) throw fatalWorkerError;

  const serial = (canvasRenderSerial.get(canvas) || 0) + 1;
  canvasRenderSerial.set(canvas, serial);

  // Must finish/cancel the previous task before touching this canvas again.
  await cancelActiveCanvasRender(canvas);
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  let doc: PDFDocumentProxy;
  try {
    doc = await loadPdfDocument(url, cacheKey);
  } catch (err) {
    noteFatalWorkerError(err);
    throw err;
  }
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  const pageCount = Math.max(1, doc.numPages | 0);
  // Clamp only — never wrap (e.g. last+1 must stay on last, not become 1).
  let page = Math.floor(Number(pageNumber));
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pageCount) page = pageCount;
  const pdfPage: PDFPageProxy = await doc.getPage(page);
  if (canvasRenderSerial.get(canvas) !== serial) return null;

  const unscaled = pdfPage.getViewport({ scale: 1 });
  // Allow sharp tabletop / retina renders (old cap of 2 made small notes unreadable).
  const scale = Math.min(4, maxWidthPx / Math.max(1, unscaled.width));
  const viewport = pdfPage.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return { pageCount, page };
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const task = pdfPage.render({ canvasContext: context, viewport });
  activeCanvasRender.set(canvas, task);
  try {
    await task.promise;
  } catch (err) {
    if (isRenderCancelled(err)) return null;
    noteFatalWorkerError(err);
    throw err;
  } finally {
    if (activeCanvasRender.get(canvas) === task) {
      activeCanvasRender.delete(canvas);
    }
  }

  if (canvasRenderSerial.get(canvas) !== serial) return null;
  return { pageCount, page };
}

export function evictPdfDocument(cacheKey: string) {
  docCache.delete(cacheKey);
}
