/**
 * HTTP-boundary tests: request validation and the ProviderError → status
 * mapping, exercised through a real Express app with a stub provider.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { OddsProvider, SportsResult } from '../providers/OddsProvider';
import { ProviderError } from '../providers/OddsProvider';
import type { ScanStore } from '../scan/scanStore';
import { apiErrorHandler, createApiRouter } from './api';

class FakeStore {
  async read() {
    return null;
  }
  async write() {}
}

/** A provider whose catalogue call fails the way we ask it to. */
function throwingProvider(err: unknown): OddsProvider {
  return {
    mode: 'live' as const,
    async listSports(): Promise<SportsResult> {
      throw err;
    },
    async fetchOdds(): Promise<never> {
      throw err;
    },
  };
}

function appWith(provider: OddsProvider) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ provider, store: new FakeStore() as unknown as ScanStore }));
  app.use(apiErrorHandler);
  return app;
}

const anyProvider = throwingProvider(new Error('unused'));

describe('POST /api/scan validation', () => {
  it('rejects a malformed body with 400 bad_request', async () => {
    for (const body of [{ topN: 'five' }, { topN: 99 }, { regionTab: 'atlantis' }]) {
      const res = await request(appWith(anyProvider)).post('/api/scan').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });
});

describe('apiErrorHandler mapping', () => {
  const cases = [
    { err: new ProviderError('bad key', 'invalid_api_key', 401), status: 401, code: 'invalid_api_key' },
    { err: new ProviderError('quota', 'quota_exhausted', 401), status: 429, code: 'quota_exhausted' },
    { err: new ProviderError('offline', 'network'), status: 502, code: 'network' },
    { err: new ProviderError('teapot', 'provider_error', 418), status: 502, code: 'provider_error' },
  ] as const;

  for (const { err, status, code } of cases) {
    it(`maps ProviderError ${err.code} to ${status}`, async () => {
      const res = await request(appWith(throwingProvider(err))).post('/api/scan').send({ topN: 5 });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });
  }

  it('maps anything else to 500 internal without leaking the message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appWith(throwingProvider(new Error('secret stack detail'))))
      .post('/api/scan')
      .send({ topN: 5 });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    vi.restoreAllMocks();
  });
});
