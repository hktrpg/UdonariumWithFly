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

  it('falls back to RoomAuth session when in-service map is cleared', () => {
    RoomAuth.rememberSession('user', 'session-user', 'mesh');
    RoomAuth.rememberSession('gm', 'session-gm', 'mesh');
    service.clearRolePasswords();
    expect(service.getRolePassword('user')).toBe('session-user');
    expect(service.getRolePassword('gm')).toBe('session-gm');
  });

  it('keeps user password when form fields are wiped after capture (OPEN_NETWORK race)', () => {
    // Mirrors createRoom: capture consts, then a late callback must not re-read empty form fields.
    const gmPassword = 'gm-secret';
    const userPassword = 'player-secret';
    const guestPassword = '';

    RoomAuth.rememberSession('gm', gmPassword, 'mesh-x');
    service.setRolePasswords({
      gm: gmPassword,
      user: userPassword,
      guest: guestPassword,
    });

    // Simulate browser clearing password inputs after submit / before OPEN_NETWORK.
    const formGm = '';
    const formUser = '';
    void formGm;
    void formUser;

    // OPEN_NETWORK handler must re-apply captured consts, not live form values.
    RoomAuth.rememberSession('gm', gmPassword, 'mesh-x');
    service.setRolePasswords({
      gm: gmPassword,
      user: userPassword,
      guest: guestPassword,
    });

    expect(service.getRolePassword('gm')).toBe('gm-secret');
    expect(service.getRolePassword('user')).toBe('player-secret');
    expect(RoomAuth.getSessionRolePassword('user')).toBe('player-secret');
  });

  it('regression: reading empty form after open would drop only non-GM if GM was re-saved alone', () => {
    service.setRolePasswords({ gm: 'gmpw', user: 'userpw', guest: '' });
    // Bug pattern: callback re-reads cleared form and only remembers GM from a partial write.
    service.setRolePasswords({ gm: 'gmpw', user: '', guest: '' });
    expect(service.getRolePassword('gm')).toBe('gmpw');
    expect(service.getRolePassword('user')).toBe('');
  });
});
