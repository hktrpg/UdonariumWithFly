import { ObjectStore } from './core/synchronize-object/object-store';
import { Network } from './core/system';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('Plan alignment gaps', () => {
  beforeEach(() => {
    resetTabletopStore();
    makeTable('mapA');
    viewTables('mapA');
  });
  afterEach(() => resetTabletopStore());

  it('destroying a body cascades to all of its Tokens', () => {
    const body = makeCharacter('cascade_body');
    const a = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    const b = CharacterToken.create(body.identifier, { x: 40, y: 40 }, { tableId: 'mapA' });
    const aId = a.identifier;
    const bId = b.identifier;
    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(2);

    body.destroy();

    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(0);
    expect(ObjectStore.instance.get(aId)).toBeNull();
    expect(ObjectStore.instance.get(bId)).toBeNull();
    expect(ObjectStore.instance.get(body.identifier)).toBeNull();
  });

  it('vision on map Token is what FoW focus reads', () => {
    const body = makeCharacter('vision_body');
    body.visionRange = 3;
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    expect(tok.visionRange).toBe(3);

    tok.mutateAppearance(() => { tok.visionRange = 12; });
    expect(CharacterToken.focusTokenForCharacter(body.identifier, 'mapA')!.visionRange).toBe(12);
  });

  it('temporary bodies are excluded from chat-select style filters', () => {
    const normal = makeCharacter('chat_ok');
    normal.isAllowsChat = true;
    normal.location.name = 'common';

    const temp = makeCharacter('chat_temp');
    temp.isTemporaryCopy = true;
    temp.isAllowsChat = true;
    temp.location.name = 'common';

    const list = [normal, temp].filter(c => !c.isTemporaryCopy && c.isAllowsChat);
    expect(list.map(c => c.identifier)).toEqual([normal.identifier]);
  });

  it('isStealthMode only considers Tokens on the table', () => {
    const body = makeCharacter('stealth_body');
    body.owner = 'someone';
    expect(GameCharacter.isStealthMode).toBeFalse();

    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'someone' } as any);
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    tok.owner = 'someone';
    expect(tok.isHideIn).toBeTrue();
    expect(tok.isVisible).toBeTrue();
    expect(tok.isVisibleOnTable).toBeTrue();
    expect(CharacterToken.isStealthMode).toBeTrue();
    expect(GameCharacter.isStealthMode).toBeTrue();
  });
});
