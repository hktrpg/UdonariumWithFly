import { EventSystem } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';

import * as localForage from 'localforage';

/**
 * Personal preference: when joined as GM, show face-down card fronts (table translucent
 * overlay, captions, previews) and allow hand-rail peek of other players' hands.
 * Default ON to match historical GM behavior. Device-local only (localForage).
 */
export class GmCardPeek {
  static readonly STORAGE_KEY = 'udonarium.gm-card-peek';

  /** Preference flag (independent of whether the peer is currently GM). */
  static enabled = true;

  static setEnabled(enabled: boolean) {
    const next = !!enabled;
    if (GmCardPeek.enabled === next) return;
    GmCardPeek.enabled = next;
    localForage.setItem(GmCardPeek.STORAGE_KEY, next).catch(() => {});
    EventSystem.trigger('CHANGE_GM_CARD_PEEK', null);
  }

  /** Load from storage; default true when unset. */
  static loadFromStorage(): void {
    localForage.getItem<boolean>(GmCardPeek.STORAGE_KEY).then(v => {
      GmCardPeek.enabled = v == null ? true : !!v;
      EventSystem.trigger('CHANGE_GM_CARD_PEEK', null);
    }).catch(() => {});
  }

  /** True when this peer is GM and the personal peek preference is on. */
  static get active(): boolean {
    return !!PeerCursor.myCursor?.isGMMode && GmCardPeek.enabled;
  }
}
