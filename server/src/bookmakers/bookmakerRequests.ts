/**
 * Validation for PATCH /api/bookmakers/:key — the bookmaker counterpart of
 * scan/scanRequest.ts. A patch carries only the fields being changed.
 */
import type { BookmakerStatusValue } from '@shared/types';

const STATUSES: readonly BookmakerStatusValue[] = ['active', 'limited', 'dead'];
const MAX_NOTES_LENGTH = 500;

export interface BookmakerPatch {
  enabled?: boolean;
  balance?: number | null;
  status?: BookmakerStatusValue;
  notes?: string;
}

export type ParseBookmakerPatchResult =
  | { ok: true; patch: BookmakerPatch }
  | { ok: false; message: string };

export function parseBookmakerPatch(body: unknown): ParseBookmakerPatchResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: BookmakerPatch = {};

  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') {
      return { ok: false, message: 'enabled must be a boolean' };
    }
    patch.enabled = raw.enabled;
  }

  if ('balance' in raw) {
    if (raw.balance === null) {
      patch.balance = null;
    } else if (typeof raw.balance === 'number' && Number.isFinite(raw.balance) && raw.balance >= 0) {
      patch.balance = Math.round(raw.balance * 100) / 100;
    } else {
      return { ok: false, message: 'balance must be a non-negative number or null' };
    }
  }

  if ('status' in raw) {
    if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status as BookmakerStatusValue)) {
      return { ok: false, message: `status must be one of: ${STATUSES.join(', ')}` };
    }
    patch.status = raw.status as BookmakerStatusValue;
  }

  if ('notes' in raw) {
    if (typeof raw.notes !== 'string' || raw.notes.length > MAX_NOTES_LENGTH) {
      return { ok: false, message: `notes must be a string of at most ${MAX_NOTES_LENGTH} characters` };
    }
    patch.notes = raw.notes.trim();
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'patch must change at least one of: enabled, balance, status, notes' };
  }
  return { ok: true, patch };
}
