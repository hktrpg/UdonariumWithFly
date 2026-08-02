import { AuthToken, ChannelScope, nowInSec, SkyWayAuthToken, uuidV4 } from '@skyway-sdk/core';

export class SkyWayBackend {
  constructor(readonly url: string) { }

  async alive(): Promise<boolean> {
    return fetchStatus(this.url);
  }

  async createSkyWayAuthToken(channelName: string, peerId: string): Promise<string> {
    return fetchSkyWayAuthToken(this.url, channelName, peerId);
    //return createSkyWayAuthTokenMock(channelName, peerId);
  }
}

async function fetchStatus(url: string): Promise<boolean> {
  try {
    let api = new URL('/v1/status', url);
    let response = await fetch(api);

    return response.status === 200
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function fetchSkyWayAuthToken(url: string, channelName: string, peerId: string): Promise<string> {
  try {
    let api = new URL('/v1/skyway2023/token', url);

    let body = JSON.stringify({
      formatVersion: 1,
      channelName: channelName,
      peerId: peerId,
    });

    let response = await fetch(api, { method: 'POST', body: body });

    if (response.status !== 200) return '';

    let jsonObj = await response.json();
    return jsonObj.token ?? '';
  } catch (err) {
    console.error(err);
    return '';
  }
}

/**
 * Mock implementation that generates SkyWayAuthToken.
 *
 * **The secret key must stay hidden from the frontend. Do not use this in production.**
 *
 * If you generate SkyWayAuthToken on the frontend without a server,
 * end users can obtain the secret key and create/join arbitrary Channels/Rooms.
 *
 * @param channelName Channel name to connect
 * @param peerId PeerId
 * @returns JWT
 */
async function createSkyWayAuthTokenMock(channelName: string, peerId: string): Promise<string> {
  // Mock: application ID and secret key are fixed values
  // In production, keep the secret key on a server
  const _appId = '<SkyWay2023 Application ID>';
  const _secret = '<SkyWay2023 Secret key>';

  const lobbySize = 4;

  if (channelName.startsWith('udonarium-lobby-') || channelName.includes('*') || peerId.includes('*')) {
    throw new Error('Invalid Argument');
  }

  const channelMap: Map<string, ChannelScope> = new Map();
  const isPrivateRoom = channelName === peerId;

  channelMap.set(channelName, {
    name: channelName,
    actions: isPrivateRoom ? ['read', 'create', 'updateMetadata'] : ['read', 'create'],
    members: [
      {
        name: peerId,
        actions: ['write'],
        publication: {
          actions: ['write'],
        },
        subscription: {
          actions: ['write'],
        },
      },
      {
        name: '*',
        actions: ['signal'],
      },
    ],
  });

  const lobbyName = `udonarium-lobby-*-of-${lobbySize}`;
  channelMap.set(lobbyName, {
    name: lobbyName,
    actions: ['read', 'create'],
    members: [
      {
        name: peerId,
        actions: ['write'],
      },
    ],
  });

  let props: AuthToken = {
    jti: uuidV4(),
    iat: nowInSec(),
    exp: nowInSec() + 60 * 60 * 24,
    scope: {
      app: {
        id: _appId,
        turn: false,
        actions: ['read'],
        channels: Array.from(channelMap.values()),
      },
    },
    version: 2,
  };

  const token = new SkyWayAuthToken(props).encode(_secret);

  return token;
}
