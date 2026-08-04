import { SyncObject } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { Jukebox } from './Jukebox';
import { PeerCursor } from './peer-cursor';
import { TableSelecter } from './table-selecter';
import { ChatTab } from './chat-tab';
import { ChatTabList } from './chat-tab-list';
import { ScenePreset } from './scene-preset';
import { StringUtil } from './core/system/util/string-util';
import { translate } from 'i18n';

export interface ScenePresetApplyOptions {
  skipBgm?: boolean;
  skipText?: boolean;
  chatTab?: ChatTab;
}

@SyncObject('scene-preset-list')
export class ScenePresetList extends ObjectNode implements InnerXml {
  private static _instance: ScenePresetList;
  static get instance(): ScenePresetList {
    if (!ScenePresetList._instance) {
      ScenePresetList._instance = new ScenePresetList('ScenePresetList');
      ScenePresetList._instance.initialize();
    }
    return ScenePresetList._instance;
  }

  get presets(): ScenePreset[] { return this.children as ScenePreset[]; }

  addPreset(preset: ScenePreset): ScenePreset
  addPreset(title?: string): ScenePreset
  addPreset(...args: any[]): ScenePreset {
    let preset: ScenePreset = null;
    if (args[0] instanceof ScenePreset) {
      preset = args[0];
    } else {
      preset = new ScenePreset();
      preset.title = (typeof args[0] === 'string' && args[0]) ? args[0] : translate('scenePreset.defaultTitle');
      preset.initialize();
    }
    return this.appendChild(preset);
  }

  createFromCurrent(title?: string): ScenePreset {
    const preset = this.addPreset(title);
    this.writeSnapshot(preset);
    return preset;
  }

  writeSnapshot(preset: ScenePreset) {
    const table = TableSelecter.instance.viewTable;
    const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
    preset.tableIdentifier = table ? table.identifier : '';
    preset.tracksJson = jukebox ? jukebox.snapshotTracksJson() : '';
  }

  applyPreset(preset: ScenePreset, options: ScenePresetApplyOptions = {}): boolean {
    if (!preset || Network.GuestMode()) return false;
    if (!preset.isValid) return false;

    EventSystem.call('SELECT_GAME_TABLE', { identifier: preset.tableIdentifier }, Network.peerId);

    if (!options.skipBgm) {
      const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
      if (jukebox) jukebox.applyTracksSnapshot(preset.tracksJson || '');
    }

    if (!options.skipText && preset.switchText && preset.switchText.trim()) {
      const tab = options.chatTab || ChatTabList.instance.chatTabs[0];
      if (tab) {
        const name = PeerCursor.myCursor?.name || translate('chat.unnamedPlayer');
        tab.addMessage({
          from: Network.peer.userId,
          name: name,
          imageIdentifier: PeerCursor.myCursor?.imageIdentifier || '',
          timestamp: Date.now(),
          tag: 'system',
          text: StringUtil.cr(preset.switchText),
          color: PeerCursor.myCursor?.color || '',
        });
      }
    }
    return true;
  }

  parseInnerXml(element: Element) {
    for (let child of ScenePresetList.instance.children) {
      child.destroy();
    }
    let context = ScenePresetList.instance.toContext();
    context.syncData = this.toContext().syncData;
    ScenePresetList.instance.apply(context);
    ScenePresetList.instance.update();
    super.parseInnerXml.apply(ScenePresetList.instance, [element]);
    this.destroy();
  }
}
