import { panelMagnetSnapOffset, toPanelMagnetRect } from './panel-magnet-snap.util';

describe('panelMagnetSnapOffset', () => {
  it('snaps moving left edge to another panel right edge', () => {
    const moving = toPanelMagnetRect({ left: 108, top: 40, width: 200, height: 120 });
    const other = toPanelMagnetRect({ left: 0, top: 40, width: 100, height: 120 });
    const snap = panelMagnetSnapOffset(moving, [other], 12);
    expect(snap.x).toBe(-8);
    expect(snap.y).toBe(0);
  });

  it('snaps moving top edge to another panel bottom edge', () => {
    const moving = toPanelMagnetRect({ left: 0, top: 208, width: 200, height: 120 });
    const other = toPanelMagnetRect({ left: 0, top: 40, width: 200, height: 160 });
    const snap = panelMagnetSnapOffset(moving, [other], 12);
    expect(snap.x).toBe(0);
    expect(snap.y).toBe(-8);
  });

  it('ignores panels outside threshold', () => {
    const moving = toPanelMagnetRect({ left: 200, top: 40, width: 100, height: 100 });
    const other = toPanelMagnetRect({ left: 0, top: 40, width: 100, height: 100 });
    const snap = panelMagnetSnapOffset(moving, [other], 8);
    expect(snap.x).toBe(0);
    expect(snap.y).toBe(0);
  });
});
