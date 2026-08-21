import {
  isBenignSkyWayNoise,
  isDowngradedSkyWayWarn,
  shortSkyWaySummary,
  skyWayMsgText,
} from './skyway-log';

describe('skyway-log quiet filters', () => {
  it('treats signalingClient and publicationNotExist as benign', () => {
    expect(isBenignSkyWayNoise(['internal: signalingClient'])).toBeTrue();
    expect(isBenignSkyWayNoise([{ info: { name: 'internal', detail: 'signalingClient' } }])).toBeTrue();
    expect(isBenignSkyWayNoise(['publicationNotExist: channelに該当するPublicationが存在しません'])).toBeTrue();
    expect(isBenignSkyWayNoise(['already left'])).toBeTrue();
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
