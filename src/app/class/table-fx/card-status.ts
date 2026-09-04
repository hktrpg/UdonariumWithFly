/** Card markers (session notes) — distinct from character combat statuses. */
export type CardStatusId =
  | 'read'
  | 'unread'
  | 'checked'
  | 'starred'
  | 'question'
  | 'target'
  | 'banned'
  | 'warning'
  | 'flag';

export interface CardStatusEntry {
  id: CardStatusId;
}

export interface CardStatusDef {
  id: CardStatusId;
  icon: string;
}

/** Display names come from i18n keys card.status.* */
export const CARD_STATUS_DEFS: CardStatusDef[] = [
  { id: 'read', icon: 'mark_email_read' },
  { id: 'unread', icon: 'mark_email_unread' },
  { id: 'checked', icon: 'check_circle' },
  { id: 'starred', icon: 'star' },
  { id: 'question', icon: 'help' },
  { id: 'target', icon: 'my_location' },
  { id: 'banned', icon: 'block' },
  { id: 'warning', icon: 'warning' },
  { id: 'flag', icon: 'flag' },
];

const CARD_STATUS_IDS = new Set<string>(CARD_STATUS_DEFS.map(d => d.id));

export function getCardStatusDef(id: CardStatusId | string): CardStatusDef | undefined {
  return CARD_STATUS_DEFS.find(d => d.id === id);
}

export function parseCardStatusesJson(json: string): CardStatusEntry[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is CardStatusEntry =>
      !!e && typeof e.id === 'string' && CARD_STATUS_IDS.has(e.id));
  } catch {
    return [];
  }
}

export function stringifyCardStatuses(entries: CardStatusEntry[]): string {
  return JSON.stringify(entries || []);
}

export function hasCardStatus(jsonOrEntries: string | CardStatusEntry[], id: CardStatusId): boolean {
  const list = typeof jsonOrEntries === 'string' ? parseCardStatusesJson(jsonOrEntries) : jsonOrEntries;
  return list.some(s => s.id === id);
}

/** Add or remove a status flag; returns new list. */
export function setCardStatusFlag(
  entries: CardStatusEntry[],
  id: CardStatusId,
  enabled: boolean,
): CardStatusEntry[] {
  const list = entries.filter(s => s.id !== id);
  if (enabled) list.push({ id });
  return list;
}
