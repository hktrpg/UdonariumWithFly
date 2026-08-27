import { TabletopObject } from '@udonarium/tabletop-object';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';

import { MovableDirective } from './movable.directive';
import { MovableSelectionSynchronizer } from './movable-selection-synchronizer';
import { shouldClearSelectionOnRemotePoseUpdate } from './movable-pose-sync-policy';

function stubObject(id: string): TabletopObject {
  return {
    identifier: id,
    aliasName: 'card',
  } as unknown as TabletopObject;
}

function stubMovable(
  object: TabletopObject,
  selection: TabletopSelectionService,
  opts: { x?: number; y?: number; z?: number } = {},
): MovableDirective {
  let x = opts.x ?? 0;
  let y = opts.y ?? 0;
  let z = opts.z ?? 0;
  const movable: any = {
    tabletopObject: object,
    isDisable: false,
    isDragFollower: false,
    isPointerMoved: true,
    width: 50,
    height: 50,
    nativeElement: { clientWidth: 50, clientHeight: 50 },
    get posX() { return x; },
    set posX(v: number) { x = v; },
    get posY() { return y; },
    set posY(v: number) { y = v; },
    get posZ() { return z; },
    set posZ(v: number) { z = v; },
    get state() { return selection.state(object); },
    set state(s: SelectionState) { selection.add(object, s); },
    setPointerEvents() { /* no-op */ },
    setAnimatedTransition() { /* no-op */ },
    stopTransition() { /* no-op */ },
  };
  return movable as MovableDirective;
}

describe('MovableSelectionSynchronizer', () => {
  it('congregate does not adopt elevated pointer pick Z', () => {
    const object = stubObject('c1');
    const selection = new TabletopSelectionService();
    const movable = stubMovable(object, selection, { x: 0, y: 0, z: 15 });
    MovableSelectionSynchronizer.__testRegister(object, movable);

    MovableSelectionSynchronizer.congregate({ x: 200, y: 200, z: 88 }, [object]);

    expect(movable.posZ).toBe(15);
    expect(movable.posX).not.toBe(0);
    expect(movable.posY).not.toBe(0);
    MovableSelectionSynchronizer.__testUnregister(object);
  });

  it('updateMove keeps dragging followers after mid-drag deselect', () => {
    const selection = new TabletopSelectionService();
    const primaryObj = stubObject('p1');
    const followerObj = stubObject('f1');
    const primary = stubMovable(primaryObj, selection, { x: 0, y: 0, z: 0 });
    const follower = stubMovable(followerObj, selection, { x: 100, y: 0, z: 5 });

    selection.add(primaryObj, SelectionState.SELECTED);
    selection.add(followerObj, SelectionState.SELECTED);
    MovableSelectionSynchronizer.__testRegister(primaryObj, primary);
    MovableSelectionSynchronizer.__testRegister(followerObj, follower);

    const sync = new MovableSelectionSynchronizer(
      primary,
      selection,
      null as unknown as PointerDeviceService,
    );

    sync.prepareMove();
    expect(follower.isDragFollower).toBe(true);

    selection.remove(followerObj);
    expect(selection.state(followerObj)).toBe(SelectionState.NONE);

    sync.updateMove({ x: 40, y: 10, z: 0 });
    expect(follower.posX).toBe(140);
    expect(follower.posY).toBe(10);
    expect(follower.posZ).toBe(5);

    sync.abortMove();
    MovableSelectionSynchronizer.__testUnregister(primaryObj);
    MovableSelectionSynchronizer.__testUnregister(followerObj);
  });
});

describe('movable pose sync policy', () => {
  it('does not clear local selection on remote pose update', () => {
    expect(shouldClearSelectionOnRemotePoseUpdate()).toBe(false);
  });
});
