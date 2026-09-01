/**
 * Identifiers that load via URL / static assets, not P2P blob transfer.
 * Built-in defaults use paths like `./assets/images/trump/c01.gif` or
 * `./assets/sounds/...`. Storages hydrate these on get() for joiners.
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
