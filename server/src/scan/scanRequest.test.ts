import { describe, expect, it } from 'vitest';
import { MAX_TOP_N } from '../config/constants';
import { parseScanRequest } from './scanRequest';

describe('parseScanRequest', () => {
  it('accepts a valid body and resolves the region tab config', () => {
    const result = parseScanRequest({ topN: 5, regionTab: 'ca_us' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.topN).toBe(5);
    expect(result.request.tab.key).toBe('ca_us');
    expect(result.request.tab.apiRegions).toContain('us');
  });

  it('defaults the region tab when the body omits it', () => {
    const result = parseScanRequest({ topN: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.tab.key).toBe('ca');
  });

  it('rejects a missing or non-integer topN', () => {
    for (const body of [{}, { topN: 'five' }, { topN: 2.5 }, null, undefined]) {
      const result = parseScanRequest(body);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toMatch(/topN/);
    }
  });

  it('rejects topN outside 1..MAX_TOP_N', () => {
    expect(parseScanRequest({ topN: 0 }).ok).toBe(false);
    expect(parseScanRequest({ topN: MAX_TOP_N + 1 }).ok).toBe(false);
    expect(parseScanRequest({ topN: MAX_TOP_N }).ok).toBe(true);
  });

  it('rejects an unknown region tab by name', () => {
    const result = parseScanRequest({ topN: 5, regionTab: 'antarctica' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/antarctica/);
  });
});
