import { describe, expect, it } from 'vitest';
import {
  maskPhone,
  normalizePhoneE164,
  parseConnectRequest,
  parseThresholdRequest,
  parseVerifyRequest,
} from './whatsappRequests';

describe('normalizePhoneE164', () => {
  it('accepts and cleans common formats', () => {
    expect(normalizePhoneE164('+14165551234')).toBe('+14165551234');
    expect(normalizePhoneE164('+1 (416) 555-1234')).toBe('+14165551234');
    expect(normalizePhoneE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhoneE164('0014165551234')).toBe('+14165551234');
  });

  it('rejects anything that is not full E.164', () => {
    for (const bad of ['4165551234', '+0416555', '+1', 'hello', '', 42, null, undefined]) {
      expect(normalizePhoneE164(bad)).toBeNull();
    }
  });
});

describe('maskPhone', () => {
  it('keeps the first digit and last four only', () => {
    expect(maskPhone('+14165551234')).toBe('+1••••••1234');
    expect(maskPhone('+442079460958')).toBe('+4•••••••0958');
  });
});

describe('parseConnectRequest', () => {
  it('accepts a valid body', () => {
    const result = parseConnectRequest({ phone: '+1 416 555 1234', thresholdPercent: 2.5 });
    expect(result).toEqual({
      ok: true,
      value: { phoneE164: '+14165551234', thresholdPercent: 2.5 },
    });
  });

  it('rejects a bad phone or threshold', () => {
    expect(parseConnectRequest({ phone: 'nope', thresholdPercent: 2 }).ok).toBe(false);
    expect(parseConnectRequest({ phone: '+14165551234', thresholdPercent: -1 }).ok).toBe(false);
    expect(parseConnectRequest({ phone: '+14165551234', thresholdPercent: '2' }).ok).toBe(false);
    expect(parseConnectRequest(null).ok).toBe(false);
  });

  it('rounds thresholds to two decimals', () => {
    const result = parseConnectRequest({ phone: '+14165551234', thresholdPercent: 2.555 });
    expect(result.ok && result.value.thresholdPercent).toBe(2.56);
  });
});

describe('parseVerifyRequest', () => {
  it('accepts a 6-digit code, trimming whitespace', () => {
    expect(parseVerifyRequest({ code: ' 123456 ' })).toEqual({
      ok: true,
      value: { code: '123456' },
    });
  });

  it('rejects non-6-digit codes', () => {
    for (const bad of ['12345', '1234567', 'abcdef', 123456, '', undefined]) {
      expect(parseVerifyRequest({ code: bad }).ok).toBe(false);
    }
  });
});

describe('parseThresholdRequest', () => {
  it('accepts 0..100 and rejects the rest', () => {
    expect(parseThresholdRequest({ thresholdPercent: 0 }).ok).toBe(true);
    expect(parseThresholdRequest({ thresholdPercent: 100 }).ok).toBe(true);
    expect(parseThresholdRequest({ thresholdPercent: 100.1 }).ok).toBe(false);
    expect(parseThresholdRequest({ thresholdPercent: NaN }).ok).toBe(false);
    expect(parseThresholdRequest({}).ok).toBe(false);
  });
});
