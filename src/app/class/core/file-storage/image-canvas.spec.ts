import {
  drawImageToMaxEdge,
  scaledDimensions,
} from './image-canvas';

describe('image-canvas', () => {
  it('scaledDimensions caps long edge', () => {
    expect(scaledDimensions(3072, 2048, 128)).toEqual({ dstW: 128, dstH: 85 });
    expect(scaledDimensions(64, 32, 128)).toEqual({ dstW: 64, dstH: 32 });
  });

  it('drawImageToMaxEdge never allocates canvas larger than maxEdge', () => {
    const img = document.createElement('canvas');
    img.width = 3072;
    img.height = 3072;
    const { canvas, dstW, dstH } = drawImageToMaxEdge(img, 3072, 3072, 128);
    expect(canvas.width).toBeLessThanOrEqual(128);
    expect(canvas.height).toBeLessThanOrEqual(128);
    expect(Math.max(dstW, dstH)).toBeLessThanOrEqual(128);
  });
});
