import { ImageFile } from './core/file-storage/image-file';
import { CardStack } from './card-stack';
import { DataElement } from './data-element';
import {
  makeCard,
  makeDice,
  makeMask,
  resetTabletopStore,
} from '../../testing/tabletop-test.util';

describe('null-length safety (room-load templates)', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('ImageFile.url is never nullish when thumbnail.url is null', () => {
    const file = ImageFile.createEmpty('sync-pending');
    (file as any).context.url = null;
    (file as any).context.thumbnail = { blob: null, type: '', url: null };
    expect(file.url).toBe('');
    expect(() => file.url.length).not.toThrow();
  });

  it('dice/card/stack/mask ownerName and hasOwner tolerate missing PeerCursor and null owner', () => {
    const dice = makeDice('d1');
    dice.owner = 'missing-peer';
    expect(dice.ownerName).toBe('');
    expect(dice.hasOwner).toBeTrue();
    expect(() => dice.ownerName.length).not.toThrow();
    (dice as any).owner = null;
    expect(dice.hasOwner).toBeFalse();

    const card = makeCard('c1');
    card.owner = 'missing-peer';
    expect(card.ownerName).toBe('');
    (card as any).owner = null;
    expect(card.hasOwner).toBeFalse();

    const stack = CardStack.create('s1', 'stack1');
    stack.owner = 'missing-peer';
    expect(stack.ownerName).toBe('');
    (stack as any).owner = null;
    expect(stack.hasOwner).toBeFalse();

    const mask = makeMask('m1');
    mask.owner = 'missing-peer';
    expect(mask.ownerName).toBe('');
    (mask as any).owner = null;
    expect(mask.hasOwner).toBeFalse();
  });

  it('DataElement.name defaults to empty string', () => {
    const el = new DataElement();
    expect(el.name).toBe('');
    expect(() => el.name.trim().length).not.toThrow();
  });
});
