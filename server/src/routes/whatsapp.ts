/**
 * HTTP boundary for WhatsApp alert subscriptions. Single-user app: the API
 * manages at most one subscription, and the full phone number never leaves
 * the server after connect — status responses carry it masked.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { WhatsAppStatus } from '@shared/types';
import { WHATSAPP_MAX_VERIFY_ATTEMPTS } from '../config/constants';
import {
  checkVerificationCode,
  generateVerificationCode,
  newPendingVerification,
  type VerifyOutcome,
} from '../notifications/verification';
import type {
  WhatsAppDataStore,
  WhatsAppSubscription,
} from '../notifications/subscriptionStore';
import {
  maskPhone,
  parseConnectRequest,
  parseThresholdRequest,
  parseVerifyRequest,
} from '../notifications/whatsappRequests';
import type { WhatsAppSender } from '../notifications/whatsappSender';
import { errorBody } from './api';

export interface WhatsAppRouteDeps {
  store: WhatsAppDataStore;
  sender: WhatsAppSender;
  now?: () => Date;
}

export function createWhatsAppRouter(deps: WhatsAppRouteDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(statusOf(await currentSubscription(deps), deps.sender));
    } catch (err) {
      next(err);
    }
  });

  // Start (or restart) verification: create the subscription unverified and
  // send the code. The code is sent BEFORE the store write — if WhatsApp
  // delivery fails there's nothing to verify, so nothing should persist.
  router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseConnectRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const { phoneE164, thresholdPercent } = parsed.value;
      const code = generateVerificationCode();
      try {
        await deps.sender.send(
          phoneE164,
          `👁 Evil Eye Arbitrage verification code: ${code} (expires in 10 minutes)`,
        );
      } catch (err) {
        res.status(502).json(errorBody('provider_error', sendFailureMessage(err)));
        return;
      }
      const at = now();
      const subscription: WhatsAppSubscription = {
        phoneE164,
        thresholdPercent,
        verified: false,
        active: false,
        failedSendCount: 0,
        verification: newPendingVerification(code, at),
        sendTimestamps: [],
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      };
      const status = await deps.store.update((data) => {
        // Connect replaces whatever was there; dedup history survives only
        // if the same number reconnects.
        const next = {
          subscriptions: [subscription],
          sentAlerts: data.sentAlerts.filter((r) => r.phoneE164 === phoneE164),
        };
        return { data: next, result: statusOf(subscription, deps.sender) };
      });
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseVerifyRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      type VerifyResult = {
        kind: VerifyOutcome | 'no_pending';
        subscription: WhatsAppSubscription | null;
      };
      const outcome = await deps.store.update<VerifyResult>((data) => {
        const subscription = data.subscriptions[0];
        if (!subscription?.verification) {
          return { data, result: { kind: 'no_pending', subscription: null } };
        }
        const at = now();
        const check: VerifyOutcome = checkVerificationCode(
          subscription.verification,
          parsed.value.code,
          at,
        );
        if (check === 'ok') {
          subscription.verified = true;
          subscription.active = true;
          subscription.verification = null;
        } else if (check === 'mismatch') {
          subscription.verification.attempts += 1;
        }
        subscription.updatedAt = at.toISOString();
        return { data, result: { kind: check, subscription } };
      });

      if (outcome.kind === 'ok') {
        res.json(statusOf(outcome.subscription, deps.sender));
        return;
      }
      res.status(400).json(errorBody('bad_request', verifyFailureMessage(outcome)));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/threshold', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = parseThresholdRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      const status = await deps.store.update((data) => {
        const subscription = data.subscriptions[0];
        if (subscription) {
          subscription.thresholdPercent = parsed.value.thresholdPercent;
          subscription.updatedAt = now().toISOString();
        }
        return { data, result: subscription ? statusOf(subscription, deps.sender) : null };
      });
      if (!status) {
        res.status(400).json(errorBody('bad_request', 'No WhatsApp number connected'));
        return;
      }
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // A successful test proves delivery works again, so it also clears the
  // failure counter and reactivates a subscription that alert failures
  // paused — "send a test message" doubles as the recovery button.
  router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subscription = await currentSubscription(deps);
      if (!subscription?.verified) {
        res.status(400).json(errorBody('bad_request', 'No verified WhatsApp number to test'));
        return;
      }
      try {
        await deps.sender.send(
          subscription.phoneE164,
          '👁 Evil Eye Arbitrage test — alerts are wired up and working.',
        );
      } catch (err) {
        res.status(502).json(errorBody('provider_error', sendFailureMessage(err)));
        return;
      }
      const status = await deps.store.update((data) => {
        const sub = data.subscriptions[0];
        if (sub?.verified) {
          sub.failedSendCount = 0;
          sub.active = true;
          sub.updatedAt = now().toISOString();
        }
        return { data, result: sub ? statusOf(sub, deps.sender) : null };
      });
      res.json(status ?? statusOf(null, deps.sender));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/disconnect', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await deps.store.update(() => ({
        data: { subscriptions: [], sentAlerts: [] },
        result: statusOf(null, deps.sender),
      }));
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function currentSubscription(
  deps: WhatsAppRouteDeps,
): Promise<WhatsAppSubscription | null> {
  return (await deps.store.read()).subscriptions[0] ?? null;
}

function statusOf(
  subscription: WhatsAppSubscription | null,
  sender: WhatsAppSender,
): WhatsAppStatus {
  return {
    connected: !!subscription?.verified,
    active: !!subscription?.verified && subscription.active,
    pendingVerification: !!subscription && !subscription.verified && !!subscription.verification,
    phoneMasked: subscription ? maskPhone(subscription.phoneE164) : null,
    thresholdPercent: subscription?.thresholdPercent ?? null,
    devMode: sender.mode === 'console',
  };
}

function verifyFailureMessage(outcome: {
  kind: VerifyOutcome | 'no_pending';
  subscription: WhatsAppSubscription | null;
}): string {
  switch (outcome.kind) {
    case 'ok':
      return 'Verified'; // unreachable — the ok path responds before calling this
    case 'no_pending':
      return 'No verification in progress — connect a number first';
    case 'expired':
      return 'That code has expired — reconnect to get a new one';
    case 'too_many_attempts':
      return 'Too many wrong guesses — reconnect to get a new code';
    case 'mismatch': {
      const attempts = outcome.subscription?.verification?.attempts ?? 0;
      const left = Math.max(0, WHATSAPP_MAX_VERIFY_ATTEMPTS - attempts);
      return left > 0
        ? `Wrong code — ${left} attempt${left === 1 ? '' : 's'} left`
        : 'Too many wrong guesses — reconnect to get a new code';
    }
  }
}

/** Sender errors are safe to surface (the sender never embeds credentials). */
function sendFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'WhatsApp send failed';
}
