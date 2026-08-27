import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { CutInList } from '@udonarium/cut-in-list';
import { GuestSession } from '@udonarium/guest-session';
import { WeatherType } from '@udonarium/game-table';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TableTimer, TableTimerCountMode, TableTimerOnZeroAction } from '@udonarium/table-fx/table-timer';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { WEATHER_LABEL_KEY } from 'component/game-table/weather-render';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { TimerService } from 'service/timer.service';

type OnZeroDraft = {
  type: TableTimerOnZeroAction['type'];
  preset?: string;
  audioIdentifier?: string;
  message?: string;
  tabIdentifier?: string;
  tag?: string;
  cutInIdentifier?: string;
  presetIdentifier?: string;
  weatherType?: WeatherType;
};

@Component({
  selector: 'table-timer-panel',
  templateUrl: './table-timer-panel.component.html',
  styleUrls: ['../shared/settings-ui.css', './table-timer-panel.component.css'],
  standalone: false,
})
export class TableTimerPanelComponent implements OnInit, OnDestroy {
  private static openCount = 0;
  static get isOpen(): boolean { return TableTimerPanelComponent.openCount > 0; }

  selectedId = '';
  draftMinutes = 5;
  draftSeconds = 0;
  draftLabel = '';
  draftCountMode: TableTimerCountMode = 'countdown';
  draftFlashSeconds = 3;
  onZeroDrafts: OnZeroDraft[] = [];

  readonly countModes: TableTimerCountMode[] = ['countdown', 'countup'];
  readonly durationPresets = [
    { minutes: 1, seconds: 0 },
    { minutes: 3, seconds: 0 },
    { minutes: 5, seconds: 0 },
    { minutes: 10, seconds: 0 },
  ];
  readonly actionTypes: TableTimerOnZeroAction['type'][] = ['sound', 'chat', 'cutin', 'scenePreset', 'weather', 'announce'];
  readonly weatherTypes: WeatherType[] = ['none', 'rain', 'snow', 'fog', 'sandstorm', 'wind', 'thunderstorm', 'rainbow', 'aurora', 'burning', 'sakura', 'maple'];
  readonly soundPresets = ['surprise', 'selection', 'dice', 'ping', 'lock'];

