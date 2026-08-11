import {
  PIN_BOX,
  notePinAnchorPx,
  pinAnchorPx,
  randomPinOffset,
  stringPathD,
} from './push-pin.util';

describe('push-pin.util', () => {
  it('pinAnchorPx uses default tip when offsets are default', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: PIN_BOX.left,
      pushPinTop: PIN_BOX.top,
      location: { x: 100, y: 200 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    const tipX = PIN_BOX.left + PIN_BOX.width * PIN_BOX.tipX;
    const tipY = PIN_BOX.top + PIN_BOX.height * PIN_BOX.tipY;
    expect(p.x).toBeCloseTo(100 + tipX, 5);
    expect(p.y).toBeCloseTo(200 + tipY, 5);
  });

  it('pinAnchorPx respects custom pushPinLeft/Top', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: 10,
      pushPinTop: -30,
      location: { x: 0, y: 0 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    expect(p.x).toBeCloseTo(10 + PIN_BOX.width * PIN_BOX.tipX, 5);
    expect(p.y).toBeCloseTo(-30 + PIN_BOX.height * PIN_BOX.tipY, 5);
  });

  it('notePinAnchorPx uses bottom-center paper origin', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: -4,
      pushPinTop: -20,
      location: { x: 500, y: 400 },
      rotate: 0,
    };
    const w = 200;
    const h = 150;
    const p = notePinAnchorPx(host, w, h);
    const tipX = -4 + PIN_BOX.width * 0.5;
    const tipY = -20 + PIN_BOX.height * 0.5;
    expect(p.x).toBeCloseTo(500 + (-w / 2 + tipX), 5);
    expect(p.y).toBeCloseTo(400 + (-h + tipY), 5);
  });

  it('stringPathD returns a quadratic path with sag', () => {
    const d = stringPathD(0, 0, 100, 0, 0.22);
    expect(d.startsWith('M 0 0 Q ')).toBeTrue();
    expect(d.endsWith(' 100 0')).toBeTrue();
  });

  it('randomPinOffset keeps top in the allowed band', () => {
    for (let i = 0; i < 40; i++) {
      const off = randomPinOffset(100);
      expect(off.top).toBeGreaterThanOrEqual(-28);
      expect(off.top).toBeLessThanOrEqual(-20);
      expect(off.left).toBeGreaterThanOrEqual(PIN_BOX.left);
    }
  });
});
