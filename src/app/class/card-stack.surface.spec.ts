import { CardStack } from './card-stack';
import { Card } from './card';
import { resetTabletopStore } from '../../testing/tabletop-test.util';

describe('CardStack surface / visual height', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  function stackWithN(n: number): CardStack {
    const stack = CardStack.create('deck');
    stack.location.name = 'table';
    stack.location.x = 0;
    stack.location.y = 0;
    stack.posZ = 10;
    for (let i = 0; i < n; i++) {
      const card = Card.create(`c${i}`, '', '', 2);
      stack.putOnBottom(card);
    }
    return stack;
  }

  it('visualHeightPx grows with card count and caps', () => {
    expect(CardStack.visualHeightPx(0)).toBe(0);
    expect(CardStack.visualHeightPx(1)).toBe(0);
    expect(CardStack.visualHeightPx(2)).toBeGreaterThan(0);
    expect(CardStack.visualHeightPx(100)).toBe(24);
  });

  it('surfaceHitAt returns posZ + thickness over the footprint', () => {
    const stack = stackWithN(20);
    const hit = stack.surfaceHitAt(50, 50, 50);
    expect(hit).toBeTruthy();
    expect(hit!.posZ).toBe(10 + stack.visualHeightPx);
  });

  it('surfaceHitAt is null outside the footprint', () => {
    const stack = stackWithN(20);
    expect(stack.surfaceHitAt(500, 500, 50)).toBeNull();
  });

  it('surface height drops when cards are removed', () => {
    const stack = stackWithN(40);
    const before = stack.visualHeightPx;
    expect(before).toBeGreaterThan(0);
    while (stack.cards.length > 1) {
      stack.drawCard();
    }
    expect(stack.visualHeightPx).toBe(0);
    expect(before).toBeGreaterThan(stack.visualHeightPx);
  });
});
