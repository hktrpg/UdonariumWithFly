/** Streetscape data country / region. */
export type StreetscapeCountryId = 'hk' | 'jp';

export type StreetscapeCountryOption = {
  id: StreetscapeCountryId;
  /** i18n key for the select label. */
  labelKey: string;
};

export const STREETSCAPE_COUNTRIES: StreetscapeCountryOption[] = [
  { id: 'hk', labelKey: 'streetscape.country.hk' },
  { id: 'jp', labelKey: 'streetscape.country.jp' },
];

export function normalizeStreetscapeCountry(id: string | null | undefined): StreetscapeCountryId {
  return id === 'jp' ? 'jp' : 'hk';
}
