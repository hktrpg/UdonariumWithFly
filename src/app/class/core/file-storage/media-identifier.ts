/**
 * Identifiers that load via URL / static assets, not P2P blob transfer.
 * Built-in trump cards use paths like `./assets/images/trump/c01.gif`.
 */
export function isUrlBackedMediaIdentifier(identifier: string): boolean {
  if (!identifier) return false;
  return (
    identifier.startsWith('./') ||
    identifier.startsWith('../') ||
    identifier.startsWith('/') ||
    identifier.startsWith('http://') ||
    identifier.startsWith('https://') ||
    identifier.startsWith('blob:') ||
    identifier.startsWith('data:')
  );
}
