import { Injectable } from '@angular/core';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { AuraNameConfig, DEFAULT_AURA_NAMES } from '@udonarium/table-fx/aura-name-config';
import {
  CHARACTER_STATUS_DEFS,
  CharacterStatusEntry,
  CharacterStatusId,
  parseStatusesJson,
  stringifyStatuses,
} from '@udonarium/table-fx/character-status';
import { CombatTracker } from '@udonarium/table-fx/combat-tracker';
import { ContextMenuAction, ContextMenuSeparator } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';

const VISION_RANGE_PRESETS = [0, 3, 6, 9, 12, 18, 24];
const BRIGHT_LIGHT_PRESETS = [0, 1, 2, 3, 4, 5, 6, 8];
const DIM_LIGHT_PRESETS = [0, 2, 4, 6, 8, 10, 12, 16];

const RING_OPTIONS = ['none', 'fire', 'magic', 'tech', 'eldritch', 'holy'];
const AURA_COLOR_KEYS = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'yellow', 'white'] as const;
const AURA_SAMPLE_COLORS = ['#000', '#00f', '#0f0', '#0ff', '#f00', '#f0f', '#ff0', '#fff'];

@Injectable({ providedIn: 'root' })
export class CharacterFxMenuService {
  constructor(
    private selectionService: TabletopSelectionService,
    private i18n: I18nService,
  ) {}

  get auraNames(): string[] { return AuraNameConfig.instance.names; }

  private auraDisplayName(index: number, custom: string): string {
    if (custom && custom !== DEFAULT_AURA_NAMES[index]) return custom;
    return this.i18n.t(`chat.aura.${AURA_COLOR_KEYS[index]}`);
  }

