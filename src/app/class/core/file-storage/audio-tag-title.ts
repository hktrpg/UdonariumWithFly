/** Strip path and extension for a usable display name. */
export function audioFileBaseName(fileName: string): string {
  const base = (fileName || '').split(/[\\/]/).pop() || fileName || '';
  return base.replace(/\.[^.]+$/, '') || base;
}

/**
 * Best-effort title from embedded tags (ID3v2 / ID3v1).
 * Returns '' when no title is found.
 */
export async function readAudioTagTitle(file: File | Blob): Promise<string> {
  try {
    const headSize = Math.min(file.size, 512 * 1024);
    const head = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
    const fromV2 = parseId3v2Title(head);
    if (fromV2) return fromV2;

    if (file.size >= 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      const fromV1 = parseId3v1Title(tail);
      if (fromV1) return fromV1;
    }
  } catch {
    /* ignore corrupt tags */
  }
  return '';
}

function parseId3v2Title(bytes: Uint8Array): string {
  if (bytes.length < 10) return '';
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return ''; // "ID3"
  const ver = bytes[3];
  if (ver < 2 || ver > 4) return '';
  const unsync = !!(bytes[5] & 0x80);
  let size = synchsafeSize(bytes[6], bytes[7], bytes[8], bytes[9]);
  let offset = 10;
  // Skip extended header (v3/v4)
  if (bytes[5] & 0x40) {
    if (ver === 4) {
      if (offset + 4 > bytes.length) return '';
      const ext = synchsafeSize(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      offset += Math.max(4, ext);
    } else {
      if (offset + 4 > bytes.length) return '';
      const ext = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 4 + Math.max(0, ext);
    }
  }
  const end = Math.min(bytes.length, 10 + size);
  while (offset + 6 <= end) {
    let frameId = '';
    let frameSize = 0;
    let headerLen = 0;
    if (ver === 2) {
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      if (frameId === '\0\0\0') break;
      frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      headerLen = 6;
    } else {
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (frameId === '\0\0\0\0') break;
      if (ver === 4) {
        frameSize = synchsafeSize(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      } else {
        frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      }
      headerLen = 10;
    }
    if (frameSize <= 0 || offset + headerLen + frameSize > bytes.length) break;
    const body = bytes.subarray(offset + headerLen, offset + headerLen + frameSize);
    const isTitle = frameId === 'TIT2' || frameId === 'TT2';
    if (isTitle) {
      const text = decodeId3Text(body, unsync);
      if (text) return text;
    }
    offset += headerLen + frameSize;
  }
  return '';
}

function parseId3v1Title(tag: Uint8Array): string {
  if (tag.length < 128) return '';
  if (tag[0] !== 0x54 || tag[1] !== 0x41 || tag[2] !== 0x47) return ''; // "TAG"
  const raw = tag.subarray(3, 33);
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0x00 || raw[end - 1] === 0x20)) end--;
  if (end < 1) return '';
  try {
    return new TextDecoder('latin1').decode(raw.subarray(0, end)).trim();
  } catch {
    return '';
  }
}

function synchsafeSize(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
}

function decodeId3Text(body: Uint8Array, _unsync: boolean): string {
  if (body.length < 1) return '';
  const encoding = body[0];
  let data = body.subarray(1);
  // Skip BOM / null terminators later via trim
  try {
    let text = '';
    if (encoding === 0) {
      text = new TextDecoder('latin1').decode(data);
    } else if (encoding === 1) {
      // UTF-16 with BOM
      text = new TextDecoder('utf-16').decode(data);
    } else if (encoding === 2) {
      text = new TextDecoder('utf-16be').decode(data);
    } else {
      text = new TextDecoder('utf-8').decode(data);
    }
    return text.replace(/\0+$/g, '').trim();
  } catch {
    return '';
  }
}
