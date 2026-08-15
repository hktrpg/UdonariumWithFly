import { collectFootprintWalls, rectToClosedWall } from '../component/game-table/footprint-walls';
import {
  makeMask,
  makeTable,
  makeTextNote,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('miniature pose gaps (pitch / mask rotate)', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('TextNote pitch SyncVar defaults to 0 and accepts awning lean', () => {
    const note = makeTextNote('pitch_note');
    expect(note.pitch).toBe(0);
    note.pitch = -20;
    expect(note.pitch).toBe(-20);
    note.isUpright = true;
    expect(note.isUpright).toBeTrue();
  });

  it('GameTableMask rotate SyncVar is used by footprint walls', () => {
    const table = makeTable('mask_rot_table');
    viewTables('mask_rot_table');
    const mask = makeMask('mask_rot');
    mask.location.name = 'table';
    mask.location.x = 100;
    mask.location.y = 200;
    mask.width = 2;
    mask.height = 1;
    mask.rotate = 45;
    mask.affectsLight = true;
    table.appendChild(mask);

    const walls = collectFootprintWalls(table, [mask], []);
    expect(walls.length).toBe(1);
    const expected = rectToClosedWall(100, 200, 2 * 50, 1 * 50, 45);
    expect(walls[0].points.length).toBe(expected.points.length);
    for (let i = 0; i < expected.points.length; i++) {
      expect(walls[0].points[i].x).toBeCloseTo(expected.points[i].x, 5);
      expect(walls[0].points[i].y).toBeCloseTo(expected.points[i].y, 5);
    }
  });
});
