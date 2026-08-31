import {
  isPdfWorkerFatalError,
  markPdfWorkerFatalForTests,
  pdfPageRenderKey,
  renderPdfPage,
  resetPdfRenderStateForTests,
} from './pdf-render';

describe('pdf-render crash guards', () => {
  afterEach(() => resetPdfRenderStateForTests());

  it('pdfPageRenderKey is stable for note queue dedupe', () => {
    expect(pdfPageRenderKey('abc', 2)).toBe('abc:2:hi');
    expect(pdfPageRenderKey('abc', 2)).toBe(pdfPageRenderKey('abc', 2));
    expect(pdfPageRenderKey('abc', 3)).not.toBe(pdfPageRenderKey('abc', 2));
  });

  it('detects pdf.js worker setup failures that previously froze Chrome', () => {
    expect(isPdfWorkerFatalError(
      new Error('Setting up fake worker failed: "Failed to resolve module specifier \'assets/pdf.worker.min.mjs\'".')
    )).toBeTrue();
    expect(isPdfWorkerFatalError(new Error('Failed to resolve module specifier \'assets/pdf.worker.min.mjs\''))).toBeTrue();
    expect(isPdfWorkerFatalError(new Error('Invalid PDF structure'))).toBeFalse();
    expect(isPdfWorkerFatalError(null)).toBeFalse();
  });

  it('fail-fast after worker death so sync storms do not re-enter pdf.js', async () => {
    const fatal = new Error('Setting up fake worker failed: "Failed to resolve module specifier \'assets/pdf.worker.min.mjs\'".');
    markPdfWorkerFatalForTests(fatal);
    const canvas = document.createElement('canvas');
    await expectAsync(renderPdfPage(canvas, 'blob:test', 1, 'id')).toBeRejectedWith(fatal);
  });
});
