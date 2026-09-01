import { Card } from '@udonarium/card';
import { Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { HandService } from './hand.service';
import { resetTabletopStore } from '../../testing/tabletop-test.util';

describe('HandService offline claim', () => {
  let service: HandService;
  let prevMyCursor: PeerCursor;
  let peers: any[];

  beforeEach(() => {
    resetTabletopStore();
    service = new HandService();
    prevMyCursor = PeerCursor.myCursor;
    peers = [];
    PeerCursor.myCursor = { name: 'Alice', userId: 'self-id' } as any;
    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'self-id' } as any);
    spyOnProperty(Network, 'peers', 'get').and.callFake(() => peers as any);
    spyOn(PeerCursor, 'findByUserId').and.callFake((id: string) => {
      if (id === 'self-id') return PeerCursor.myCursor;
      return null;
    });
  });

  afterEach(() => {
    PeerCursor.myCursor = prevMyCursor;
  });

  function handCard(name: string, owner: string, ownerLabel: string): Card {
    const card = Card.create(name, '', '');
    card.owner = owner;
    card.ownerLabel = ownerLabel;
    card.setLocation('hand');
    return card;
  }

  it('lists offline piles with stamped ownerLabel after cursor is gone', () => {
    handCard('c1', 'old-id', 'Bob');
    handCard('c2', 'old-id', 'Bob');
    const piles = service.offlineHandPiles();
    expect(piles).toEqual([{ userId: 'old-id', name: 'Bob', count: 2 }]);
  });

  it('refuses mergeHandIntoSelf when open peer matches userId even if cursor peerId is stale', () => {
    handCard('c1', 'live-id', 'Bob');
    (PeerCursor.findByUserId as jasmine.Spy).and.callFake((id: string) => {
      if (id === 'self-id') return PeerCursor.myCursor;
      if (id === 'live-id') return { name: 'Bob', userId: 'live-id', peerId: 'stale-peer' } as any;
      return null;
    });
    peers = [{ peerId: 'fresh-peer', userId: 'live-id', isOpen: true }];
    expect(service.isOwnerOnline('live-id')).toBeTrue();
    expect(service.mergeHandIntoSelf('live-id')).toBe(0);
  });

  it('mergeHandIntoSelf moves offline cards into self', () => {
    handCard('c1', 'old-id', 'Bob');
    handCard('c2', 'old-id', 'Bob');
    expect(service.mergeHandIntoSelf('old-id')).toBe(2);
    expect(service.cardsInHand('old-id').length).toBe(0);
    expect(service.cardsInHand('self-id').length).toBe(2);
    expect(service.cardsInHand('self-id').every(c => c.owner === 'self-id')).toBeTrue();
  });

  it('autoClaimMatchingNickname claims all matching offline piles', () => {
    handCard('a1', 'orphan-a', 'Alice');
    handCard('a2', 'orphan-a', 'Alice');
    handCard('b1', 'orphan-b', 'Alice');
    handCard('c1', 'orphan-c', 'Carol');
    const claimed = service.autoClaimMatchingNickname();
    expect(claimed.map(p => p.userId).sort()).toEqual(['orphan-a', 'orphan-b']);
    expect(service.cardsInHand('self-id').length).toBe(3);
    expect(service.cardsInHand('orphan-c').length).toBe(1);
  });

  it('autoClaimMatchingNickname claims offline piles even when PeerCursor still exists', () => {
    handCard('a1', 'grace-id', 'Alice');
    (PeerCursor.findByUserId as jasmine.Spy).and.callFake((id: string) => {
      if (id === 'self-id') return PeerCursor.myCursor;
      // Disconnect grace: cursor remains, but peer is not open → still offline.
      if (id === 'grace-id') return { name: 'Alice', userId: 'grace-id', peerId: 'gone-peer' } as any;
      return null;
    });
    peers = []; // no open peer
    const claimed = service.autoClaimMatchingNickname();
    expect(claimed.map(p => p.userId)).toEqual(['grace-id']);
    expect(service.cardsInHand('self-id').length).toBe(1);
    expect(service.cardsInHand('grace-id').length).toBe(0);
  });

  it('backfillHandOwnerLabels stamps nickname from live cursor', () => {
    const card = handCard('x', 'old-id', '');
    (PeerCursor.findByUserId as jasmine.Spy).and.callFake((id: string) => {
      if (id === 'self-id') return PeerCursor.myCursor;
      if (id === 'old-id') return { name: 'Bob', userId: 'old-id', peerId: 'p' } as any;
      return null;
    });
    service.backfillHandOwnerLabels();
    expect(card.ownerLabel).toBe('Bob');
  });
});
