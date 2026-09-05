/**
 * Left/right soft-margin regression (AgentDecker: 1px dark border + white band).
 */
import { detectCropMarkGrid, detectSoftMargins } from '@udonarium/card-sheet-trim';
import { resetPdfRenderStateForTests } from '@udonarium/core/file-storage/pdf-render';
import { renderPdfPagePreviewPng } from '@udonarium/pdf-card-sheet';

async function blobToImageData(blob: Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode'));
      i.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

describe('AgentDecker L/R trim', () => {
  beforeEach(() => resetPdfRenderStateForTests());

  it('soft margins trim left and right past the hairline dark border', async () => {
    const res = await fetch('/testing/fixtures/card-sheet/AgentDecker_cards_full_art.pdf');
    expect(res.ok).toBeTrue();
    const preview = await renderPdfPagePreviewPng(await res.blob(), 1, 720);
    const { data, w, h } = await blobToImageData(preview.blob);
    const soft = detectSoftMargins(data, w, h);
    const marks = detectCropMarkGrid(data, w, h);

    expect(soft.left).withContext(`left ${soft.left}`).toBeGreaterThan(3);
    expect(soft.right).withContext(`right ${soft.right}`).toBeGreaterThan(3);
    // False 3-col grid from edge borders must be rejected.
    if (marks) {
      expect(marks.xs[0]).withContext('must not treat x=0 border as a cut').toBeGreaterThan(2);
    }
  });
});
