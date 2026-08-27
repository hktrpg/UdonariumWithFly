/**
 * Selection is local UI state. Peer UPDATE_GAME_OBJECT must update pose only —
 * never clear the box-selection highlight.
 */
export function shouldClearSelectionOnRemotePoseUpdate(): boolean {
  return false;
}
