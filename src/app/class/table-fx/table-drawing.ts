import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { ObjectNode } from '../core/synchronize-object/object-node';
import { Network } from '../core/system';

export type DrawingType = 'rect' | 'ellipse' | 'polygon' | 'freehand' | 'text';

@SyncObject('table-drawing')
export class TableDrawing extends ObjectNode {
  @SyncVar() type: DrawingType = 'rect';
  @SyncVar() geomJson: string = '{}';
  @SyncVar() strokeColor: string = '#e11d48';
  @SyncVar() strokeWidth: number = 3;
  @SyncVar() strokeOpacity: number = 1;
  @SyncVar() fillColor: string = '#e11d48';
  @SyncVar() fillOpacity: number = 0.15;
  @SyncVar() text: string = '';
  @SyncVar() fontSize: number = 18;
  @SyncVar() zindex: number = 0;
  @SyncVar() owner: string = '';
  @SyncVar() isLocked: boolean = false;
  @SyncVar() x: number = 0;
  @SyncVar() y: number = 0;
  @SyncVar() width: number = 100;
  @SyncVar() height: number = 100;
  @SyncVar() rotation: number = 0;

  get geom(): any {
    try {
      return JSON.parse(this.geomJson || '{}');
    } catch {
      return {};
    }
  }
  set geom(value: any) {
    this.geomJson = JSON.stringify(value || {});
  }

  get isMine(): boolean {
    return !!this.owner && Network.peer?.userId === this.owner;
  }

  static create(type: DrawingType, owner: string): TableDrawing {
    const drawing = new TableDrawing();
    drawing.initialize();
    drawing.type = type;
    drawing.owner = owner || '';
    return drawing;
  }
}