  makeAuraMenu(character: GameCharacter): ContextMenuAction {
    const names = this.auraNames;
    const auraLabel = (i: number) => `${character.aura == i ? '◉' : '○'} ${i < 0 ? this.i18n.t('fx.none') : this.auraDisplayName(i, names[i])}`;
    return {
      name: this.i18n.t('fx.aura'),
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
          sampleColor: AURA_SAMPLE_COLORS[i],
          action: () => { character.aura = i; EventSystem.trigger('UPDATE_INVENTORY', null); },
          nameUpdate: () => auraLabel(i),
          checkBox: 'radio' as const
        })),
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.clearAura'),
          action: () => { character.aura = -1; EventSystem.trigger('UPDATE_INVENTORY', null); },
          disabled: character.aura === -1
        }
      ]
    };
  }

  makeRingMenu(character: GameCharacter): ContextMenuAction {
    return {
      name: this.i18n.t('fx.ring'),
      action: null,
      subActions: RING_OPTIONS.map(id => ({
        name: `${character.floorRing === id ? '◉' : '○'} ${this.i18n.t(`fx.ring.${id}`)}`,
        action: () => { character.floorRing = id; EventSystem.trigger('UPDATE_INVENTORY', null); },
        nameUpdate: () => `${character.floorRing === id ? '◉' : '○'} ${this.i18n.t(`fx.ring.${id}`)}`,
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
        return `${active ? '☑' : '☐'} ${this.i18n.t(`fx.status.${id}`)}${active?.level ? ` (${active.level})` : ''}`;
      }
      return `${active ? '☑' : '☐'} ${this.i18n.t(`fx.status.${id}`)}`;
    };
    return {
      name: this.i18n.t('fx.status'),
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
      name: this.i18n.t('fx.myToken', { mark: isMine() ? '☑' : '☐' }),
      action: () => {
        if (GuestSession.isGuest || !mine()) return;
        if (takenByOther() && !isGM()) return;
        GameCharacter.setAsMyToken(character, !isMine());
        EventSystem.trigger('UPDATE_INVENTORY', null);
      },
      nameUpdate: () => {
        if (isMine()) return this.i18n.t('fx.myToken', { mark: '☑' });
        if (takenByOther()) return this.i18n.t('fx.myTokenOwned', { mark: '☐', name: character.playerOwnerName });
        return this.i18n.t('fx.myToken', { mark: '☐' });
      },
      checkBox: 'check',
      disabled: GuestSession.isGuest || (takenByOther() && !isGM()),
    };
  }

  makeCombatMenu(character: GameCharacter): ContextMenuAction {
    const selectedCount = () =>
      this.selectionService.objects.filter(o => o instanceof GameCharacter).length;
    return {
      name: this.i18n.t('fx.addToCombat'),
      action: () => {
        if (GuestSession.isGuest) return;
        const chars = this.combatCharactersFor(character);
        CombatTracker.instance.addCombatants(chars.map(obj => ({
          characterIdentifier: obj.identifier,
          name: obj.name || this.i18n.t('fx.unnamed'),
          isNpc: !obj.hasPlayerController,
          isDefeated: false,
          isHidden: false,
          imageIdentifier: obj.imageFile?.identifier || '',
        })));
      },
      nameUpdate: () => {
        const n = selectedCount();
        return n > 1 ? this.i18n.t('fx.addToCombatCount', { count: n }) : this.i18n.t('fx.addToCombat');
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
      this.i18n.t('fx.visionLighting', {
        vision: character.visionRangeGrid,
        bright: character.brightLightGrid,
        dim: character.dimLightGrid,
      });

    const rangeSub = (
      label: string,
      presets: number[],
      getter: () => number,
      setter: (n: number) => void,
    ): ContextMenuAction => ({
      name: this.i18n.t('fx.rangeLabel', { label, value: getter() }),
      action: null,
      nameUpdate: () => this.i18n.t('fx.rangeLabel', { label, value: getter() }),
      subActions: presets.map(n => ({
        name: this.i18n.t('fx.rangeOption', { mark: getter() === n ? '◉' : '○', value: n }),
        action: () => {
          setter(n);
          EventSystem.trigger('UPDATE_INVENTORY', null);
        },
        nameUpdate: () => this.i18n.t('fx.rangeOption', { mark: getter() === n ? '◉' : '○', value: n }),
        checkBox: 'radio' as const,
      })),
    });

    return {
      name: title(),
      action: null,
      nameUpdate: title,
      subActions: [
        {
          name: this.i18n.t('fx.myVision', { mark: isMyVision ? '☑' : '☐' }),
          action: () => {
            if (!mine) return;
            character.visionOwner = character.visionOwner === mine ? '' : mine;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          nameUpdate: () => {
            const on = !!mine && character.visionOwner === mine;
            return this.i18n.t('fx.myVision', { mark: on ? '☑' : '☐' });
          },
          checkBox: 'check',
          disabled: GuestSession.isGuest,
        },
        ContextMenuSeparator,
        rangeSub(this.i18n.t('fx.visionRange'), VISION_RANGE_PRESETS,
          () => character.visionRangeGrid,
          n => { character.visionRange = n; }),
        rangeSub(this.i18n.t('fx.brightLight'), BRIGHT_LIGHT_PRESETS,
          () => character.brightLightGrid,
          n => {
            character.brightLight = n;
            if (character.dimLightGrid < n) character.dimLight = n;
          }),
        rangeSub(this.i18n.t('fx.dimLight'), DIM_LIGHT_PRESETS,
          () => character.dimLightGrid,
          n => { character.dimLight = n; }),
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.clearLight'),
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
      name: this.i18n.t('fx.imageEffects'),
      action: null,
      subActions: [
        {
          name: this.i18n.t(getters.isInverse ? 'fx.inverseOn' : 'fx.inverseOff'),
          action: () => { getters.setInverse(!getters.isInverse); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        {
          name: this.i18n.t(getters.isHollow ? 'fx.blurOn' : 'fx.blurOff'),
          action: () => { getters.setHollow(!getters.isHollow); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        {
          name: this.i18n.t(getters.isBlackPaint ? 'fx.silhouetteOn' : 'fx.silhouetteOff'),
          action: () => { getters.setBlackPaint(!getters.isBlackPaint); EventSystem.trigger('UPDATE_INVENTORY', null); },
          checkBox: 'check'
        },
        ContextMenuSeparator,
        {
          name: this.i18n.t('fx.resetImageEffects'),
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
