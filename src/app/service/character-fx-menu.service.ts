import { Injectable } from '@angular/core';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { EventSystem } from '@udonarium/core/system';
import { AuraNameConfig } from '@udonarium/table-fx/aura-name-config';
import {
  CHARACTER_STATUS_DEFS,
  CharacterStatusEntry,
  CharacterStatusId,
  parseStatusesJson,
  stringifyStatuses,
} from '@udonarium/table-fx/character-status';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { ContextMenuAction, ContextMenuSeparator } from 'service/context-menu.service';

const RING_OPTIONS: { id: string; name: string }[] = [
  { id: 'none', name: '無' },
  { id: 'fire', name: '火環' },
  { id: 'magic', name: '魔法陣' },
  { id: 'tech', name: '科技環' },
  { id: 'eldritch', name: '邪異環' },
  { id: 'holy', name: '聖光環' },
];

@Injectable({ providedIn: 'root' })
export class CharacterFxMenuService {
  get auraNames(): string[] { return AuraNameConfig.instance.names; }

  makeAuraMenu(character: GameCharacter): ContextMenuAction {
    const names = this.auraNames;
    const auraLabel = (i: number) => `${character.aura == i ? '◉' : '○'} ${i < 0 ? '無' : names[i]}`;
    return {
      name: '光環',
      action: null,
      subActions: [
        {
          name: auraLabel(-1),
          action: () => { character.aura = -1; EventSystem.trigger('UPDATE_INVENTORY', null); },
          nameUpdate: () => auraLabel(-1),
          checkBox: 'radio'
        },
        ContextMenuSeparator,
        ...names.map((color, i) => ({
          name: auraLabel(i),
          colorSample: true,
          action: () => { character.aura = i; EventSystem.trigger('UPDATE_INVENTORY', null); },
          nameUpdate: () => auraLabel(i),
          checkBox: 'radio' as const
        })),
        ContextMenuSeparator,
        {
          name: '清除光環',
          action: () => { character.aura = -1; EventSystem.trigger('UPDATE_INVENTORY', null); },
          disabled: character.aura === -1
        }
      ]
    };
  }

  makeRingMenu(character: GameCharacter): ContextMenuAction {
    return {
      name: '套圈',
      action: null,
      subActions: RING_OPTIONS.map(opt => ({
        name: `${character.floorRing === opt.id ? '◉' : '○'} ${opt.name}`,
        action: () => { character.floorRing = opt.id; EventSystem.trigger('UPDATE_INVENTORY', null); },
        nameUpdate: () => `${character.floorRing === opt.id ? '◉' : '○'} ${opt.name}`,
        checkBox: 'radio' as const
      }))
    };
  }

  makeStatusMenu(character: GameCharacter): ContextMenuAction {
    const labelOf = (id: string) => {
      const def = CHARACTER_STATUS_DEFS.find(d => d.id === id);
      const active = parseStatusesJson(character.statusesJson).find(s => s.id === id);
      if (!def) return '☐';
      if (def.hasLevel) {
        return `${active ? '☑' : '☐'} ${def.name}${active?.level ? ` (${active.level})` : ''}`;
      }
      return `${active ? '☑' : '☐'} ${def.name}`;
    };
    return {
      name: '狀態',
      action: null,
      subActions: CHARACTER_STATUS_DEFS.map(def => {
        if (def.hasLevel) {
          return {
            name: labelOf(def.id),
            action: () => this.cycleExhaustion(character),
            nameUpdate: () => labelOf(def.id),
            checkBox: 'check' as const
          };
        }
        return {
          name: labelOf(def.id),
          action: () => this.toggleStatus(character, def.id),
          nameUpdate: () => labelOf(def.id),
          checkBox: 'check' as const
        };
      })
    };
  }

  makeCombatMenu(character: GameCharacter): ContextMenuAction {
    return {
      name: '加入戰鬥',
      action: () => {
        if (GuestSession.isGuest) return;
        CombatTracker.instance.addCombatant({
          characterIdentifier: character.identifier,
          name: character.name || '未命名',
          isNpc: !character.owner,
          isDefeated: false,
          isHidden: false,
          imageIdentifier: character.imageFile?.identifier || '',
        });
      },
      disabled: GuestSession.isGuest,
      keepOpen: false,
    };
  }

  makeImageEffectMenu(character: GameCharacter, getters: {
    isInverse: boolean; isHollow: boolean; isBlackPaint: boolean;
    setInverse: (v: boolean) => void; setHollow: (v: boolean) => void; setBlackPaint: (v: boolean) => void;
  }): ContextMenuAction {
    return {
      name: '圖片效果',
      action: null,
      subActions: [
        {
          name: getters.isInverse ? '☑ 反轉' : '☐ 反轉',
          action: () => { getters.setInverse(!getters.isInverse); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        {
          name: getters.isHollow ? '☑ 模糊' : '☐ 模糊',
          action: () => { getters.setHollow(!getters.isHollow); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        {
          name: getters.isBlackPaint ? '☑ 設為黑色剪影' : '☐ 設為黑色剪影',
          action: () => { getters.setBlackPaint(!getters.isBlackPaint); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        ContextMenuSeparator,
        {
          name: '重置圖片效果',
          action: () => {
            getters.setInverse(false);
            getters.setHollow(false);
            getters.setBlackPaint(false);
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          disabled: !getters.isInverse && !getters.isHollow && !getters.isBlackPaint
        }
      ]
    };
  }

  private toggleStatus(character: GameCharacter, id: CharacterStatusId) {
    const list = parseStatusesJson(character.statusesJson);
    const idx = list.findIndex(s => s.id === id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push({ id });
    character.statusesJson = stringifyStatuses(list);
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  private cycleExhaustion(character: GameCharacter) {
    const list = parseStatusesJson(character.statusesJson);
    const idx = list.findIndex(s => s.id === 'exhaustion');
    if (idx < 0) {
      list.push({ id: 'exhaustion', level: 1 });
    } else {
      const level = (list[idx].level || 1) + 1;
      if (level > 6) list.splice(idx, 1);
      else list[idx].level = level;
    }
    character.statusesJson = stringifyStatuses(list);
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  statusesOf(character: GameCharacter): CharacterStatusEntry[] {
    return parseStatusesJson(character.statusesJson);
  }

  ringAsset(ring: string): string {
    switch (ring) {
      case 'fire': return 'assets/images/fx/fire/ring.svg';
      case 'magic': return 'assets/images/fx/magic/ring.svg';
      case 'tech': return 'assets/images/fx/tech/ring.svg';
      case 'eldritch': return 'assets/images/fx/coc/ring.svg';
      case 'holy': return 'assets/images/fx/magic/holy-ring.svg';
      default: return '';
    }
  }
}
