import { MODEL_BAKE_SIZE_MAX, MODEL_MAX_FILE_BYTES, fitModelGridSize, uniformFitScale, gridPerWorldForImport, gridPerWorldForStreetscape, MODEL_GRID_EDGE_MAX, MODEL_GRID_EDGE_MIN } from './mesh-ir';
import { MODEL_ZIP_MAX_BYTES } from './model-package-files';
import { canvasSizeForFace, faceOrthoSize } from './ortho-face-views';
import { createDevModelLayoutCursor, placeDevModelAndAdvance } from './dev-3dmodel-layout';

describe('faceOrthoSize', () => {
  const aabb = { min: [0, 0, 0] as [number, number, number], max: [10, 2, 4] as [number, number, number] };

  it('uses Z×Y for a west-wall camera', () => {
    expect(faceOrthoSize(aabb, [-1, 0, 0])).toEqual({ width: 4, height: 2 });
  });

  it('uses X×Z for a top-down camera', () => {
    expect(faceOrthoSize(aabb, [0, 1, 0])).toEqual({ width: 10, height: 4 });
  });

  it('uses X×Y for a south-wall camera', () => {
    expect(faceOrthoSize(aabb, [0, 0, -1])).toEqual({ width: 10, height: 2 });
  });
});

describe('canvasSizeForFace', () => {
  it('keeps the long side at maxSize when no ref', () => {
    expect(canvasSizeForFace(10, 5, 1024)).toEqual({ width: 1024, height: 512 });
    expect(canvasSizeForFace(4, 8, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it('scales canvas by face size vs refLongEdge for uniform world texels', () => {
    expect(canvasSizeForFace(5, 2.5, 1024, 10)).toEqual({ width: 512, height: 256 });
  });
});

describe('uniformFitScale', () => {
  it('matches the dominant-axis scale of fitModelGridSize', () => {
    expect(uniformFitScale(100, 40, 60)).toBeCloseTo(MODEL_GRID_EDGE_MAX / 100, 5);
  });
});

describe('fitModelGridSize', () => {
  it('scales down uniformly when the longest edge exceeds max', () => {
    const size = fitModelGridSize(100, 40, 60);
    expect(size.width).toBeCloseTo(MODEL_GRID_EDGE_MAX, 5);
    expect(size.depth).toBeCloseTo(16, 5);
    expect(size.height).toBeCloseTo(24, 5);
  });

  it('scales up uniformly when the shortest edge is below min', () => {
    const size = fitModelGridSize(0.8, 0.4, 1.6);
    expect(size.depth).toBeCloseTo(MODEL_GRID_EDGE_MIN, 5);
    expect(size.width).toBeCloseTo(4, 5);
    expect(size.height).toBeCloseTo(8, 5);
  });
});

describe('placeDevModelAndAdvance', () => {
  it('wraps to the next row when the table width would be exceeded', () => {
    const cursor = createDevModelLayoutCursor(10);
    const a = placeDevModelAndAdvance(cursor, 400, 100, 500, 20, 10);
    expect(a).toEqual({ x: 10, y: 10 });
    const b = placeDevModelAndAdvance(cursor, 400, 80, 500, 20, 10);
    expect(b).toEqual({ x: 10, y: 130 });
  });
});

describe('gridPerWorldForImport', () => {
  const aabb = { min: [0, 0, 0] as [number, number, number], max: [10000, 2000, 4000] as [number, number, number] };

  it('skips 2–40 fit when fitGrid is false so two buildings keep world spacing', () => {
    const mm = 1000;
    const a = gridPerWorldForImport(aabb, mm, false);
    const b = gridPerWorldForImport({
      min: [20000, 0, 0],
      max: [30000, 2000, 4000],
    }, mm, false);
    expect(a).toBeCloseTo(1 / mm, 8);
    expect(b).toBeCloseTo(1 / mm, 8);
    const widthA = (10000) * a;
    const gap = (20000 - 0) * a;
    expect(widthA).toBeCloseTo(10, 5);
    expect(gap).toBeCloseTo(20, 5);
  });

  it('still applies fit when fitGrid is true', () => {
    const huge = { min: [0, 0, 0] as [number, number, number], max: [200000, 40000, 80000] as [number, number, number] };
    const fitted = gridPerWorldForImport(huge, 1000, true);
    const unfitted = gridPerWorldForImport(huge, 1000, false);
    expect(fitted).toBeLessThan(unfitted);
  });
});

describe('gridPerWorldForStreetscape', () => {
  it('corrects when mesh AABB is ~1000× smaller than surveyed sizeMeters', () => {
    const aabb = { min: [0, 0, 0] as [number, number, number], max: [0.02, 0.03, 0.02] as [number, number, number] };
    const g = gridPerWorldForStreetscape(aabb, 2.5, { w: 20, d: 20, h: 30 }, 2.5);
    expect(g).toBeCloseTo(8 / 0.02, 5);
  });

  it('keeps mm-based scale when sizeMeters already matches mesh', () => {
    const aabb = { min: [0, 0, 0] as [number, number, number], max: [20, 30, 20] as [number, number, number] };
    const g = gridPerWorldForStreetscape(aabb, 2.5, { w: 20, d: 20 }, 2.5);
    expect(g).toBeCloseTo(1 / 2.5, 5);
  });

  it('corrects pin-sized mesh even when ratio is between 0.5 and 2', () => {
    const aabb = { min: [0, 0, 0] as [number, number, number], max: [0.05, 0.08, 0.05] as [number, number, number] };
    const g = gridPerWorldForStreetscape(aabb, 1, { w: 12, d: 10, h: 20 }, 1);
    expect(0.05 * g).toBeGreaterThan(5);
  });
});

describe('model package caps', () => {
  it('allows Sketchfab-scale files and 1024 photo bake', () => {
    expect(MODEL_MAX_FILE_BYTES).toBe(192 * 1024 * 1024);
    expect(MODEL_ZIP_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(MODEL_BAKE_SIZE_MAX).toBe(1024);
  });
});
