import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { BookmakerService } from '../bookmakers/bookmakerService';
import { apiErrorHandler } from './api';
import { createBookmakersRouter } from './bookmakers';

/** Registry with nothing in it — every key is unknown. */
const emptyService = {
  async list() {
    return [];
  },
  async patch() {
    return null;
  },
} as unknown as BookmakerService;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/bookmakers', createBookmakersRouter(emptyService));
  a.use(apiErrorHandler);
  return a;
}

describe('bookmakers routes', () => {
  it('PATCH of an unknown bookmaker is 404 not_found, not a validation error', async () => {
    const res = await request(app()).patch('/api/bookmakers/nope').send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('PATCH with a bad body stays 400 bad_request', async () => {
    const res = await request(app()).patch('/api/bookmakers/nope').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });
});
