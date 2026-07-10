import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_CODE_TTL_MS,
  WHATSAPP_MAX_VERIFY_ATTEMPTS,
} from '../config/constants';
import {
  checkVerificationCode,
  generateVerificationCode,
  hashVerificationCode,
  newPendingVerification,
} from './verification';

const NOW = new Date('2026-07-09T12:00:00Z');

describe('generateVerificationCode', () => {
  it('always produces exactly 6 digits, zero-padded', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('newPendingVerification', () => {
  it('stores a hash (never the plaintext) and the TTL expiry', () => {
    const pending = newPendingVerification('123456', NOW);
    expect(pending.codeHash).toBe(hashVerificationCode('123456'));
    expect(pending.codeHash).not.toContain('123456');
    expect(Date.parse(pending.expiresAt)).toBe(NOW.getTime() + WHATSAPP_CODE_TTL_MS);
    expect(pending.attempts).toBe(0);
  });
});

describe('checkVerificationCode', () => {
  it('accepts the right code before expiry', () => {
    const pending = newPendingVerification('123456', NOW);
    expect(checkVerificationCode(pending, '123456', NOW)).toBe('ok');
  });

  it('rejects a wrong code as mismatch', () => {
    const pending = newPendingVerification('123456', NOW);
    expect(checkVerificationCode(pending, '654321', NOW)).toBe('mismatch');
  });

  it('rejects the right code after expiry', () => {
    const pending = newPendingVerification('123456', NOW);
    const later = new Date(NOW.getTime() + WHATSAPP_CODE_TTL_MS + 1);
    expect(checkVerificationCode(pending, '123456', later)).toBe('expired');
  });

  it('burns the code once max attempts are spent — even for the right code', () => {
    const pending = newPendingVerification('123456', NOW);
    pending.attempts = WHATSAPP_MAX_VERIFY_ATTEMPTS;
    expect(checkVerificationCode(pending, '123456', NOW)).toBe('too_many_attempts');
  });
});
