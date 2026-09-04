import {
  looksLikeOpen3dhkSheetId,
  parseStreetSheetIndex,
  resolveStreetToSheet,
  setStreetSheetIndexForTests,
  suggestStreetSheets,
} from './street-sheet-index';

describe('street-sheet-index', () => {
  const fixture = parseStreetSheetIndex({
    version: 1,
    attribution: 'test',
    entries: [
      { zh: '彌敦道', en: 'Nathan Road', sheet: '11-SW-4B' },
      { zh: '石崗上村', en: 'Shek Kong Sheung Tsuen', sheet: '6-NE-13D', kind: 'place' },
      { zh: '石崗新村', en: 'Shek Kong San Tsuen', sheet: '6-NE-13A', kind: 'place' },
      { en: 'Airfield Road', sheet: '6-NE-13C' },
    ],
  });

  beforeEach(() => setStreetSheetIndexForTests(fixture));
  afterEach(() => setStreetSheetIndexForTests(null));

  it('detects Open3Dhk sheet ids', () => {
    expect(looksLikeOpen3dhkSheetId('11-SW-4B')).toBeTrue();
    expect(looksLikeOpen3dhkSheetId('6-NE-13D')).toBeTrue();
    expect(looksLikeOpen3dhkSheetId('石崗上村')).toBeFalse();
  });

  it('suggests by Chinese prefix and includes sheet CODE', () => {
    const hits = suggestStreetSheets(fixture, '石崗', 10);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some(h => h.sheet === '6-NE-13D' && h.zh === '石崗上村')).toBeTrue();
  });

  it('resolves exact street to sheet', () => {
    const hit = resolveStreetToSheet(fixture, '彌敦道');
    expect(hit?.sheet).toBe('11-SW-4B');
    expect(hit?.label).toContain('彌敦道');
  });

  it('resolves English place name', () => {
    const hit = resolveStreetToSheet(fixture, 'Shek Kong Sheung Tsuen');
    expect(hit?.sheet).toBe('6-NE-13D');
  });

  it('passes through raw sheet ids', () => {
    const hit = resolveStreetToSheet(fixture, '6-NE-13D');
    expect(hit?.sheet).toBe('6-NE-13D');
  });

  it('resolves pasted address that starts with a known place', () => {
    const hit = resolveStreetToSheet(fixture, '石 崗 上村 6A 地鋪, Yuen Long');
    expect(hit?.sheet).toBe('6-NE-13D');
    expect(hit?.zh).toBe('石崗上村');
  });
});
