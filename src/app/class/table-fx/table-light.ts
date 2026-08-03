import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { ObjectNode } from '../core/synchronize-object/object-node';

@SyncObject('table-light')
export class TableLight extends ObjectNode {
  @SyncVar() x: number = 0;
  @SyncVar() y: number = 0;
  @SyncVar() dimRadius: number = 150;
  @SyncVar() brightRadius: number = 75;
  @SyncVar() color: string = '#ffd080';
  @SyncVar() intensity: number = 0.7;
  @SyncVar() enabled: boolean = true;
  @SyncVar() darknessActivationMin: number = 0;
  @SyncVar() darknessActivationMax: number = 1;
  @SyncVar() cookieId: string = 'soft';
  @SyncVar() name: string = '燈光';

  static create(x: number, y: number, radius: number = 150): TableLight {
    const light = new TableLight();
    light.initialize();
    light.x = x;
    light.y = y;
    light.dimRadius = radius;
    light.brightRadius = radius * 0.5;
    return light;
  }

  isActiveAtDarkness(darkness: number): boolean {
    return this.enabled
      && darkness >= this.darknessActivationMin
      && darkness <= this.darknessActivationMax;
  }
}
