import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { ObjectNode } from '../core/synchronize-object/object-node';
import { translate } from 'i18n';

export interface TablePoint {
  x: number;
  y: number;
}

@SyncObject('table-wall')
export class TableWall extends ObjectNode {
  @SyncVar() pointsJson: string = '[]';
  @SyncVar() blocksLight: boolean = true;
  @SyncVar() blocksVision: boolean = true;
  @SyncVar() color: string = '#ffcc00';
  @SyncVar() name: string = translate('scene.wallDefault');

  get points(): TablePoint[] {
    try {
      const pts = JSON.parse(this.pointsJson || '[]');
      return Array.isArray(pts) ? pts : [];
    } catch {
      return [];
    }
  }
  set points(value: TablePoint[]) {
    this.pointsJson = JSON.stringify(value || []);
  }

  static create(points: TablePoint[]): TableWall {
    const wall = new TableWall();
    wall.initialize();
    wall.points = points;
    wall.name = translate('scene.wallDefault');
    return wall;
  }
}
