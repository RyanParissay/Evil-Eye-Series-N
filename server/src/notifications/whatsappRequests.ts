/**
 * Request-body validation for the WhatsApp routes — the notifications
 * counterpart of scan/scanRequest.ts. Also owns phone-number shaping:
 * E.164 normalization on the way in, masking on the way out.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Strip common separators, fold a 00 international prefix into +, and
 * validate E.164 (+ then 7–15 digits, no leading zero). Null on failure.
 */
export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** +14165551234 → +1••••••1234. First digit and last four survive. */
export function maskPhone(phoneE164: string): string {
  const digits = phoneE164.slice(1);
  if (digits.length <= 5) return `+${'•'.repeat(digits.length)}`;
  return `+${digits[0]}${'•'.repeat(digits.length - 5)}${digits.slice(-4)}`;
}

/** Profit-% threshold: finite, 0..100, kept to two decimals. Null on failure. */
export function parseThresholdPercent(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  return Math.round(raw * 100) / 100;
}

export interface ConnectRequest {
  phoneE164: string;
  thresholdPercent: number;
}

export function parseConnectRequest(body: unknown): ParseResult<ConnectRequest> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const phoneE164 = normalizePhoneE164(raw.phone);
  if (!phoneE164) {
    return { ok: false, message: 'phone must be a full international number like +14165551234' };
  }
  const thresholdPercent = parseThresholdPercent(raw.thresholdPercent);
  if (thresholdPercent == null) {
    return { ok: false, message: 'thresholdPercent must be a number from 0 to 100' };
  }
  return { ok: true, value: { phoneE164, thresholdPercent } };
}

export interface VerifyRequest {
  code: string;
}

export function parseVerifyRequest(body: unknown): ParseResult<VerifyRequest> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, message: 'code must be the 6-digit number from the WhatsApp message' };
  }
  return { ok: true, value: { code } };
}

export interface ThresholdRequest {
  thresholdPercent: number;
}

export function parseThresholdRequest(body: unknown): ParseResult<ThresholdRequest> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const thresholdPercent = parseThresholdPercent(raw.thresholdPercent);
  if (thresholdPercent == null) {
    return { ok: false, message: 'thresholdPercent must be a number from 0 to 100' };
  }
  return { ok: true, value: { thresholdPercent } };
}
