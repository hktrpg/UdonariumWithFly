import { attachPackagePath } from '@udonarium/terrain-model/model-package-files';
import { photoGltfFaces } from '@udonarium/terrain-model/photo-gltf-faces';

/**
 * Open3Dhk Individualised building: top face (Terrain「地板」) must be a
 * top-down roof, not a side facade. Regression for streetscape textured import.
 */
describe('Open3Dhk photo bake roof face', () => {
  it('floor (top) bake is not a tall facade strip', async () => {
    const base = 'building/B352541799701063A0';
    const files = await Promise.all([
      fetchFixture(`${base}/B352541799701063A0.gltf`, 'model/gltf+json'),
      fetchFixture(`${base}/B352541799701063A0.bin`, 'application/octet-stream'),
      fetchFixture(`${base}/B352541799701063A0_001.jpg`, 'image/jpeg'),
    ]);
    const result = await photoGltfFaces(files, 256);
    expect(result.blobs.floor).toBeTruthy();
    expect(result.blobs.wallBottom).toBeTruthy();

    const floor = await decodeRgba(result.blobs.floor!);
    const wall = await decodeRgba(result.blobs.wallBottom!);
    const floorOpaque = opaqueBounds(floor);
    const wallOpaque = opaqueBounds(wall);

    // Expose diagnostics on failure.
    const diag = {
      boxCount: result.boxes?.length,
      boxes: result.boxes?.map(b => ({
        dx: b.aabb.max[0] - b.aabb.min[0],
        dy: b.aabb.max[1] - b.aabb.min[1],
        dz: b.aabb.max[2] - b.aabb.min[2],
      })),
      aabb: result.aabb,
      fullAabb: result.fullAabb,
      floor: { w: floor.width, h: floor.height, luma: meanLuma(floor), opaque: floorOpaque },
      wall: { w: wall.width, h: wall.height, luma: meanLuma(wall), opaque: wallOpaque },
    };
    expect(diag.boxCount)
      .withContext(`expected single full box; ${JSON.stringify(diag)}`)
      .toBe(1);

    // Roof footprint is roughly square/rectangular — not a thin wall strip.
    const floorAspect = floor.width / Math.max(1, floor.height);
    expect(floorAspect)
      .withContext(`floor canvas aspect; ${JSON.stringify(diag)}`)
      .toBeGreaterThan(0.55);
    expect(floorAspect)
      .withContext(`floor canvas aspect; ${JSON.stringify(diag)}`)
      .toBeLessThan(1.8);

    // Side-view facade mistaken as roof tends to be much brighter plaster than asphalt roof.
    const floorLuma = meanLuma(floor);
    const wallLuma = meanLuma(wall);
    expect(floorLuma)
      .withContext(`top should not be much brighter than walls; ${JSON.stringify(diag)}`)
      .toBeLessThanOrEqual(wallLuma + 0.1);
  }, 60000);
});

function opaqueBounds(img: { data: Uint8ClampedArray; width: number; height: number }): {
  w: number;
  h: number;
  aspect: number;
  fill: number;
} {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3];
      if (a < 16) continue;
      opaque++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return { w: 0, h: 0, aspect: 0, fill: 0 };
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return {
    w,
    h,
    aspect: w / Math.max(1, h),
    fill: opaque / Math.max(1, img.width * img.height),
  };
}
async function fetchFixture(path: string, type: string): Promise<File> {
  const name = path.split('/').pop() || path;
  // angular.json test assets: src/testing/fixtures → /testing/fixtures
  const url = `/testing/fixtures/open3dhk-b352/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fixture missing: ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return attachPackagePath(new File([buf], name, { type }), path);
}

async function decodeRgba(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    return { data: imgData.data, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function meanLuma(img: { data: Uint8ClampedArray; width: number; height: number }): number {
  let sum = 0;
  let n = 0;
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 16) continue;
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    n++;
  }
  return n ? sum / n : 0;
}
