import { StringUtil } from '@udonarium/core/system/util/string-util';

export const OVERVIEW_TAG_NEWLINE = '/';

export function parseDataTags(dataTag: string | null | undefined): string[] {
  if (dataTag == null || dataTag.trim().length < 1) return [];
  return dataTag.trim().split(/[　\s]+/);
}

export function serializeDataTags(tags: readonly string[]): string {
  return tags
    .map(tag => (tag != null ? String(tag).trim() : ''))
    .filter(tag => 0 < tag.length)
    .join(' ');
}

export function isOverviewTagNewline(tag: string): boolean {
  return OVERVIEW_TAG_NEWLINE === StringUtil.toHalfWidth(tag);
}
