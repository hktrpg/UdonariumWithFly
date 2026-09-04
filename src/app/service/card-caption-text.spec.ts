import {
  anchorBesideCard,
  canOpenCardDetail,
  resolveCardCaptionVisualEl,
} from './card-caption-text';
import { Card, CardState } from '@udonarium/card';
import { resetTabletopStore } from '../../testing/tabletop-test.util';

describe('card caption anchor', () => {
  it('resolves the painted card image under a transform-free host', () => {
    const host = document.createElement('card');
    host.style.width = '0px';
    host.style.height = '0px';
    const component = document.createElement('div');
    component.className = 'component';
    Object.assign(component.style, {
      position: 'absolute',
      left: '200px',
      top: '150px',
      width: '100px',
      height: '140px',
    });
    const img = document.createElement('img');
    img.className = 'card-image';
    Object.assign(img.style, { width: '100%', height: '100%', display: 'block' });
    component.appendChild(img);
    host.appendChild(component);
    document.body.appendChild(host);

    expect(resolveCardCaptionVisualEl(host)).toBe(img);

    const anchor = anchorBesideCard(host);
    const r = img.getBoundingClientRect();
    expect(anchor.y).toBeCloseTo(r.top + r.height / 2, 0);
    expect(anchor.x).toBeGreaterThanOrEqual(r.right);
    expect(anchor.flipX).toBeFalse();

    document.body.removeChild(host);
  });

  it('prefers stack-top image for card stacks', () => {
    const host = document.createElement('card-stack');
    const under = document.createElement('img');
    under.className = 'card-image';
    const topWrap = document.createElement('div');
    topWrap.className = 'stack-top';
    const top = document.createElement('img');
    top.className = 'card-image';
    topWrap.appendChild(top);
    host.appendChild(under);
    host.appendChild(topWrap);

    expect(resolveCardCaptionVisualEl(host)).toBe(top);
  });
});

describe('canOpenCardDetail', () => {
  beforeEach(() => resetTabletopStore());

  it('blocks face-down table cards for players', () => {
    const card = Card.create('Secret', '', '');
    card.faceDown();
    expect(card.state).toBe(CardState.BACK);
    expect(canOpenCardDetail(card)).toBeFalse();
  });

  it('allows face-up cards', () => {
    const card = Card.create('Open', '', '');
    expect(canOpenCardDetail(card)).toBeTrue();
  });
});
