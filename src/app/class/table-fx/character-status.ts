export type CharacterStatusId =
  | 'blinded' | 'charmed' | 'deafened' | 'frightened'
  | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed'
  | 'petrified' | 'poisoned' | 'prone' | 'restrained'
  | 'stunned' | 'unconscious' | 'exhaustion';

export interface CharacterStatusEntry {
  id: CharacterStatusId;
  level?: number;
}

export interface CharacterStatusDef {
  id: CharacterStatusId;
  name: string;
  nameEn: string;
  tooltip: string;
  icon: string;
  hasLevel?: boolean;
}

/** Self-authored Traditional Chinese summaries (not copied from third-party pages). */
export const CHARACTER_STATUS_DEFS: CharacterStatusDef[] = [
  {
    id: 'blinded', name: '目盲', nameEn: 'Blinded', icon: 'visibility_off',
    tooltip: '涉及視覺的能力檢定自動失敗。對你的攻擊有優勢；你的攻擊有劣勢。'
  },
  {
    id: 'charmed', name: '迷惑', nameEn: 'Charmed', icon: 'favorite',
    tooltip: '不能攻擊施惑者，也不能對其施展有害魔法或能力。施惑者對你的社交檢定有優勢。'
  },
  {
    id: 'deafened', name: '耳聾', nameEn: 'Deafened', icon: 'hearing_disabled',
    tooltip: '涉及聽覺的能力檢定自動失敗。'
  },
  {
    id: 'frightened', name: '恐慌', nameEn: 'Frightened', icon: 'sentiment_very_dissatisfied',
    tooltip: '恐懼來源在視野內時，能力檢定與攻擊骰有劣勢。不能自願靠近恐懼來源。'
  },
  {
    id: 'grappled', name: '被擒', nameEn: 'Grappled', icon: 'front_hand',
    tooltip: '速度變為 0，且無法受益於速度加值。擒抱者乏力、或你被移出其觸及時結束。'
  },
  {
    id: 'incapacitated', name: '乏力', nameEn: 'Incapacitated', icon: 'do_not_touch',
    tooltip: '不能採取動作或反應。'
  },
  {
    id: 'invisible', name: '隱形', nameEn: 'Invisible', icon: 'blur_on',
    tooltip: '肉眼不可見；就隱匿而言視作重度遮蔽。對你的攻擊有劣勢；你的攻擊有優勢。'
  },
  {
    id: 'paralyzed', name: '麻痺', nameEn: 'Paralyzed', icon: 'accessibility_new',
    tooltip: '乏力，不能移動或說話。力量與敏捷豁免自動失敗。對你的攻擊有優勢；5 尺內命中為重擊。'
  },
  {
    id: 'petrified', name: '石化', nameEn: 'Petrified', icon: 'account_balance',
    tooltip: '變為固定雕像、乏力、無法觀察。攻擊對你有優勢；力／敏豁免自動失敗。對傷害有抗力；免疫毒素與疾病（已有者暫止）。'
  },
  {
    id: 'poisoned', name: '中毒', nameEn: 'Poisoned', icon: 'coronavirus',
    tooltip: '攻擊骰與能力檢定有劣勢。'
  },
  {
    id: 'prone', name: '倒地', nameEn: 'Prone', icon: 'airline_seat_flat',
    tooltip: '只能爬行或起立。你的攻擊有劣勢。5 尺內對你的攻擊有優勢，否則為劣勢。'
  },
  {
    id: 'restrained', name: '束縛', nameEn: 'Restrained', icon: 'link',
    tooltip: '速度為 0。對你的攻擊有優勢；你的攻擊與敏捷豁免有劣勢。'
  },
  {
    id: 'stunned', name: '震懾', nameEn: 'Stunned', icon: 'flash_on',
    tooltip: '乏力，不能移動，說話困難。力／敏豁免自動失敗。對你的攻擊有優勢。'
  },
  {
    id: 'unconscious', name: '昏迷', nameEn: 'Unconscious', icon: 'hotel',
    tooltip: '乏力、倒地、放手中物、無法觀察。力／敏豁免自動失敗。攻擊對你有優勢；5 尺內命中為重擊。'
  },
  {
    id: 'exhaustion', name: '力竭', nameEn: 'Exhaustion', icon: 'battery_alert', hasLevel: true,
    tooltip: '1：能力檢定劣勢。2：速度減半。3：攻擊與豁免劣勢。4：生命上限減半。5：速度 0。6：死亡。長休並進食可降 1 級。'
  },
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
