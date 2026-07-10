/**
 * HTTP boundary. Validates input, maps typed provider errors to HTTP
 * statuses, and never leaks the API key.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ApiErrorBody, ApiErrorCode } from '@shared/types';
import { ProviderError } from '../providers/OddsProvider';
import { parseScanRequest } from '../scan/scanRequest';
import { runScan, type ScanDeps } from '../scan/scanService';

export function createApiRouter(deps: ScanDeps): Router {
  const router = Router();

  router.post('/scan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // All body validation lives in parseScanRequest — new scan options are
      // added there, not here.
      const parsed = parseScanRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json(errorBody('bad_request', parsed.message));
        return;
      }
      res.json(await runScan(deps, parsed.request));
    } catch (err) {
      next(err);
    }
  });

  router.get('/last-scan', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ meta: await deps.store.read() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Maps typed errors to HTTP statuses; everything else becomes a 500. */
export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ProviderError) {
    const status: Record<string, number> = {
      invalid_api_key: 401,
      quota_exhausted: 429,
      network: 502,
    };
    res.status(status[err.code] ?? 502).json(errorBody(err.code, err.message));
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json(errorBody('internal', 'Unexpected server error'));
}

export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}
