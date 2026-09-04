/** Parse print-style page lists: "1-3, 5,6,7,9-10". */

export type PageRangeErrorCode = 'empty' | 'invalid' | 'out_of_range';

export class PageRangeError extends Error {
  readonly code: PageRangeErrorCode;

  constructor(code: PageRangeErrorCode, message?: string) {
    super(message || code);
    this.name = 'PageRangeError';
    this.code = code;
  }
}

/**
 * Parse a page-range string into 1-based page numbers (sorted, unique).
 * Empty / whitespace → all pages `1..pageCount`.
 */
export function parsePageRange(input: string, pageCount: number): number[] {
  const max = Math.floor(Number(pageCount));
  if (!Number.isFinite(max) || max < 1) {
    throw new PageRangeError('invalid', 'pageCount must be >= 1');
  }

  const raw = (input || '').trim();
  if (!raw) {
    return Array.from({ length: max }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  const parts = raw.split(/[,，;\s]+/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) {
    throw new PageRangeError('empty', 'No pages in range');
  }

  for (const part of parts) {
    const m = /^(\d+)\s*[-–—~～]\s*(\d+)$/.exec(part);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) {
        throw new PageRangeError('invalid', `Bad range: ${part}`);
      }
      if (a > b) [a, b] = [b, a];
      if (b > max) throw new PageRangeError('out_of_range', `Page ${b} > ${max}`);
      for (let p = a; p <= b; p++) pages.add(p);
      continue;
    }
    if (!/^\d+$/.test(part)) {
      throw new PageRangeError('invalid', `Bad token: ${part}`);
    }
    const n = parseInt(part, 10);
    if (n < 1) throw new PageRangeError('invalid', `Bad page: ${part}`);
    if (n > max) throw new PageRangeError('out_of_range', `Page ${n} > ${max}`);
    pages.add(n);
  }

  if (!pages.size) throw new PageRangeError('empty', 'No pages in range');
  return [...pages].sort((a, b) => a - b);
}

export function formatPageRange(pages: number[]): string {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(', ');
}
