import { gzip, ungzip } from 'pako';

export async function compressAsync(data: Uint8Array): Promise<Uint8Array> {
  if (compressionAvailable()) {
    try {
      return await processAsync(new CompressionStream('gzip'), data);
    } catch {
      // fall through to pako
    }
  }
  try {
    return gzip(data);
  } catch {
    return data;
  }
}

/** Must return plain bytes for MessagePack; never return still-compressed gzip on failure. */
export async function decompressAsync(data: Uint8Array): Promise<Uint8Array> {
  if (decompressionAvailable()) {
    try {
      return await processAsync(new DecompressionStream('gzip'), data);
    } catch {
      // fall through to pako
    }
  }
  try {
    return ungzip(data);
  } catch (err) {
    throw new Error(`gzip decompress failed: ${(err as Error)?.message ?? err}`);
  }
}

function compressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined';
}

function decompressionAvailable(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

async function processAsync(transform: ReadableWritablePair, data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
