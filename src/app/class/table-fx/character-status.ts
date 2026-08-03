export type CharacterStatusId =
  | 'blinded' | 'charmed' | 'deafened' | 'frightened'
  | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed'
  | 'petrified' | 'poisoned' | 'prone' | 'restrained'
  | 'stunned' | 'unconscious' | 'exhaustion' | 'dead';

export interface CharacterStatusEntry {
  id: CharacterStatusId;
  level?: number;
}

/** Display names come from i18n keys fx.status.* */
export interface CharacterStatusDef {
  id: CharacterStatusId;
  icon: string;
  hasLevel?: boolean;
}

export const CHARACTER_STATUS_DEFS: CharacterStatusDef[] = [
  { id: 'blinded', icon: 'visibility_off' },
  { id: 'charmed', icon: 'favorite' },
  { id: 'deafened', icon: 'hearing_disabled' },
  { id: 'frightened', icon: 'sentiment_very_dissatisfied' },
  { id: 'grappled', icon: 'front_hand' },
  { id: 'incapacitated', icon: 'do_not_touch' },
  { id: 'invisible', icon: 'blur_on' },
  { id: 'paralyzed', icon: 'accessibility_new' },
  { id: 'petrified', icon: 'account_balance' },
  { id: 'poisoned', icon: 'coronavirus' },
  { id: 'prone', icon: 'airline_seat_flat' },
  { id: 'restrained', icon: 'link' },
  { id: 'stunned', icon: 'flash_on' },
  { id: 'unconscious', icon: 'hotel' },
  { id: 'exhaustion', icon: 'battery_alert', hasLevel: true },
  { id: 'dead', icon: 'skull' },
];

export function getStatusDef(id: CharacterStatusId): CharacterStatusDef {
  return CHARACTER_STATUS_DEFS.find(d => d.id === id);
}

export function parseStatusesJson(json: string): CharacterStatusEntry[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && typeof e.id === 'string');
  } catch {
    return [];
  }
}

export function stringifyStatuses(entries: CharacterStatusEntry[]): string {
  return JSON.stringify(entries || []);
}

export function hasStatus(jsonOrEntries: string | CharacterStatusEntry[], id: CharacterStatusId): boolean {
  const list = typeof jsonOrEntries === 'string' ? parseStatusesJson(jsonOrEntries) : jsonOrEntries;
  return list.some(s => s.id === id);
}

/** Add or remove a non-leveled status flag; returns new list. */
export function setStatusFlag(
  entries: CharacterStatusEntry[],
  id: CharacterStatusId,
  enabled: boolean,
): CharacterStatusEntry[] {
  const list = entries.filter(s => s.id !== id);
  if (enabled) list.push({ id });
  return list;
}
