import {
  CARD_STATUS_DEFS,
  hasCardStatus,
  parseCardStatusesJson,
  setCardStatusFlag,
  stringifyCardStatuses,
} from './card-status';

describe('card-status', () => {
  it('exposes at most 10 status defs', () => {
    expect(CARD_STATUS_DEFS.length).toBeGreaterThan(0);
    expect(CARD_STATUS_DEFS.length).toBeLessThanOrEqual(10);
  });

  it('parses known ids and drops unknown ones', () => {
    expect(parseCardStatusesJson('[{"id":"read"},{"id":"nope"},{"id":"flag"}]')).toEqual([
      { id: 'read' },
      { id: 'flag' },
    ]);
    expect(parseCardStatusesJson('')).toEqual([]);
    expect(parseCardStatusesJson('not-json')).toEqual([]);
  });

  it('toggles flags via setCardStatusFlag', () => {
    let list = setCardStatusFlag([], 'starred', true);
    expect(hasCardStatus(list, 'starred')).toBe(true);
    list = setCardStatusFlag(list, 'starred', false);
    expect(hasCardStatus(list, 'starred')).toBe(false);
    expect(stringifyCardStatuses(list)).toBe('[]');
  });
});
