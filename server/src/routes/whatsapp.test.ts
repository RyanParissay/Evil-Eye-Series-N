import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { WhatsAppData, WhatsAppDataStore } from '../notifications/subscriptionStore';
import type { WhatsAppSender } from '../notifications/whatsappSender';
import { apiErrorHandler } from './api';
import { createWhatsAppRouter } from './whatsapp';

const NOW = new Date('2026-07-11T12:00:00Z');

/** In-memory stand-in for WhatsAppStore, mirroring alertService.test.ts's FakeStore. */
class FakeStore implements WhatsAppDataStore {
  constructor(public data: WhatsAppData) {}
  async read(): Promise<WhatsAppData> {
    return this.data;
  }
  async update<T>(
    mutate: (
      data: WhatsAppData,
    ) => { data: WhatsAppData; result: T } | Promise<{ data: WhatsAppData; result: T }>,
  ): Promise<T> {
    const { data, result } = await mutate(this.data);
    this.data = data;
    return result;
  }
}

class FakeSender implements WhatsAppSender {
  readonly mode = 'console' as const;
  async send(): Promise<void> {}
}

function harness(data: WhatsAppData) {
  const store = new FakeStore(data);
  const app = express();
  app.use(express.json());
  app.use('/api/whatsapp', createWhatsAppRouter({ store, sender: new FakeSender(), now: () => NOW }));
  app.use(apiErrorHandler);
  return { app, store };
}

function emptyData(overrides: Partial<WhatsAppData> = {}): WhatsAppData {
  return { subscriptions: [], sentAlerts: [], lastDeliveryFailure: null, ...overrides };
}

describe('/api/whatsapp/status deliveryFailure', () => {
  it('is null when nothing has failed', async () => {
    const { app } = harness(emptyData());
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.status).toBe(200);
    expect(res.body.deliveryFailure).toBeNull();
  });

  it('surfaces the persisted sanitized failure', async () => {
    const { app } = harness(
      emptyData({
        lastDeliveryFailure: { at: '2026-07-11T11:55:00Z', detail: 'HTTP 400 — not a valid number' },
      }),
    );
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.status).toBe(200);
    expect(res.body.deliveryFailure).toEqual({
      at: '2026-07-11T11:55:00Z',
      detail: 'HTTP 400 — not a valid number',
    });
  });

  it('disconnect clears the failure along with the subscription', async () => {
    const { app } = harness(
      emptyData({
        subscriptions: [
          {
            phoneE164: '+14165551234',
            thresholdPercent: 2,
            verified: true,
            active: true,
            failedSendCount: 0,
            verification: null,
            sendTimestamps: [],
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          },
        ],
        lastDeliveryFailure: { at: '2026-07-11T11:55:00Z', detail: 'HTTP 400' },
      }),
    );
    const res = await request(app).delete('/api/whatsapp/disconnect');
    expect(res.status).toBe(200);
    expect(res.body.deliveryFailure).toBeNull();
  });
});
