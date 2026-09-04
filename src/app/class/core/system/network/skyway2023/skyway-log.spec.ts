import {
  isAlreadySameNameMemberExist,
  isBenignSkyWayNoise,
  isDowngradedSkyWayWarn,
  isRetriableSubscribeError,
  shortSkyWaySummary,
  skyWayMsgText,
} from './skyway-log';

describe('skyway-log quiet filters', () => {
  it('treats signalingClient and publicationNotExist as benign', () => {
    expect(isBenignSkyWayNoise(['internal: signalingClient'])).toBeTrue();
    expect(isBenignSkyWayNoise([{ info: { name: 'internal', detail: 'signalingClient' } }])).toBeTrue();
    expect(isBenignSkyWayNoise(['publicationNotExist: channelに該当するPublicationが存在しません'])).toBeTrue();
    expect(isBenignSkyWayNoise(['alreadySubscribedPublication: すでにSubscribeした'])).toBeTrue();
    expect(isBenignSkyWayNoise(['localPersonNotJoinedChannel: not in channel'])).toBeTrue();
    expect(isBenignSkyWayNoise(['already left'])).toBeTrue();
  });

  it('isRetriableSubscribeError covers subscribe races', () => {
    expect(isRetriableSubscribeError('alreadySubscribedPublication: dup')).toBeTrue();
    expect(isRetriableSubscribeError('localPersonNotJoinedChannel: left')).toBeTrue();
    expect(isRetriableSubscribeError('publicationNotExist: gone')).toBeTrue();
    expect(isRetriableSubscribeError('internalError:')).toBeTrue();
    expect(isRetriableSubscribeError('fatal: auth')).toBeFalse();
  });

  it('isAlreadySameNameMemberExist detects duplicate channel member join', () => {
    expect(isAlreadySameNameMemberExist({ name: 'alreadySameNameMemberExist', message: 'dup' })).toBeTrue();
    expect(isAlreadySameNameMemberExist({ message: 'Channelにすでに同じNameのMemberが存在します' })).toBeTrue();
    expect(isAlreadySameNameMemberExist({ name: 'token-expired' })).toBeFalse();
  });

  it('downgrades restartIce limit exceeded to warn-class noise', () => {
    expect(isDowngradedSkyWayWarn(['restartIce limit exceeded'])).toBeTrue();
    expect(isDowngradedSkyWayWarn([{
      info: { name: 'internal', detail: 'restartIce limit exceeded' },
    }])).toBeTrue();
    expect(isBenignSkyWayNoise(['restartIce limit exceeded'])).toBeFalse();
  });

  it('shortSkyWaySummary prefers info.name + detail', () => {
    expect(shortSkyWaySummary([{
      info: { name: 'internal', detail: 'signalingClient' },
    }])).toBe('internal: signalingClient');
  });

  it('skyWayMsgText joins string and object args', () => {
    expect(skyWayMsgText(['a', { b: 1 }])).toContain('a');
    expect(skyWayMsgText(['a', { b: 1 }])).toContain('"b":1');
  });
});
