import {
  isInteractiveControlTarget,
  isOverviewPanelTarget,
  isPointOverOverviewPanel,
  shouldIgnoreTabletopDoubleClick,
} from './tabletop-interact';

describe('tabletop-interact', () => {
  it('treats buttons and pdf-nav as interactive', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="pdf-nav"><button type="button" class="pdf-btn">›</button></div>
      <div class="body">paper</div>
    `;
    const btn = root.querySelector('button');
    const body = root.querySelector('.body');
    expect(isInteractiveControlTarget(btn)).toBeTrue();
    expect(isInteractiveControlTarget(body)).toBeFalse();
  });

  it('treats overview quick panels as interactive', () => {
    const root = document.createElement('div');
    root.className = 'overview-panel-surface';
    root.innerHTML = '<div class="void-area">gap</div>';
    const gap = root.querySelector('.void-area');
    expect(isOverviewPanelTarget(gap)).toBeTrue();
    expect(isInteractiveControlTarget(gap)).toBeTrue();
  });

  it('isPointOverOverviewPanel uses panel bounds even when void areas pass through', () => {
    const panel = document.createElement('div');
    panel.className = 'overview-panel-surface';
    panel.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:80px;';
    document.body.appendChild(panel);
    panel.getBoundingClientRect = () => ({
      left: 10, top: 10, right: 110, bottom: 90, width: 100, height: 80, x: 10, y: 10, toJSON: () => ({}),
    } as DOMRect);
    expect(isPointOverOverviewPanel(50, 50)).toBeTrue();
    expect(isPointOverOverviewPanel(200, 50)).toBeFalse();
    document.body.removeChild(panel);
  });

  it('shouldIgnoreTabletopDoubleClick stops propagation for controls', () => {
    const btn = document.createElement('button');
    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: btn });
    const stop = spyOn(ev, 'stopPropagation').and.callThrough();
    expect(shouldIgnoreTabletopDoubleClick(ev)).toBeTrue();
    expect(stop).toHaveBeenCalled();
  });

  it('shouldIgnoreTabletopDoubleClick stops propagation over overview panel bounds', () => {
    const panel = document.createElement('div');
    panel.className = 'overview-panel-surface';
    document.body.appendChild(panel);
    panel.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const token = document.createElement('div');
    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    Object.defineProperty(ev, 'target', { value: token });
    const stop = spyOn(ev, 'stopPropagation').and.callThrough();
    expect(shouldIgnoreTabletopDoubleClick(ev)).toBeTrue();
    expect(stop).toHaveBeenCalled();
    document.body.removeChild(panel);
  });
});
