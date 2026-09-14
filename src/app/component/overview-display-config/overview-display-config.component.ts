import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { EventSystem, Network } from '@udonarium/core/system';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import {
  isOverviewTagNewline,
  OVERVIEW_TAG_NEWLINE,
  parseDataTags,
  serializeDataTags
} from '@udonarium/overview-data-tag.util';
import { translate } from 'i18n';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { I18nService } from 'service/i18n.service';
import { OverviewDisplayConfigMode, OverviewDisplayConfigService } from 'service/overview-display-config.service';

type ScopeMode = 'global' | 'character';
type DragSource = 'pool' | 'selected';

@Component({
  selector: 'overview-display-config',
  templateUrl: './overview-display-config.component.html',
  styleUrls: ['../shared/settings-ui.css', './overview-display-config.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class OverviewDisplayConfigComponent implements OnInit, OnChanges, OnDestroy {
  @Input() mode: OverviewDisplayConfigMode = 'inventory';
  @Input() character: GameCharacter | null = null;

  scopeMode: ScopeMode = 'global';
  selectedTags: string[] = [];
  previewCharacter: GameCharacter | null = null;
  dropIndex: number | null = null;

  private dragSource: DragSource | null = null;
  private dragFromIndex: number | null = null;
  private dragTag: string | null = null;
  private suppressClick = false;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private configService: OverviewDisplayConfigService,
    private inventoryService: GameObjectInventoryService,
    private i18n: I18nService
  ) { }

  ngOnInit() {
    this.initializeState();
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.changeDetector.markForCheck())
      .on('UPDATE_INVENTORY', () => this.changeDetector.markForCheck());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['mode'] || changes['character']) {
      this.initializeState();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.configService.handlePanelClosed(
      OverviewDisplayConfigService.tourId({ mode: this.mode, character: this.character })
    );
  }

  GuestMode(): boolean { return Network.GuestMode(); }

  isNewlineTag(tag: string): boolean { return isOverviewTagNewline(tag); }

  get canEditCharacterScope(): boolean {
    return this.mode === 'character' && !!this.character;
  }

  get previewCharacters(): GameCharacter[] {
    const objects = this.inventoryService.allInventory.tabletopObjects;
    return objects.filter((obj): obj is GameCharacter => obj instanceof GameCharacter);
  }

  get availableFields(): DataElement[] {
    const source = this.previewCharacter ?? this.character;
    if (!source) return [];
    const selected = new Set(
      this.selectedTags.filter(tag => !isOverviewTagNewline(tag))
    );
    return this.inventoryService.collectDisplayableFields(source)
      .filter(field => !selected.has(field.name));
  }

  get allFieldsSelected(): boolean {
    const source = this.previewCharacter ?? this.character;
    if (!source) return false;
    const all = this.inventoryService.collectDisplayableFields(source);
    return 0 < all.length && this.availableFields.length < 1;
  }

  get newLineDataElement(): DataElement { return this.inventoryService.newLineDataElement; }

  setScopeMode(scope: ScopeMode) {
    if (this.GuestMode()) return;
    if (scope === 'character' && !this.canEditCharacterScope) return;
    this.scopeMode = scope;
    if (scope === 'character' && this.character) {
      this.character.useCustomOverviewDataTag = true;
      if ((this.character.overviewDataTag || '').trim().length) {
        this.selectedTags = [...this.character.overviewDataTags];
      } else {
        this.selectedTags = [...this.inventoryService.dataTags];
        this.character.overviewDataTag = serializeDataTags(this.selectedTags);
      }
    } else if (this.character && this.mode === 'character') {
      this.character.useCustomOverviewDataTag = false;
      this.loadSelectedTags();
    } else {
      this.loadSelectedTags();
    }
    this.changeDetector.markForCheck();
  }

  onPreviewCharacterChange(identifier: string) {
    this.previewCharacter = this.previewCharacters.find(ch => ch.identifier === identifier) ?? null;
    this.changeDetector.markForCheck();
  }

  fieldTypeLabel(field: DataElement): string {
    switch (field.type) {
      case 'numberResource': return this.i18n.t('sheet.data.type.resource');
      case 'abilityScore': return this.i18n.t('sheet.data.type.ability');
      case 'checkProperty': return this.i18n.t('sheet.data.type.check');
      case 'simpleNumber': return this.i18n.t('sheet.data.type.number');
      case 'note': return this.i18n.t('sheet.data.type.note');
      case 'url': return this.i18n.t('sheet.data.type.url');
      default: return this.i18n.t('sheet.data.type.normal');
    }
  }

  tagChipLabel(tag: string): string {
    return isOverviewTagNewline(tag) ? this.i18n.t('overviewConfig.lineBreak') : tag;
  }

  resolveTagElement(tag: string): DataElement | null {
    if (isOverviewTagNewline(tag)) return null;
    const source = this.previewCharacter ?? this.character;
    if (!source?.detailDataElement) return null;
    return source.detailDataElement.getFirstElementByNameUnsensitive(tag);
  }

  tagIsMissing(tag: string): boolean {
    return !isOverviewTagNewline(tag) && !this.resolveTagElement(tag);
  }

  addSeparator() {
    this.addTag(OVERVIEW_TAG_NEWLINE);
  }

  addField(field: DataElement) {
    if (this.suppressClick) return;
    this.addTag(field.name);
  }

  addTag(tag: string) {
    if (this.GuestMode()) return;
    if (!isOverviewTagNewline(tag) && this.selectedTags.includes(tag)) return;
    this.selectedTags = [...this.selectedTags, tag];
    this.persistSelectedTags();
  }

  removeTag(index: number) {
    if (this.GuestMode()) return;
    this.selectedTags = this.selectedTags.filter((_, i) => i !== index);
    this.persistSelectedTags();
  }

  resetDefault() {
    if (this.GuestMode()) return;
    this.selectedTags = parseDataTags(translate('summary.dataTag'));
    this.persistSelectedTags();
  }

  onPoolDragStart(event: DragEvent, tag: string) {
    if (this.GuestMode()) {
      event.preventDefault();
      return;
    }
    this.dragSource = 'pool';
    this.dragFromIndex = null;
    this.dragTag = tag;
    event.dataTransfer!.setData('text/plain', tag);
    event.dataTransfer!.effectAllowed = 'copy';
  }

  onSelectedDragStart(event: DragEvent, index: number) {
    if (this.GuestMode()) {
      event.preventDefault();
      return;
    }
    this.dragSource = 'selected';
    this.dragFromIndex = index;
    this.dragTag = this.selectedTags[index];
    event.dataTransfer!.setData('text/plain', this.dragTag);
    event.dataTransfer!.effectAllowed = 'move';
  }

  onSelectedListDragOver(event: DragEvent) {
    if (this.GuestMode() || !this.dragTag) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = this.dragSource === 'selected' ? 'move' : 'copy';
    const list = event.currentTarget as HTMLElement;
    const index = this.resolveDropIndex(list, event.clientY);
    if (this.dropIndex === index) return;
    this.dropIndex = index;
    this.changeDetector.markForCheck();
  }

  onSelectedListDragLeave(event: DragEvent) {
    const list = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (related && list.contains(related)) return;
    if (this.dropIndex === null) return;
    this.dropIndex = null;
    this.changeDetector.markForCheck();
  }

  onSelectedListDrop(event: DragEvent) {
    if (this.GuestMode()) return;
    event.preventDefault();
    const list = event.currentTarget as HTMLElement;
    const index = this.dropIndex ?? this.resolveDropIndex(list, event.clientY);
    this.applyDrop(index);
  }

  onDragEnd() {
    this.suppressClick = true;
    setTimeout(() => { this.suppressClick = false; }, 0);
    this.clearDrag();
    this.changeDetector.markForCheck();
  }

  private initializeState() {
    this.previewCharacter = this.character ?? this.previewCharacters[0] ?? null;
    this.scopeMode = this.character?.useCustomOverviewDataTag ? 'character' : 'global';
    this.loadSelectedTags();
    this.changeDetector.markForCheck();
  }

  private resolveDropIndex(list: HTMLElement, clientY: number): number {
    const chips = list.querySelectorAll('.selected-row');
    if (!chips.length) return 0;
    for (let i = 0; i < chips.length; i++) {
      const rect = chips[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return chips.length;
  }

  private applyDrop(index: number) {
    const tag = this.dragTag;
    if (!tag) return;
    const next = [...this.selectedTags];
    if (this.dragSource === 'selected' && this.dragFromIndex != null) {
      const from = this.dragFromIndex;
      if (from === index || from + 1 === index) {
        this.clearDrag();
        return;
      }
      const [moved] = next.splice(from, 1);
      let insertAt = index;
      if (from < insertAt) insertAt -= 1;
      next.splice(insertAt, 0, moved);
    } else if (isOverviewTagNewline(tag) || !next.includes(tag)) {
      next.splice(Math.max(0, Math.min(index, next.length)), 0, tag);
    }
    this.selectedTags = next;
    this.clearDrag();
    this.persistSelectedTags();
  }

  private clearDrag() {
    this.dropIndex = null;
    this.dragSource = null;
    this.dragFromIndex = null;
    this.dragTag = null;
  }

  private loadSelectedTags() {
    if (this.scopeMode === 'character' && this.character) {
      if (this.character.useCustomOverviewDataTag && 0 < (this.character.overviewDataTag || '').trim().length) {
        this.selectedTags = [...this.character.overviewDataTags];
      } else {
        this.selectedTags = [...this.inventoryService.dataTags];
      }
      return;
    }
    this.selectedTags = [...this.inventoryService.dataTags];
  }

  private persistSelectedTags() {
    const serialized = serializeDataTags(this.selectedTags);
    if (this.scopeMode === 'character' && this.character) {
      this.character.useCustomOverviewDataTag = true;
      this.character.overviewDataTag = serialized;
    } else {
      this.inventoryService.dataTag = serialized;
    }
    this.changeDetector.markForCheck();
  }
}
