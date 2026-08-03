import { Component, OnDestroy, OnInit } from '@angular/core';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { Network } from '@udonarium/core/system';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { PeerCursor } from '@udonarium/peer-cursor';
import { CombatTracker, CombatantData, EncounterData, InitiativeDice } from '@udonarium/table-fx/combat-tracker';
import { EventSystem } from '@udonarium/core/system';
import { ChatMessageService } from 'service/chat-message.service';
import { PanelService } from 'service/panel.service';
import { TabletopSelectionService } from 'service/tabletop-selection.service';

@Component({
  selector: 'combat-tracker',
  templateUrl: './combat-tracker.component.html',
  styleUrls: ['./combat-tracker.component.css'],
  standalone: false
})
export class CombatTrackerComponent implements OnInit, OnDestroy {
  constructor(
    private panelService: PanelService,
    private selectionService: TabletopSelectionService,
    private chatMessageService: ChatMessageService,
  ) {}

  get tracker(): CombatTracker { return CombatTracker.instance; }
  get encounter(): EncounterData { return this.tracker.activeEncounter; }
  get isGuest(): boolean { return GuestSession.isGuest; }
  get isGM(): boolean { return PeerCursor.myCursor?.isGMMode; }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.panelService.title = '戰鬥輪';
      this.tracker.ensureActiveEncounter('戰鬥 1');
    });
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.tracker.identifier}`, () => { /* refresh via zone */ });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  createEncounter() {
    if (this.isGuest) return;
    const n = this.tracker.encounters.length + 1;
    this.tracker.createEncounter(`戰鬥 ${n}`);
  }

  deleteEncounter() {
    if (this.isGuest) return;
    this.tracker.deleteActiveEncounter();
    if (!this.tracker.encounters.length) this.tracker.createEncounter('戰鬥 1');
  }

  setDice(dice: InitiativeDice) {
    if (this.isGuest || !this.encounter) return;
    if (this.encounter.initiativeDice === dice) return;
    this.tracker.updateActive(e => { e.initiativeDice = dice; });
  }

  setSkipDefeated(value: boolean) {
    if (this.isGuest || !this.encounter) return;
    if (this.encounter.skipDefeated === !!value) return;
    this.tracker.updateActive(e => { e.skipDefeated = !!value; });
  }

  setTrackedResource(name: string) {
    if (this.isGuest || !this.encounter) return;
    const next = name || '';
    if ((this.encounter.trackedResourceName || '') === next) return;
    this.tracker.updateActive(e => { e.trackedResourceName = next; });
  }

  /** Ability / resource field names from combatant tokens. */
  resourceNameOptions(): string[] {
    const names = new Set<string>();
    const e = this.encounter;
    if (!e) return [];
    for (const c of e.combatants) {
      const ch = ObjectStore.instance.get<GameCharacter>(c.characterIdentifier);
      if (!ch?.detailDataElement) continue;
      this.collectResourceNames(ch.detailDataElement, names);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  resourceDisplay(c: CombatantData): string {
    const name = this.encounter?.trackedResourceName;
    if (!name) return '';
    const el = this.findResourceElement(c, name);
    if (!el) return '—';
    if (el.isNumberResource) return `${el.currentValue}/${el.value}`;
    if (el.isAbilityScore) {
      const mod = el.calcAbilityScore();
      return el.currentValue ? `${el.value}(${mod >= 0 ? '+' : ''}${mod})` : String(el.value ?? '—');
    }
    return el.value == null || el.value === '' ? '—' : String(el.value);
  }

  private findResourceElement(c: CombatantData, name: string): DataElement {
    const ch = ObjectStore.instance.get<GameCharacter>(c.characterIdentifier);
    return ch?.detailDataElement?.getFirstElementByName(name) || null;
  }

  private collectResourceNames(root: DataElement, names: Set<string>) {
    for (const child of root.children) {
      if (!(child instanceof DataElement)) continue;
      if (child.children.length) {
        this.collectResourceNames(child, names);
        continue;
      }
      if (!child.name) continue;
      if (child.isNumberResource || child.isAbilityScore || child.isSimpleNumber) {
        names.add(child.name);
      } else if (typeof child.value === 'number') {
        names.add(child.name);
      }
    }
  }

  addSelected() {
    if (this.isGuest) return;
    for (const obj of this.selectionService.objects) {
      if (!(obj instanceof GameCharacter)) continue;
      this.tracker.addCombatant({
        characterIdentifier: obj.identifier,
        name: obj.name || '未命名',
        isNpc: !obj.owner,
        isDefeated: false,
        isHidden: false,
        imageIdentifier: obj.imageFile?.identifier || '',
      });
    }
  }

  remove(c: CombatantData) {
    if (this.isGuest) return;
    this.tracker.removeCombatant(c.id);
  }

  setInitiative(c: CombatantData, value: string | number) {
    if (this.isGuest) return;
    const num = value === '' || value == null ? null : Number(value);
    const next = Number.isFinite(num as number) ? num : null;
    if (c.initiative === next) return;
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target && target.initiative !== next) target.initiative = next;
    });
  }

  trackCombatant(_: number, c: CombatantData): string { return c.id; }
  trackEncounter(_: number, e: EncounterData): string { return e.id; }

  toggleHidden(c: CombatantData) {
    if (!this.isGM) return;
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target) target.isHidden = !target.isHidden;
    });
  }

  toggleDefeated(c: CombatantData) {
    if (this.isGuest) return;
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target) target.isDefeated = !target.isDefeated;
    });
  }

  rollOne(c: CombatantData) {
    if (this.isGuest || !this.encounter) return;
    const roll = this.tracker.rollDie(this.encounter.initiativeDice);
    this.tracker.updateActive(e => {
      const target = e.combatants.find(x => x.id === c.id);
      if (target) target.initiative = roll;
    });
    this.logRoll(c.name, roll);
  }

  rollAll(npcsOnly = false) {
    if (this.isGuest || !this.encounter) return;
    this.tracker.updateActive(e => {
      for (const c of e.combatants) {
        if (c.initiative != null) continue;
        if (npcsOnly && !c.isNpc) continue;
        c.initiative = this.tracker.rollDie(e.initiativeDice);
        this.logRoll(c.name, c.initiative);
      }
    });
  }

  resetInitiative() {
    if (this.isGuest) return;
    this.tracker.updateActive(e => {
      for (const c of e.combatants) c.initiative = null;
    });
  }

  begin() { if (!this.isGuest) this.tracker.beginCombat(); }
  end() { if (!this.isGuest) this.tracker.endCombat(); }
  nextTurn() { if (!this.isGuest) this.tracker.nextTurn(); }
  prevTurn() { if (!this.isGuest) this.tracker.prevTurn(); }
  nextRound() { if (!this.isGuest) this.tracker.nextRound(); }
  prevRound() { if (!this.isGuest) this.tracker.prevRound(); }

  endMyTurn() {
    const cur = this.tracker.currentCombatant();
    if (!cur) return;
    const ch = ObjectStore.instance.get<GameCharacter>(cur.characterIdentifier);
    if (!ch) return;
    if (this.isGM || ch.owner === Network.peer.userId) this.tracker.nextTurn();
  }

  visibleCombatants(): CombatantData[] {
    const e = this.encounter;
    if (!e) return [];
    if (this.isGM) return e.combatants;
    return e.combatants.filter(c => !c.isHidden);
  }

  isCurrent(c: CombatantData): boolean {
    const cur = this.tracker.currentCombatant();
    return !!cur && cur.id === c.id && !!this.encounter?.isStarted;
  }

  private logRoll(name: string, roll: number) {
    const dice = this.encounter?.initiativeDice || 'd20';
    this.chatMessageService.sendOperationLog(`【先攻】${name}：${roll}（${dice}）`);
  }
}
