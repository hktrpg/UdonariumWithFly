import { sampleBlobRgbAtUv } from './floor-tint';

describe('sampleBlobRgbAtUv', () => {
  it('samples the dominant color near a UV', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2244aa';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#cc5533';
    ctx.fillRect(40, 40, 20, 20);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('blob'))), 'image/png');
    });
    const blue = await sampleBlobRgbAtUv(blob, 0.2, 0.2);
    expect(blue.b).toBeGreaterThan(blue.r);
    const warm = await sampleBlobRgbAtUv(blob, 0.8, 0.8);
    expect(warm.r).toBeGreaterThan(warm.b);
  });
});
