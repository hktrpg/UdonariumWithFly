import { RoomAuth } from '@udonarium/room-auth';

import { RoomInviteService } from './room-invite.service';

describe('RoomInviteService role passwords', () => {
  let service: RoomInviteService;

  beforeEach(() => {
    service = new RoomInviteService();
    RoomAuth.clearAttained();
  });

  afterEach(() => {
    RoomAuth.clearAttained();
  });

  it('stores all role passwords from setRolePasswords (create-room path)', () => {
    service.setRolePasswords({ gm: 'gmpw', user: 'userpw', guest: 'guestpw' });
    expect(service.getRolePassword('gm')).toBe('gmpw');
    expect(service.getRolePassword('user')).toBe('userpw');
    expect(service.getRolePassword('guest')).toBe('guestpw');
    expect(RoomAuth.getSessionRolePassword('user')).toBe('userpw');
  });

  it('falls back to RoomAuth session when in-service map is empty but session remains', () => {
    RoomAuth.rememberSession('user', 'session-user', 'mesh');
    RoomAuth.rememberSession('gm', 'session-gm', 'mesh');
    // Simulate map-only loss (not clearRolePasswords, which also wipes session).
    (service as any).rolePasswords = {};
    expect(service.getRolePassword('user')).toBe('session-user');
    expect(service.getRolePassword('gm')).toBe('session-gm');
  });

  it('keeps player password when create captures consts before a wiped form read', () => {
    // createRoom must capture locals at submit, then persist those — never re-read form later.
    const captured = {
      gm: 'gm-secret',
      user: 'player-secret',
      guest: '',
    };
    // Browser wiped the bound fields after submit.
    const form = { gm: '', user: '', guest: '' };

    RoomAuth.rememberSession('gm', captured.gm, 'mesh-x');
    service.setRolePasswords(captured);

    // Bug: OPEN_NETWORK re-reads form → player secret lost, GM often still filled by PM.
    service.setRolePasswords({
      gm: form.gm || captured.gm, // accidental partial survival
      user: form.user,            // wiped
      guest: form.guest,
    });
    expect(service.getRolePassword('user')).toBe('');

    // Fix: always re-apply the captured consts (ignore wiped form).
    service.setRolePasswords(captured);
    expect(service.getRolePassword('gm')).toBe('gm-secret');
    expect(service.getRolePassword('user')).toBe('player-secret');
    expect(RoomAuth.getSessionRolePassword('user')).toBe('player-secret');
  });

  it('empty setRolePasswords write clears session (callers must capture before wipe)', () => {
    service.setRolePasswords({ gm: 'gmpw', user: 'userpw', guest: '' });
    service.setRolePasswords({ gm: 'gmpw', user: '', guest: '' });
    expect(service.getRolePassword('gm')).toBe('gmpw');
    expect(service.getRolePassword('user')).toBe('');
    expect(RoomAuth.getSessionRolePassword('user')).toBe('');
  });

  it('clearRolePasswords drops map and session so a prior room cannot leak secrets', () => {
    service.setRolePasswords({ gm: 'gmpw', user: 'userpw', guest: 'guestpw' });
    service.clearRolePasswords();
    expect(service.getRolePassword('gm')).toBe('');
    expect(service.getRolePassword('user')).toBe('');
    expect(RoomAuth.getSessionRolePassword('user')).toBe('');
  });
});
