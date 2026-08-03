import { Injectable } from '@angular/core';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
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
import { TabletopSelectionService } from 'service/tabletop-selection.service';

const VISION_RANGE_PRESETS = [0, 3, 6, 9, 12, 18, 24];
const BRIGHT_LIGHT_PRESETS = [0, 1, 2, 3, 4, 5, 6, 8];
const DIM_LIGHT_PRESETS = [0, 2, 4, 6, 8, 10, 12, 16];

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
  constructor(private selectionService: TabletopSelectionService) {}

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

  makeMyTokenMenu(character: GameCharacter): ContextMenuAction {
    const mine = () => Network.peer?.userId || '';
    const isMine = () => !!mine() && character.playerOwner === mine();
    const takenByOther = () => !!character.playerOwner && character.playerOwner !== mine();
    const isGM = () => !!PeerCursor.myCursor?.isGMMode;
    return {
      name: isMine() ? '☑ 作為我的角色' : '☐ 作為我的角色',
      action: () => {
        if (GuestSession.isGuest || !mine()) return;
        if (takenByOther() && !isGM()) return;
        GameCharacter.setAsMyToken(character, !isMine());
        EventSystem.trigger('UPDATE_INVENTORY', null);
      },
      nameUpdate: () => {
        if (isMine()) return '☑ 作為我的角色';
        if (takenByOther()) return `☐ 作為我的角色（${character.playerOwnerName}）`;
        return '☐ 作為我的角色';
      },
      checkBox: 'check',
      disabled: GuestSession.isGuest || (takenByOther() && !isGM()),
    };
  }

  makeCombatMenu(character: GameCharacter): ContextMenuAction {
    const selectedCount = () =>
      this.selectionService.objects.filter(o => o instanceof GameCharacter).length;
    return {
      name: '加入戰鬥',
      action: () => {
        if (GuestSession.isGuest) return;
        const chars = this.combatCharactersFor(character);
        CombatTracker.instance.addCombatants(chars.map(obj => ({
          characterIdentifier: obj.identifier,
          name: obj.name || '未命名',
          isNpc: !obj.hasPlayerController,
          isDefeated: false,
          isHidden: false,
          imageIdentifier: obj.imageFile?.identifier || '',
        })));
      },
      nameUpdate: () => {
        const n = selectedCount();
        return n > 1 ? `加入戰鬥（${n}）` : '加入戰鬥';
      },
      disabled: GuestSession.isGuest,
      keepOpen: false,
    };
  }

  /** All selected character tokens, ensuring the context-menu target is included. */
  private combatCharactersFor(character: GameCharacter): GameCharacter[] {
    const selected = this.selectionService.objects.filter((o): o is GameCharacter => o instanceof GameCharacter);
    if (!selected.length) return [character];
    if (selected.some(c => c.identifier === character.identifier)) return selected;
    return [...selected, character];
  }

  makeVisionMenu(character: GameCharacter): ContextMenuAction {
    const mine = Network.peer?.userId || '';
    // Manual claim only — chat auto-vision must not drive this checkbox.
    const isMyVision = !!mine && character.visionOwner === mine;
    const title = () =>
      `視野／光照（視${character.visionRangeGrid} 亮${character.brightLightGrid} 昏${character.dimLightGrid}）`;

    const rangeSub = (
      label: string,
      presets: number[],
      getter: () => number,
      setter: (n: number) => void,
    ): ContextMenuAction => ({
      name: `${label}：${getter()} 格`,
      action: null,
      nameUpdate: () => `${label}：${getter()} 格`,
      subActions: presets.map(n => ({
        name: `${getter() === n ? '◉' : '○'} ${n} 格`,
        action: () => {
          setter(n);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        nameUpdate: () => `${getter() === n ? '◉' : '○'} ${n} 格`,
        checkBox: 'radio' as const,
      })),
    });

    return {
      name: title(),
      action: null,
      nameUpdate: title,
      subActions: [
        {
          name: isMyVision ? '☑ 作為我的視野角色' : '☐ 作為我的視野角色',
          action: () => {
            if (!mine) return;
            character.visionOwner = character.visionOwner === mine ? '' : mine;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          nameUpdate: () => {
            const on = !!mine && character.visionOwner === mine;
            return on ? '☑ 作為我的視野角色' : '☐ 作為我的視野角色';
          },
          checkBox: 'check',
          disabled: GuestSession.isGuest,
        },
        ContextMenuSeparator,
        rangeSub('視野距離', VISION_RANGE_PRESETS,
          () => character.visionRangeGrid,
          n => { character.visionRange = n; }),
        rangeSub('亮光', BRIGHT_LIGHT_PRESETS,
          () => character.brightLightGrid,
          n => {
            character.brightLight = n;
            if (character.dimLightGrid < n) character.dimLight = n;
          }),
        rangeSub('昏暗光', DIM_LIGHT_PRESETS,
          () => character.dimLightGrid,
          n => { character.dimLight = n; }),
        ContextMenuSeparator,
        {
          name: '清除發出光照',
          action: () => {
            character.brightLight = 0;
            character.dimLight = 0;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          disabled: character.brightLightGrid <= 0 && character.dimLightGrid <= 0,
        },
      ],
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