  constructor(
    public timerService: TimerService,
    private panelService: PanelService,
    private i18n: I18nService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get isGuest(): boolean { return GuestSession.isGuest; }
  get canManageSelected(): boolean { return this.timerService.canManageTimer(this.selected); }
  get timers(): TableTimer[] { return this.timerService.timers; }
  get selected(): TableTimer | null {
    return this.timers.find(t => t.identifier === this.selectedId) || null;
  }
  get cutIns() { return CutInList.instance.cutIns; }
  get scenePresets() { return ScenePresetList.instance.presets; }
  get chatTabs() { return ChatTabList.instance.chatTabs; }

  ngOnInit() {
    TableTimerPanelComponent.openCount += 1;
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.timerService.list.identifier}`, () => {
        this.reconcileSelection();
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const id = event.data?.identifier as string | undefined;
        if (id && id === this.selectedId) {
          this.syncDraftFromSelected();
        }
        this.changeDetector.markForCheck();
      })
      .on('TABLE_TIMER_TICK', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
    if (this.timers.length && !this.selectedId) {
      this.selectTimer(this.timers[0].identifier);
    }
  }

  ngOnDestroy() {
    TableTimerPanelComponent.openCount = Math.max(0, TableTimerPanelComponent.openCount - 1);
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('timer.panelTitle');
  }

  selectTimer(id: string) {
    this.selectedId = id;
    // Expanding in the panel restores a personally-hidden canvas widget.
    if (this.timerService.getLocalViewMode(id) === 'hidden') {
      this.timerService.setLocalViewMode(id, 'full');
    }
    this.syncDraftFromSelected();
  }

  private reconcileSelection() {
    if (this.selectedId && !this.timers.some(t => t.identifier === this.selectedId)) {
      this.selectedId = this.timers[0]?.identifier || '';
    }
    if (this.selectedId) {
      this.syncDraftFromSelected();
    } else {
      this.onZeroDrafts = [];
    }
  }

  private syncDraftFromSelected() {
    const timer = this.selected;
    if (!timer) {
      this.onZeroDrafts = [];
      return;
    }
    this.draftLabel = timer.label || '';
    this.draftCountMode = timer.countMode || 'countdown';
    this.draftFlashSeconds = timer.flashSeconds;
    const totalSec = Math.max(0, Math.round(timer.totalMs / 1000));
    this.draftMinutes = Math.floor(totalSec / 60);
    this.draftSeconds = totalSec % 60;
    this.onZeroDrafts = timer.onZeroActions.map(a => ({ ...a }));
  }

  toggleTimer(id: string) {
    if (this.selectedId === id) {
      this.selectedId = '';
      this.onZeroDrafts = [];
      return;
    }
    this.selectTimer(id);
  }

  timerDisplayLabel(timer: TableTimer): string {
    return this.timerService.timerDisplayLabel(timer);
  }

  createTimer() {
    if (this.isGuest) return;
    const timer = this.timerService.createTimer('', 5 * 60 * 1000);
    if (timer) this.selectTimer(timer.identifier);
  }

  applyDurationPreset(minutes: number, seconds: number) {
    if (this.isGuest || !this.selected) return;
    this.draftMinutes = minutes;
    this.draftSeconds = seconds;
    this.applySelected();
  }

  deleteSelected() {
    if (!this.canManageSelected || !this.selectedId) return;
    const id = this.selectedId;
    this.timerService.deleteTimer(id);
    this.selectedId = this.timers[0]?.identifier || '';
    if (this.selectedId) this.selectTimer(this.selectedId);
    else this.onZeroDrafts = [];
  }

  showOnRoomCanvas() {
    if (!this.canManageSelected || !this.selected) return;
    this.timerService.showOnRoomCanvas(this.selected.identifier);
  }

  showOnMyCanvas() {
    if (!this.selected) return;
    this.timerService.showOnMyCanvas(this.selected.identifier, 'full');
  }

  applySelected() {
    if (!this.canManageSelected || !this.selected) return;
    const totalMs = this.durationToMs(this.draftMinutes, this.draftSeconds);
    this.timerService.updateTimer(this.selected.identifier, {
      label: this.draftLabel.trim(),
      countMode: this.draftCountMode,
      totalMs: totalMs > 0 ? totalMs : this.selected.totalMs,
      flashSeconds: this.draftFlashSeconds,
      onZeroActionsJson: JSON.stringify(this.serializeOnZeroDrafts()),
    });
  }

  startSelected() {
    if (!this.selected) return;
    this.timerService.start(this.selected.identifier);
  }

  pauseSelected() {
    if (!this.selected) return;
    this.timerService.pause(this.selected.identifier);
  }

  stopSelected() {
    if (!this.selected) return;
    this.timerService.stop(this.selected.identifier);
  }

  addOnZeroAction(type: TableTimerOnZeroAction['type'] = 'chat') {
    const draft: OnZeroDraft = { type };
    if (type === 'chat' || type === 'announce') draft.message = '';
    if (type === 'chat') draft.tag = 'system';
    if (type === 'sound') draft.preset = 'surprise';
    if (type === 'weather') draft.weatherType = 'none';
    this.onZeroDrafts.push(draft);
  }

  removeOnZeroAction(index: number) {
    this.onZeroDrafts.splice(index, 1);
  }

  weatherLabel(weather: WeatherType): string {
    return this.i18n.t(WEATHER_LABEL_KEY[weather] || 'table.none');
  }

  countModeLabel(mode: TableTimerCountMode): string {
    return this.i18n.t(`timer.countMode.${mode}`);
  }

  actionTypeLabel(type: TableTimerOnZeroAction['type']): string {
    return this.i18n.t(`timer.action.${type}`);
  }

  stateLabel(timer: TableTimer): string {
    return this.i18n.t(`timer.state.${timer.state}`);
  }

  remainingLabel(timer: TableTimer): string {
    return this.timerService.formatRemaining(timer);
  }

  private durationToMs(minutes: number, seconds: number): number {
    const m = Math.max(0, Math.floor(minutes || 0));
    const s = Math.min(59, Math.max(0, Math.floor(seconds || 0)));
    return (m * 60 + s) * 1000;
  }

  private serializeOnZeroDrafts(): TableTimerOnZeroAction[] {
    const out: TableTimerOnZeroAction[] = [];
    for (const d of this.onZeroDrafts) {
      switch (d.type) {
        case 'sound':
          out.push({ type: 'sound', preset: d.preset || 'surprise', audioIdentifier: d.audioIdentifier || '' });
          break;
        case 'chat':
          out.push({
            type: 'chat',
            message: d.message || '',
            tabIdentifier: d.tabIdentifier || '',
            tag: (d.tag || '').trim(),
          });
          break;
        case 'cutin':
          out.push({ type: 'cutin', cutInIdentifier: d.cutInIdentifier || '' });
          break;
        case 'scenePreset':
          out.push({ type: 'scenePreset', presetIdentifier: d.presetIdentifier || '' });
          break;
        case 'weather':
          out.push({ type: 'weather', weatherType: d.weatherType || 'none' });
          break;
        case 'announce':
          out.push({ type: 'announce', message: d.message || '' });
          break;
      }
    }
    return out;
  }
}
