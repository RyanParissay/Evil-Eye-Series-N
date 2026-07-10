import { describe, expect, it } from 'vitest';
import { parseBookmakerPatch } from './bookmakerRequests';

describe('parseBookmakerPatch', () => {
  it('accepts any subset of valid fields', () => {
    expect(parseBookmakerPatch({ enabled: false })).toEqual({
      ok: true,
      patch: { enabled: false },
    });
    expect(parseBookmakerPatch({ balance: 250.505, status: 'limited', notes: ' capped ' })).toEqual({
      ok: true,
      patch: { balance: 250.51, status: 'limited', notes: 'capped' },
    });
  });

  it('accepts null balance to clear it', () => {
    expect(parseBookmakerPatch({ balance: null })).toEqual({ ok: true, patch: { balance: null } });
  });

  it('rejects an empty patch', () => {
    expect(parseBookmakerPatch({}).ok).toBe(false);
    expect(parseBookmakerPatch(null).ok).toBe(false);
  });

  it('rejects bad field values', () => {
    expect(parseBookmakerPatch({ enabled: 'yes' }).ok).toBe(false);
    expect(parseBookmakerPatch({ balance: -5 }).ok).toBe(false);
    expect(parseBookmakerPatch({ balance: 'lots' }).ok).toBe(false);
    expect(parseBookmakerPatch({ status: 'thriving' }).ok).toBe(false);
    expect(parseBookmakerPatch({ notes: 'x'.repeat(501) }).ok).toBe(false);
  });
});
