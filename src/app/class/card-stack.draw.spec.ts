import { Card } from './card';
import { CardStack } from './card-stack';
import { ObjectStore } from './core/synchronize-object/object-store';
import { resetTabletopStore } from '../../testing/tabletop-test.util';

describe('CardStack pile behavior', () => {
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

  it('draws from the first card when the pile is face-up', () => {
    const stack = stackWithCards('A', 'B', 'C');
    expect(stack.drawCard()?.name).toBe('A');
    expect(stack.drawCard()?.name).toBe('B');
  });

  it('draws from the bottom in reverse order when the whole pile is face-down', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDownAll();
    expect(stack.topCard?.name).toBe('C');
    expect(stack.drawCard()?.name).toBe('C');
    expect(stack.topCard?.name).toBe('B');
    expect(stack.drawCard()?.name).toBe('B');
    expect(stack.drawCard()?.name).toBe('A');
  });

  it('draws from the bottom when only the cover is face-down (F flip)', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDown();
    expect(stack.coverCard?.name).toBe('A');
    expect(stack.topCard?.name).toBe('C');
    expect(stack.drawCard()?.name).toBe('C');
  });

  it('drawn card matches pile face after cover-only F flip', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDown();
    const first = stack.drawCard();
    expect(first?.name).toBe('C');
    expect(first?.isFront).toBeFalse();
    const second = stack.drawCard();
    expect(second?.name).toBe('B');
    expect(second?.isFront).toBeFalse();
  });

  it('keeps cover face-down after drawing from a partially covered pile', () => {
    const stack = stackWithCards('A', 'B');
    stack.faceDown();
    expect(stack.drawCard()?.name).toBe('B');
    expect(stack.topCard?.name).toBe('A');
    expect(stack.coverCard?.isFront).toBeFalse();
  });

  it('shuffle keeps a fully face-down pile face-down', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDownAll();
    stack.shuffle();
    expect(stack.topCard?.isFront).toBeFalse();
    expect(stack.cards.every(card => !card.isFront)).toBeTrue();
  });

  it('shuffle keeps a partially covered pile showing back', () => {
    const stack = stackWithCards('A', 'B', 'C');
    stack.faceDown();
    stack.shuffle();
    expect(stack.coverCard?.isFront).toBeFalse();
    expect(stack.topCard?.isFront).toBeFalse();
  });

  it('shuffle does not flip a face-up pile', () => {
    const stack = stackWithCards('A', 'B');
    stack.shuffle();
    expect(stack.topCard?.isFront).toBeTrue();
  });

  it('draws K first from A~K pile after F flip (cover only)', () => {
    const stack = CardStack.create('deck');
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      stack.putOnBottom(Card.create(name, '', ''));
    }
    expect(stack.coverCard?.name).toBe('A');
    stack.faceDown();
    expect(stack.coverCard?.isFront).toBeFalse();
    expect(stack.topCard?.name).toBe('K');
    expect(stack.drawCard()?.name).toBe('K');
  });

  it('putOnTop adds to the drawable top of a face-down pile', () => {
    const stack = stackWithCards('A', 'B');
    stack.faceDown();
    const extra = Card.create('C', '', '');
    stack.putOnTop(extra);
    expect(stack.topCard?.name).toBe('C');
    expect(stack.coverCard?.name).toBe('A');
  });

  it('destroys the stack when the last card is drawn', () => {
    const stack = stackWithCards('A');
    const id = stack.identifier;
    expect(stack.drawCard()?.name).toBe('A');
    expect(stack.isEmpty).toBeTrue();
    expect(ObjectStore.instance.get(id)).toBeFalsy();
  });
});
