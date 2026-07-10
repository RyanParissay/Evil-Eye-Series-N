/**
 * Phone verification: 6-digit codes, hashed at rest, short-lived, few
 * guesses. Pure logic (hashing only, no I/O) so it unit-tests directly;
 * attempt counting is the caller's job — it owns the store.
 */
import { createHash, randomInt } from 'node:crypto';
import {
  WHATSAPP_CODE_TTL_MS,
  WHATSAPP_MAX_VERIFY_ATTEMPTS,
} from '../config/constants';

export interface PendingVerification {
  /** sha256 hex of the 6-digit code; the plaintext is never stored. */
  codeHash: string;
  /** ISO timestamp after which the code is dead. */
  expiresAt: string;
  /** Wrong guesses so far; the code burns at WHATSAPP_MAX_VERIFY_ATTEMPTS. */
  attempts: number;
}

/** Crypto-random 6 digits, zero-padded ("004217" is a valid code). */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashVerificationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function newPendingVerification(code: string, now: Date): PendingVerification {
  return {
    codeHash: hashVerificationCode(code),
    expiresAt: new Date(now.getTime() + WHATSAPP_CODE_TTL_MS).toISOString(),
    attempts: 0,
  };
}

export type VerifyOutcome = 'ok' | 'expired' | 'too_many_attempts' | 'mismatch';

export function checkVerificationCode(
  pending: PendingVerification,
  code: string,
  now: Date,
): VerifyOutcome {
  if (pending.attempts >= WHATSAPP_MAX_VERIFY_ATTEMPTS) return 'too_many_attempts';
  if (now.getTime() > Date.parse(pending.expiresAt)) return 'expired';
  return hashVerificationCode(code) === pending.codeHash ? 'ok' : 'mismatch';
}
