import { matchCatalogStreet } from './open3dhk-source';

describe('matchCatalogStreet', () => {
  const streets = [
    { id: 'nathan', title: '彌敦道（尖沙咀）', packUrl: 'x', street: '彌敦道', sheet: '11-SE-2C' },
  ];

  it('matches sheet id or street name', () => {
    expect(matchCatalogStreet(streets, { sheet: '11-se-2c' })?.id).toBe('nathan');
    expect(matchCatalogStreet(streets, { street: '彌敦道' })?.id).toBe('nathan');
  });
});
