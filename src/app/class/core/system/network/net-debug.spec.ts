import {
  formatMeshLine,
  getMeshLogMode,
  exportMeshDiagText,
} from './net-debug';

describe('net-debug', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
    });
  });

  it('maps UDONARIUM_NET_DEBUG modes', () => {
    storage.set('UDONARIUM_NET_DEBUG', '1');
    expect(getMeshLogMode()).toBe('verbose');
    storage.set('UDONARIUM_NET_DEBUG', 'verbose');
    expect(getMeshLogMode()).toBe('verbose');
    storage.set('UDONARIUM_NET_DEBUG', 'compact');
    expect(getMeshLogMode()).toBe('compact');
    storage.delete('UDONARIUM_NET_DEBUG');
    expect(getMeshLogMode()).toBe('off');
  });

  it('formatMeshLine shortens peer ids and compacts objects', () => {
    const line = formatMeshLine(
      'send deferred',
      'abcdefghijklmnop',
      { peer: 'abcdefghijklmnop', pending: 3 },
    );
    expect(line).toContain('send deferred');
    expect(line).toContain('abcdefghij');
    expect(line).not.toContain('abcdefghijklmnop');
    expect(line).toContain('pending=3');
  });

  it('exportMeshDiagText includes header and tips', () => {
    const text = exportMeshDiagText();
    expect(text).toContain('# Udonarium mesh diag');
    expect(text).toContain('recent');
    expect(text).toContain('UDONARIUM_NET_DEBUG');
    expect(text).toContain('room-data (local complete blobs):');
    expect(text).toContain('load:');
  });
});
