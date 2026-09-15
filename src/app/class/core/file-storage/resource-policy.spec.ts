import {
  MOBILE_LOW_TIER_TOTAL_BYTES,
  RESOURCE_POLICY_TABLE,
  applyResourcePolicy,
  getResourcePolicy,
} from './resource-policy';

describe('resource-policy', () => {
  afterEach(() => {
    applyResourcePolicy('high');
  });

  it('desktop high tier keeps legacy concurrent limits', () => {
    applyResourcePolicy('high');
    const p = getResourcePolicy();
    expect(p.maxConcurrentReceives).toBe(4);
    expect(p.maxConcurrentHydrate).toBe(4);
    expect(p.pdfMaxWidthPx).toBe(1600);
    expect(p.pdfMaxScale).toBe(4);
  });

  it('low tier tightens mobile limits', () => {
    applyResourcePolicy('low');
    const p = getResourcePolicy();
    expect(p.maxConcurrentReceives).toBe(2);
    expect(p.pdfMaxWidthPx).toBe(800);
    expect(p.showMemoryWarning).toBeTrue();
  });

  it('MOBILE_LOW_TIER_TOTAL_BYTES is 512MB', () => {
    expect(MOBILE_LOW_TIER_TOTAL_BYTES).toBe(512 * 1024 * 1024);
    expect(RESOURCE_POLICY_TABLE.medium.pdfMaxWidthPx).toBe(1200);
  });
});
