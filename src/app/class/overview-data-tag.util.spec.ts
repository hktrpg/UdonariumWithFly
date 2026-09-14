import { isOverviewTagNewline, parseDataTags, serializeDataTags } from './overview-data-tag.util';

describe('overview-data-tag.util', () => {
  it('parseDataTags splits on spaces including full-width space', () => {
    expect(parseDataTags('HP MP　敏捷')).toEqual(['HP', 'MP', '敏捷']);
  });

  it('serializeDataTags joins tags with spaces', () => {
    expect(serializeDataTags(['HP', 'MP', '/'])).toBe('HP MP /');
  });

  it('isOverviewTagNewline recognizes slash', () => {
    expect(isOverviewTagNewline('/')).toBeTrue();
    expect(isOverviewTagNewline('／')).toBeTrue();
    expect(isOverviewTagNewline('HP')).toBeFalse();
  });
});
