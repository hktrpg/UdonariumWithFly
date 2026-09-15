import { compressAsync, decompressAsync } from './compress';

describe('compress', () => {
  it('round-trips gzip bytes', async () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const compressed = await compressAsync(raw);
    const restored = await decompressAsync(compressed);
    expect(Array.from(restored)).toEqual(Array.from(raw));
  });

  it('throws when decompressing invalid gzip payload', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    await expectAsync(decompressAsync(garbage)).toBeRejected();
  });
});
