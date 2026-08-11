import { TabletopObject } from './tabletop-object';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('TabletopObject placements / migrate / repair', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('migrateUnboundTablePieces does not rebind objects that already have placements', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_a');
    ch.location = { name: 'table', x: 10, y: 20 };
    ch.posZ = 0;
    ch.addToTable('tableA', { x: 10, y: 20, posZ: 0 }, true);

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();

    TabletopObject.migrateUnboundTablePieces('tableB');

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();
    expect(ch.getPoseForTable('tableA')).toEqual(jasmine.objectContaining({ x: 10, y: 20, posZ: 0 }));
  });

  it('migrateUnboundTablePieces binds truly unbound pieces to the given view', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_unbound');
    ch.location = { name: 'table', x: 5, y: 6 };
    ch.posZ = 1;
    ch.tableIdentifier = '';
    ch.tablePlacements = '';

    TabletopObject.migrateUnboundTablePieces('tableA');

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.tableIdentifier).toBe('tableA');
  });

  it('migrateUnboundTablePieces heals empty primary id from existing placements', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_heal');
    ch.location = { name: 'table', x: 1, y: 2 };
    ch.tablePlacements = JSON.stringify({ tableA: { x: 1, y: 2, posZ: 0 } });
    ch.tableIdentifier = '';

    TabletopObject.migrateUnboundTablePieces('tableA');

    expect(ch.tableIdentifier).toBe('tableA');
    expect(ch.hasPlacement('tableB' as string)).toBeFalse();
  });

  it('addToTable exclusive clears other map poses; non-exclusive keeps them', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_dual');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 100, y: 100, posZ: 0 }, true);
    ch.addToTable('tableB', { x: 200, y: 200, posZ: 0 }, false);

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeTrue();

    ch.addToTable('tableA', { x: 111, y: 111, posZ: 0 }, true);
    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();
    expect(ch.getPoseForTable('tableA')).toEqual(jasmine.objectContaining({ x: 111, y: 111, posZ: 0 }));
  });

  it('repairOrphanedPieceBindings remaps 1:1 when orphan count equals table count', () => {
    const t0 = makeTable('realTable0');
    const t1 = makeTable('realTable1');
    viewTables('realTable0');

    const ch0 = makeCharacter('piece0');
    ch0.location = { name: 'table', x: 1, y: 1 };
    ch0.tableIdentifier = 'orphan0';
    ch0.tablePlacements = JSON.stringify({ orphan0: { x: 1, y: 1, posZ: 0 } });

    const ch1 = makeCharacter('piece1');
    ch1.location = { name: 'table', x: 2, y: 2 };
    ch1.tableIdentifier = 'orphan1';
    ch1.tablePlacements = JSON.stringify({ orphan1: { x: 2, y: 2, posZ: 0 } });

    const remap = TabletopObject.repairOrphanedPieceBindings();
    expect(remap.get('orphan0')).toBe(t0.identifier);
    expect(remap.get('orphan1')).toBe(t1.identifier);
    expect(ch0.hasPlacement('realTable0')).toBeTrue();
    expect(ch1.hasPlacement('realTable1')).toBeTrue();
  });

  it('repairOrphanedPieceBindings collapses mismatched orphans onto view/first table', () => {
    makeTable('onlyTable');
    viewTables('onlyTable');

    const ch = makeCharacter('pieceX');
    ch.location = { name: 'table', x: 9, y: 9 };
    ch.tableIdentifier = 'goneUuid';
    ch.tablePlacements = JSON.stringify({ goneUuid: { x: 9, y: 9, posZ: 0 } });

    TabletopObject.repairOrphanedPieceBindings();
    expect(ch.hasPlacement('onlyTable')).toBeTrue();
    expect(ch.hasPlacement('goneUuid')).toBeFalse();
  });

  it('flushLivePosesToView writes live coords into placements for that view only', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_flush');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);
    ch.hydratePoseForView('tableA');
    ch.location.x = 77;
    ch.location.y = 88;

    TabletopObject.flushLivePosesToView('tableA');

    expect(ch.getPoseForTable('tableA')!.x).toBe(77);
    expect(ch.getPoseForTable('tableA')!.y).toBe(88);
    expect(ch.getPoseForTable('tableA')!.posZ).toBe(0);
    expect(ch.getPoseForTable('tableB')!.x).toBe(50);
    expect(ch.getPoseForTable('tableB')!.y).toBe(50);
  });

  it('keeps height/size/altitude independent per map placement', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_height');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);
    ch.ensureAppearanceBackfilled();

    // Edit height on map A only.
    const heightEl = ch.commonDataElement.getFirstElementByName('height');
    expect(heightEl).toBeTruthy();
    heightEl!.value = 5;
    ch.syncAppearanceToCurrentViewPlacement();

    expect(ch.getPoseForTable('tableA')!.height).toBe(5);
    expect(ch.getPoseForTable('tableB')!.height).toBe(0);

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.height).toBe(0);
    expect(heightEl!.value).toBe(0);

    // Edit height on map B; A stays 5.
    heightEl!.value = 2;
    ch.syncAppearanceToCurrentViewPlacement();
    TabletopObject.flushLivePosesToView('tableB');
    viewTables('tableA');
    ch.hydratePoseForView('tableA');

    expect(ch.height).toBe(5);
    expect(ch.getPoseForTable('tableA')!.height).toBe(5);
    expect(ch.getPoseForTable('tableB')!.height).toBe(2);
  });

  it('keeps rotate/roll and image FX independent per map', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_pose');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);
    ch.ensureAppearanceBackfilled();

    ch.rotate = 90;
    ch.roll = 30;
    ch.isInverse = true;
    ch.currntImageIndex = 0;
    ch.syncAppearanceToCurrentViewPlacement();

    expect(ch.getPoseForTable('tableA')!.rotate).toBe(90);
    expect(ch.getPoseForTable('tableA')!.roll).toBe(30);
    expect(ch.getPoseForTable('tableA')!.isInverse).toBeTrue();
    expect(ch.getPoseForTable('tableB')!.rotate).toBe(0);
    expect(ch.getPoseForTable('tableB')!.roll).toBe(0);
    expect(ch.getPoseForTable('tableB')!.isInverse).toBeFalse();

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.rotate).toBe(0);
    expect(ch.roll).toBe(0);
    expect(ch.isInverse).toBeFalse();

    ch.rotate = 45;
    ch.syncAppearanceToCurrentViewPlacement();
    TabletopObject.flushLivePosesToView('tableB');
    viewTables('tableA');
    ch.hydratePoseForView('tableA');

    expect(ch.rotate).toBe(90);
    expect(ch.roll).toBe(30);
    expect(ch.isInverse).toBeTrue();
    expect(ch.getPoseForTable('tableB')!.rotate).toBe(45);
  });

  it('hydrate resets SyncVar cosmetics when destination pose omits them', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_leak');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    // Simulate legacy B pose with coords only (no rotate / FX / light).
    const map = JSON.parse(ch.tablePlacements);
    map.tableB = { x: 50, y: 50, posZ: 0 };
    ch.tablePlacements = JSON.stringify(map);

    ch.rotate = 90;
    ch.isInverse = true;
    ch.visionRange = 12;
    ch.syncAppearanceToCurrentViewPlacement();

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.rotate).toBe(0);
    expect(ch.isInverse).toBeFalse();
    expect(ch.visionRange).toBe(6);
  });

  it('setPoseForTable merge preserves appearance when only coords change', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_merge');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 2, posZ: 0, height: 7, size: 2, rotate: 15 }, true);

    ch.setPoseForTable('tableA', { x: 9, y: 8, posZ: 1 }, false);

    const pose = ch.getPoseForTable('tableA')!;
    expect(pose.x).toBe(9);
    expect(pose.y).toBe(8);
    expect(pose.posZ).toBe(1);
    expect(pose.height).toBe(7);
    expect(pose.size).toBe(2);
    expect(pose.rotate).toBe(15);
  });
});
