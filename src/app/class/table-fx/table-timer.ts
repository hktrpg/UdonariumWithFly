import { SyncObject, SyncVar } from '../core/synchronize-object/decorator';
import { ObjectNode } from '../core/synchronize-object/object-node';
import { InnerXml } from '../core/synchronize-object/object-serializer';
import { UUID } from '../core/system/util/uuid';
import { WeatherType } from '../game-table';

export type TableTimerState = 'stopped' | 'running' | 'paused' | 'finished';
export type TableTimerDisplayMode = 'full' | 'compact' | 'minimal' | 'hidden';
export type TableTimerCountMode = 'countdown' | 'countup';

export type TableTimerOnZeroAction =
  | { type: 'sound'; preset?: string; audioIdentifier?: string }
  | { type: 'chat'; message: string; tabIdentifier?: string; tag?: string }
  | { type: 'cutin'; cutInIdentifier: string }
  | { type: 'scenePreset'; presetIdentifier: string }
  | { type: 'weather'; weatherType: WeatherType }
  | { type: 'announce'; message: string };

/** Sentinel tabIdentifier for onZero chat → operation log (all tabs). */
export const TIMER_OPERATION_LOG_TAB = '__operationLog__';

@SyncObject('table-timer')
export class TableTimer extends ObjectNode {
  @SyncVar() label: string = '';
  /** Monotonic display index for default labels (計時器 1, 2, …). */
  @SyncVar() sequenceNumber: number = 0;
  @SyncVar() countMode: TableTimerCountMode = 'countdown';
  @SyncVar() totalMs: number = 5 * 60 * 1000;
  @SyncVar() remainingMs: number = 5 * 60 * 1000;
  @SyncVar() startedAt: number = 0;
  @SyncVar() state: TableTimerState = 'stopped';
  @SyncVar() displayMode: TableTimerDisplayMode = 'full';
  @SyncVar() posX: number = 50;
  @SyncVar() posY: number = 12;
  @SyncVar() createdBy: string = '';
  @SyncVar() createdByUserId: string = '';
  @SyncVar() flashSeconds: number = 3;
  @SyncVar() onZeroActionsJson: string = '[]';
  @SyncVar() finishedAt: number = 0;
  @SyncVar() finishedByPeerId: string = '';
  @SyncVar() lastTouchedBy: string = '';
  @SyncVar() lastTouchedAt: number = 0;

  get onZeroActions(): TableTimerOnZeroAction[] {
    try {
      const arr = JSON.parse(this.onZeroActionsJson || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  set onZeroActions(value: TableTimerOnZeroAction[]) {
    this.onZeroActionsJson = JSON.stringify(value || []);
  }
}

@SyncObject('table-timer-list')
export class TableTimerList extends ObjectNode implements InnerXml {
  private static _instance: TableTimerList;

  static get instance(): TableTimerList {
    if (!TableTimerList._instance) {
      TableTimerList._instance = new TableTimerList('TableTimerList');
      TableTimerList._instance.initialize();
    }
    return TableTimerList._instance;
  }

  get timers(): TableTimer[] { return this.children as TableTimer[]; }

  addTimer(timer: TableTimer): TableTimer;
  addTimer(label?: string, totalMs?: number): TableTimer;
  addTimer(...args: any[]): TableTimer {
    let timer: TableTimer = null;
    if (args[0] instanceof TableTimer) {
      timer = args[0];
    } else {
      const label: string = args[0];
      const totalMs: number = args[1];
      timer = new TableTimer(UUID.generateUuid());
      timer.label = label || '';
      timer.sequenceNumber = this.nextSequenceNumber();
      if (totalMs > 0) {
        timer.totalMs = totalMs;
        timer.remainingMs = totalMs;
      }
      timer.initialize();
    }
    return this.appendChild(timer);
  }

  removeTimer(identifier: string) {
    const timer = this.timers.find(t => t.identifier === identifier);
    if (timer) timer.destroy();
  }

  private nextSequenceNumber(): number {
    let max = 0;
    for (const timer of this.timers) {
      if (timer.sequenceNumber > max) max = timer.sequenceNumber;
    }
    return max + 1;
  }

  parseInnerXml(element: Element) {
    for (const child of TableTimerList.instance.children) {
      child.destroy();
    }

    const context = TableTimerList.instance.toContext();
    context.syncData = this.toContext().syncData;
    TableTimerList.instance.apply(context);
    TableTimerList.instance.update();

    super.parseInnerXml.apply(TableTimerList.instance, [element]);
    this.destroy();
  }
}
