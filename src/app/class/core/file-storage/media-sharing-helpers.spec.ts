import { Network } from '../system';
import {
  DEFAULT_MAX_SEND_TASKS,
  hasActiveMediaTasks,
  isSendTaskLimitReached,
  mediaSendTaskKey,
  meshCandidatePeerIds,
} from './media-sharing-helpers';

describe('media-sharing-helpers', () => {
  it('mediaSendTaskKey joins peer and id', () => {
    expect(mediaSendTaskKey('p1', 'img')).toBe('p1:img');
  });

  it('hasActiveMediaTasks is true when either map has work', () => {
    expect(hasActiveMediaTasks(0, 0)).toBe(false);
    expect(hasActiveMediaTasks(1, 0)).toBe(true);
    expect(hasActiveMediaTasks(0, 2)).toBe(true);
  });

  it('isSendTaskLimitReached uses default max of 2', () => {
    expect(DEFAULT_MAX_SEND_TASKS).toBe(2);
    expect(isSendTaskLimitReached(1)).toBe(false);
    expect(isSendTaskLimitReached(2)).toBe(true);
  });

  it('meshCandidatePeerIds unions room members and open peers', () => {
    spyOn(Network, 'listRoomMemberPeerIds').and.returnValue(['self', 'm1', '']);
    spyOnProperty(Network, 'peerId', 'get').and.returnValue('self');
    spyOnProperty(Network, 'peerIds', 'get').and.returnValue(['open1', 'm1']);
    expect(meshCandidatePeerIds().sort()).toEqual(['m1', 'open1']);
  });
});
