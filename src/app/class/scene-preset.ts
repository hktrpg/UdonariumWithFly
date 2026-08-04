import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameTable } from './game-table';
import { translate } from 'i18n';

@SyncObject('scene-preset')
export class ScenePreset extends ObjectNode {
  @SyncVar() title: string = '';
  @SyncVar() switchText: string = '';
  @SyncVar() tableIdentifier: string = '';
  @SyncVar() tracksJson: string = '';

  get table(): GameTable {
    return this.tableIdentifier
      ? ObjectStore.instance.get<GameTable>(this.tableIdentifier)
      : null;
  }

  get isValid(): boolean {
    return !!this.table;
  }

  get tableDisplayName(): string {
    const table = this.table;
    if (table) return table.name;
    return translate('scenePreset.tableDeleted');
  }
}
