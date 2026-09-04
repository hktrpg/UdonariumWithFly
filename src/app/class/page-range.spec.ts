import { parsePageRange, formatPageRange, PageRangeError } from './page-range';

describe('parsePageRange', () => {
  it('returns all pages for empty input', () => {
    expect(parsePageRange('', 4)).toEqual([1, 2, 3, 4]);
    expect(parsePageRange('  ', 2)).toEqual([1, 2]);
  });

  it('parses lists and ranges like a print dialog', () => {
    expect(parsePageRange('1-3, 5,6,7,9-10', 12)).toEqual([1, 2, 3, 5, 6, 7, 9, 10]);
    expect(parsePageRange('3-1', 5)).toEqual([1, 2, 3]);
  });

  it('dedupes and sorts', () => {
    expect(parsePageRange('5, 2, 5, 2-4', 8)).toEqual([2, 3, 4, 5]);
  });

  it('rejects out of range and junk', () => {
    expect(() => parsePageRange('1, 99', 8)).toThrowError(PageRangeError);
    expect(() => parsePageRange('abc', 3)).toThrowError(PageRangeError);
  });
});

describe('formatPageRange', () => {
  it('collapses contiguous runs', () => {
    expect(formatPageRange([1, 2, 3, 5, 6, 7, 9, 10])).toBe('1-3, 5-7, 9-10');
  });
});
