import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { EventSystem } from './core/system';
import { GameTableMask } from './game-table-mask';
import { TableDrawing } from './table-fx/table-drawing';
import { TableLight } from './table-fx/table-light';
import { TableWall } from './table-fx/table-wall';
import { Terrain } from './terrain';

export enum GridType {
  NONE = -1,
  SQUARE = 0,
  HEX_VERTICAL = 1,
  HEX_HORIZONTAL = 2,
}

export enum FilterType {
  NONE = '',
  WHITE = 'white',
  BLACK = 'black',
}

export type WeatherType = 'none' | 'rain' | 'snow' | 'fog';

@SyncObject('game-table')
export class GameTable extends ObjectNode {
  @SyncVar() name: string = '桌面';
  @SyncVar() width: number = 20;
  @SyncVar() height: number = 20;
  @SyncVar() gridSize: number = 50;
  @SyncVar() imageIdentifier: string = 'imageIdentifier';
  @SyncVar() backgroundImageIdentifier: string = 'imageIdentifier';
  @SyncVar() backgroundImageIdentifier2: string = 'imageIdentifier';
  @SyncVar() backgroundFilterType: FilterType = FilterType.NONE;
  @SyncVar() selected: boolean = false;
  @SyncVar() gridType: GridType = GridType.SQUARE;
  @SyncVar() gridColor: string = '#000000e6';
  @SyncVar() isShowNumber: boolean = true;

  @SyncVar() darkness: number = 0;
  @SyncVar() globalIllumination: number = 1;
  @SyncVar() weatherType: WeatherType = 'none';
  @SyncVar() weatherIntensity: number = 0.5;
  @SyncVar() visionEnabled: boolean = false;

  gridHeight: number = 0;
  gridClipRect: {top: number, right: number, bottom: number, left: number} = null;

  get terrains(): Terrain[] {
    let terrains: Terrain[] = [];
    this.children.forEach(object => {
      if (object instanceof Terrain) terrains.push(object);
    });
    return terrains;
  }

  get masks(): GameTableMask[] {
    let masks: GameTableMask[] = [];
    this.children.forEach(object => {
      if (object instanceof GameTableMask) masks.push(object);
    });
    return masks;
  }

  get walls(): TableWall[] {
    return this.children.filter(object => object instanceof TableWall) as TableWall[];
  }

  get lights(): TableLight[] {
    return this.children.filter(object => object instanceof TableLight) as TableLight[];
  }

  get drawings(): TableDrawing[] {
    return this.children.filter(object => object instanceof TableDrawing) as TableDrawing[];
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    if (this.selected) EventSystem.trigger('SELECT_GAME_TABLE', { identifier: this.identifier });
  }
}
