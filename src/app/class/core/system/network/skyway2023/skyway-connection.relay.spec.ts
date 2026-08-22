import { applyRelayFanOut } from '@udonarium/room-reconnect.util';

/**
 * SkyWayConnection.onRelay delegates to applyRelayFanOut — these cases mirror hub
 * fan-out when mobile only has a direct link to hub A and B/C receive via relay.
 */
describe('SkyWayConnection relay fan-out', () => {
  it('forwards mobile broadcast to hub B and C (fallback when relay table empty)', () => {
    const hubSend = jasmine.createSpy('hubSend');
    const bSend = jasmine.createSpy('bSend');
    const cSend = jasmine.createSpy('cSend');
    const mobileSend = jasmine.createSpy('mobileSend');
    const container = { ttl: 1 };

    const forwarded = applyRelayFanOut(
      'mobile',
      ['mobile', 'hub', 'b', 'c'],
      null,
      [
        { peerId: 'mobile', isOpen: true, send: mobileSend },
        { peerId: 'hub', isOpen: true, send: hubSend },
        { peerId: 'b', isOpen: true, send: bSend },
        { peerId: 'c', isOpen: true, send: cSend },
      ],
      undefined,
      container,
    );

    expect(forwarded).toEqual(['hub', 'b', 'c']);
    expect(hubSend).toHaveBeenCalledTimes(1);
    expect(bSend).toHaveBeenCalledTimes(1);
    expect(cSend).toHaveBeenCalledTimes(1);
    expect(mobileSend).not.toHaveBeenCalled();
    expect(container.ttl).toBe(0);
  });

  it('uses refreshRelayTargets table when present', () => {
    const bSend = jasmine.createSpy('bSend');
    const cSend = jasmine.createSpy('cSend');
    const hubSend = jasmine.createSpy('hubSend');
    const container = { ttl: 1 };

    const forwarded = applyRelayFanOut(
      'mobile',
      ['mobile', 'hub', 'b', 'c'],
      ['b', 'c'],
      [
        { peerId: 'hub', isOpen: true, send: hubSend },
        { peerId: 'b', isOpen: true, send: bSend },
        { peerId: 'c', isOpen: true, send: cSend },
      ],
      undefined,
      container,
    );

    expect(forwarded).toEqual(['b', 'c']);
    expect(hubSend).not.toHaveBeenCalled();
    expect(bSend).toHaveBeenCalledWith(container);
    expect(cSend).toHaveBeenCalledWith(container);
  });

  it('does not forward when ttl is already zero', () => {
    const send = jasmine.createSpy('send');
    const container = { ttl: 0 };
    expect(applyRelayFanOut(
      'mobile',
      ['mobile', 'hub'],
      ['hub'],
      [{ peerId: 'hub', isOpen: true, send }],
      undefined,
      container,
    )).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(container.ttl).toBe(0);
  });
});
