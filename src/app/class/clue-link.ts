import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import { TextNote } from './text-note';
import { notePinAnchorPx, pinAnchorPx, stringPathD } from './table-fx/push-pin.util';

export type ClueLinkEndpoint = GameCharacter | TextNote;

@SyncObject('clue-link')
export class ClueLink extends GameObject {
  @SyncVar() fromIdentifier: string = '';
  @SyncVar() toIdentifier: string = '';
  /** Slack factor for Bezier sag (0.05–0.55 typical). */
  @SyncVar() sag: number = 0.22;
  @SyncVar() color: string = '#c62828';
  /** Optional: only show when this table is viewed (empty = any). */
  @SyncVar() tableIdentifier: string = '';

  get fromObject(): ClueLinkEndpoint | null {
    return ClueLink.resolveEndpoint(this.fromIdentifier);
  }

  get toObject(): ClueLinkEndpoint | null {
    return ClueLink.resolveEndpoint(this.toIdentifier);
  }

  static resolveEndpoint(id: string): ClueLinkEndpoint | null {
    if (!id) return null;
    const obj = ObjectStore.instance.get(id);
    if (obj instanceof GameCharacter || obj instanceof TextNote) return obj;
    return null;
  }

  static create(
    fromId: string,
    toId: string,
    opts?: { sag?: number; color?: string; tableIdentifier?: string; identifier?: string },
  ): ClueLink {
    const link = opts?.identifier ? new ClueLink(opts.identifier) : new ClueLink();
    link.fromIdentifier = fromId;
    link.toIdentifier = toId;
    if (opts?.sag != null) link.sag = opts.sag;
    if (opts?.color) link.color = opts.color;
    if (opts?.tableIdentifier) link.tableIdentifier = opts.tableIdentifier;
    link.initialize();
    return link;
  }

  static all(): ClueLink[] {
    return ObjectStore.instance.getObjects<ClueLink>(ClueLink);
  }

  static cleanupFor(endpointId: string): void {
    if (!endpointId) return;
    for (const link of ClueLink.all()) {
      if (link.fromIdentifier === endpointId || link.toIdentifier === endpointId) {
        link.destroy();
      }
    }
  }

  isValidOnTable(viewTableId: string): boolean {
    if (this.tableIdentifier && viewTableId && this.tableIdentifier !== viewTableId) return false;
    const a = this.fromObject;
    const b = this.toObject;
    if (!a || !b) return false;
    if (!a.isVisibleOnTable || !b.isVisibleOnTable) return false;
    if (!(a.pushPin && b.pushPin)) return false;
    return true;
  }

  pathD(gridSize = 50): string | null {
    const a = this.fromObject;
    const b = this.toObject;
    if (!a || !b) return null;
    const p1 = endpointPinAnchor(a, gridSize);
    const p2 = endpointPinAnchor(b, gridSize);
    return stringPathD(p1.x, p1.y, p2.x, p2.y, this.sag);
  }
}

function endpointPinAnchor(obj: ClueLinkEndpoint, gridSize: number): { x: number; y: number } {
  if (obj instanceof GameCharacter) {
    const s = (obj.size || 1) * gridSize;
    return pinAnchorPx(obj, s, s);
  }
  const w = (obj.width || 1) * gridSize;
  const h = (obj.height || 1) * gridSize;
  return notePinAnchorPx(obj, w, h);
}
