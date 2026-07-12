import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WhatsAppStore } from './subscriptionStore';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'whatsapp-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WhatsAppStore', () => {
  it('reads empty data when the file does not exist', async () => {
    const store = new WhatsAppStore(join(dir, 'whatsapp.json'));
    expect(await store.read()).toEqual({
      subscriptions: [],
      sentAlerts: [],
      lastDeliveryFailure: null,
    });
  });

  it('reads empty data when the file is corrupt', async () => {
    const file = join(dir, 'whatsapp.json');
    await writeFile(file, '{not json', 'utf8');
    expect(await new WhatsAppStore(file).read()).toEqual({
      subscriptions: [],
      sentAlerts: [],
      lastDeliveryFailure: null,
    });
  });

  it('update persists the new state and returns the mutator result', async () => {
    const file = join(dir, 'whatsapp.json');
    const store = new WhatsAppStore(file);
    const result = await store.update((data) => {
      data.sentAlerts.push({
        phoneE164: '+14165551234',
        fingerprint: 'fp',
        profitPct: 2.5,
        sentAt: '2026-07-09T12:00:00Z',
      });
      return { data, result: 'done' };
    });
    expect(result).toBe('done');
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.sentAlerts).toHaveLength(1);
  });

  it('serializes concurrent updates so none are lost', async () => {
    const store = new WhatsAppStore(join(dir, 'whatsapp.json'));
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.update((data) => {
          data.sentAlerts.push({
            phoneE164: '+14165551234',
            fingerprint: `fp-${i}`,
            profitPct: i,
            sentAt: '2026-07-09T12:00:00Z',
          });
          return { data, result: undefined };
        }),
      ),
    );
    expect((await store.read()).sentAlerts).toHaveLength(5);
  });

  it('a throwing mutator does not wedge later updates', async () => {
    const store = new WhatsAppStore(join(dir, 'whatsapp.json'));
    await expect(
      store.update(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await store.update((data) => ({ data, result: undefined }));
    expect(await store.read()).toEqual({
      subscriptions: [],
      sentAlerts: [],
      lastDeliveryFailure: null,
    });
  });
});
