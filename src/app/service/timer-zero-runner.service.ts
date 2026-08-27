import { Injectable } from '@angular/core';

import { ChatTabList } from '@udonarium/chat-tab-list';
import { CutInList } from '@udonarium/cut-in-list';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { WeatherType } from '@udonarium/game-table';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TableTimer, TableTimerOnZeroAction, TIMER_OPERATION_LOG_TAB } from '@udonarium/table-fx/table-timer';
import { EventSystem, Network } from '@udonarium/core/system';
import { translate } from 'i18n';

import { ChatMessageService } from './chat-message.service';
import { CutInService } from './cut-in.service';

@Injectable({ providedIn: 'root' })
export class TimerZeroRunnerService {
  constructor(
    private cutInService: CutInService,
    private chatMessageService: ChatMessageService,
  ) {}

  run(timer: TableTimer) {
    const actions = timer.onZeroActions;
    if (!actions.length) return;
    for (const action of actions) {
      try {
        this.runAction(action, timer);
      } catch (e) {
        console.warn('[TimerZeroRunner] action failed', action, e);
      }
    }
  }

  private runAction(action: TableTimerOnZeroAction, timer: TableTimer) {
    switch (action.type) {
      case 'sound':
        this.runSound(action);
        break;
      case 'chat':
        this.runChat(action, timer);
        break;
      case 'cutin':
        this.runCutIn(action);
        break;
      case 'scenePreset':
        this.runScenePreset(action);
        break;
      case 'weather':
        this.runWeather(action);
        break;
      case 'announce':
        this.runAnnounce(action, timer);
        break;
      default:
        break;
    }
  }

  private runSound(action: Extract<TableTimerOnZeroAction, { type: 'sound' }>) {
    if (action.audioIdentifier) {
      const audio = AudioStorage.instance.get(action.audioIdentifier);
      if (audio) {
        SoundEffect.playLocal(audio);
        return;
      }
    }
    const preset = action.preset || 'surprise';
    const map: Record<string, string> = {
      surprise: PresetSound.surprise,
      selection: PresetSound.selectionStart,
      dice: PresetSound.diceRoll1,
      ping: PresetSound.ping,
      lock: PresetSound.lock,
    };
    const identifier = map[preset] || PresetSound.surprise;
    if (identifier) SoundEffect.playLocal(identifier);
  }

  private runChat(action: Extract<TableTimerOnZeroAction, { type: 'chat' }>, timer: TableTimer) {
    const text = (action.message || '').trim();
    if (action.tabIdentifier === TIMER_OPERATION_LOG_TAB) {
      const n = timer.sequenceNumber > 0 ? timer.sequenceNumber : 1;
      const label = (timer.label || '').trim() || translate('timer.defaultLabel', { n });
      this.chatMessageService.sendOperationLog(text || translate('timer.op.finished', { label }));
      return;
    }
    if (!text) return;
    const tabs = ChatTabList.instance.chatTabs;
    const tab = (action.tabIdentifier
      ? tabs.find(t => t.identifier === action.tabIdentifier)
      : null) || tabs[0];
    if (!tab) return;
    const name = PeerCursor.myCursor?.name || '';
    tab.addMessage({
      from: Network.peer.userId,
      name,
      imageIdentifier: PeerCursor.myCursor?.imageIdentifier || '',
      timestamp: Date.now(),
      tag: (action.tag || 'system').trim() || 'system',
      text: StringUtil.cr(text),
      color: PeerCursor.myCursor?.color || '',
    });
  }

  private runCutIn(action: Extract<TableTimerOnZeroAction, { type: 'cutin' }>) {
    const id = (action.cutInIdentifier || '').trim();
    if (!id) return;
    const cutIn = CutInList.instance.cutIns.find(c => c.identifier === id);
    if (cutIn) this.cutInService.play(cutIn);
  }

  private runScenePreset(action: Extract<TableTimerOnZeroAction, { type: 'scenePreset' }>) {
    const id = (action.presetIdentifier || '').trim();
    if (!id) return;
    const preset = ScenePresetList.instance.presets.find(p => p.identifier === id);
    if (preset) ScenePresetList.instance.applyPreset(preset);
  }

  private runWeather(action: Extract<TableTimerOnZeroAction, { type: 'weather' }>) {
    const table = TableSelecter.instance.viewTable;
    if (!table || Network.GuestMode()) return;
    const type = (action.weatherType || 'none') as WeatherType;
    table.weatherType = type;
  }

  private runAnnounce(action: Extract<TableTimerOnZeroAction, { type: 'announce' }>, timer: TableTimer) {
    const message = (action.message || timer.label || '').trim();
    if (!message) return;
    EventSystem.call('TABLE_TIMER_ANNOUNCE', { message, label: timer.label || '' });
  }
}
