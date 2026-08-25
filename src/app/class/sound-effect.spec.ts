import { shouldPlaySoundEffectForView } from './sound-effect';

describe('shouldPlaySoundEffectForView', () => {
  it('plays room-wide events (no tableId) on any view', () => {
    expect(shouldPlaySoundEffectForView({ identifier: 'se1' }, 'mapA')).toBeTrue();
    expect(shouldPlaySoundEffectForView({ identifier: 'se1' }, '')).toBeTrue();
    expect(shouldPlaySoundEffectForView('se1', 'mapB')).toBeTrue();
  });

  it('plays map-scoped events only when viewing that table', () => {
    expect(shouldPlaySoundEffectForView({ identifier: 'se1', tableId: 'mapA' }, 'mapA')).toBeTrue();
    expect(shouldPlaySoundEffectForView({ identifier: 'se1', tableId: 'mapA' }, 'mapB')).toBeFalse();
    expect(shouldPlaySoundEffectForView({ identifier: 'se1', tableId: 'mapA' }, '')).toBeFalse();
  });

  it('ignores empty identifier', () => {
    expect(shouldPlaySoundEffectForView({ identifier: '', tableId: 'mapA' }, 'mapA')).toBeFalse();
    expect(shouldPlaySoundEffectForView('', 'mapA')).toBeFalse();
  });
});
