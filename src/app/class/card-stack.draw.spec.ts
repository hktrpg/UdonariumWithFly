import { Card } from './card';
import { CardStack } from './card-stack';
import { ObjectStore } from './core/synchronize-object/object-store';
import { resetTabletopStore } from '../../testing/tabletop-test.util';

describe('CardStack real deck behavior', () => {
  beforeEach(() => {
    resetTabletopStore();
  });

  function stackWithCards(...names: string[]): CardStack {
    const stack = CardStack.create('test');
    for (const name of names) {
      stack.putOnBottom(Card.create(name, '', ''));
    }
    return stack;
  }

  it('always draws from the cover (first card)', () => {
    const stack = stackWithCards('A', 'B', 'C');
    expect(stack.topCard?.name).toBe('A');
    expect(stack.drawCard()?.name).toBe('A');
    expect(stack.drawCard()?.name).toBe('B');
  });

  it('still draws from cover when the pile is face-down', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDownAll();
    expect(stack.topCard?.name).toBe('A');
    expect(stack.drawCard()?.name).toBe('A');
    expect(stack.drawCard()?.name).toBe('B');
  });

  it('preserves each card face when drawing', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.cards[1].faceDown();
    const first = stack.drawCard();
    expect(first?.name).toBe('A');
    expect(first?.isFront).toBeTrue();
    const second = stack.drawCard();
    expect(second?.name).toBe('B');
    expect(second?.isFront).toBeFalse();
  });

  it('putOnTop prepends without forcing face', () => {
    const stack = stackWithCards('A', 'B');
    stack.faceDownAll();
    const extra = Card.create('C', '', '');
    expect(extra.isFront).toBeTrue();
    stack.putOnTop(extra);
    expect(stack.topCard?.name).toBe('C');
    expect(stack.topCard?.isFront).toBeTrue();
    expect(stack.cards[1]?.name).toBe('A');
  });

  it('putOnBottom appends without forcing face', () => {
    const stack = stackWithCards('A');
    stack.faceDown();
    const extra = Card.create('B', '', '');
    stack.putOnBottom(extra);
    expect(stack.cards.map(c => c.name)).toEqual(['A', 'B']);
    expect(stack.cards[1]?.isFront).toBeTrue();
  });

  it('inverse reverses order and flips every card', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.cards[1].faceDown();
    stack.inverse();
    expect(stack.cards.map(c => c.name)).toEqual(['C', 'B', 'A']);
    expect(stack.cards.map(c => c.isFront)).toEqual([false, true, false]);
  });

  it('draws cover in order after inverse', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDownAll();
    stack.inverse();
    expect(stack.drawCard()?.name).toBe('C');
    expect(stack.drawCard()?.isFront).toBeTrue();
    expect(stack.drawCard()?.name).toBe('A');
  });

  it('shuffle preserves faces and zeros rotate', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.cards[0].faceDown();
    stack.cards[1].rotate = 180;
    const faces = stack.cards.map(c => c.isFront);
    stack.shuffle();
    expect(stack.cards.every(c => c.rotate === 0)).toBeTrue();
    expect(stack.cards.map(c => c.isFront).sort()).toEqual([...faces].sort());
  });

  it('destroys the stack when the last card is drawn', () => {
    const stack = stackWithCards('A');
    const id = stack.identifier;
    expect(stack.drawCard()?.name).toBe('A');
    expect(stack.isEmpty).toBeTrue();
    expect(ObjectStore.instance.get(id)).toBeFalsy();
  });
});
