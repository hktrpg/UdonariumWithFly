import * as localForage from 'localforage';

/** Shared dock preference for Party Status + Combat Command Rail. */
export const COMBAT_SURFACE_DOCKED_KEY = 'udonanaumu-combat-surface-docked';

let docked = true;
const listeners = new Set<() => void>();

export function isCombatSurfaceDocked(): boolean {
  return docked;
}

export function setCombatSurfaceDocked(value: boolean) {
  if (docked === value) return;
  docked = value;
  localForage.setItem(COMBAT_SURFACE_DOCKED_KEY, value).catch(() => {});
  for (const cb of listeners) cb();
}

export function toggleCombatSurfaceDocked() {
  setCombatSurfaceDocked(!docked);
}

export function onCombatSurfaceDockedChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function loadCombatSurfaceDocked(): Promise<boolean> {
  return localForage.getItem<boolean>(COMBAT_SURFACE_DOCKED_KEY).then(v => {
    if (typeof v === 'boolean') {
      docked = v;
      for (const cb of listeners) cb();
    }
    return docked;
  }).catch(() => docked);
}
