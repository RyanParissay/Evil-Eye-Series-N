/**
 * HTTP boundary. Validates input, maps typed provider errors to HTTP
 * statuses, and never leaks the API key.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION_TAB, regionTabByKey } from '../../../shared/regionTabs';
import type { ApiErrorBody, ApiErrorCode } from '../../../shared/types';
import { MAX_TOP_N } from '../config/constants';
import { ProviderError } from '../providers/OddsProvider';
import { runScan, type ScanDeps } from '../scan/scanService';

export function createApiRouter(deps: ScanDeps): Router {
  const router = Router();

  router.post('/scan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const topN = Number(req.body?.topN);
      if (!Number.isInteger(topN) || topN < 1 || topN > MAX_TOP_N) {
        res.status(400).json(errorBody('bad_request', `topN must be an integer from 1 to ${MAX_TOP_N}`));
        return;
      }
      const tab = regionTabByKey(req.body?.regionTab ?? DEFAULT_REGION_TAB);
      if (!tab) {
        res.status(400).json(errorBody('bad_request', `Unknown regionTab: ${req.body?.regionTab}`));
        return;
      }
      res.json(await runScan(deps, { topN, regionTab: tab.key }));
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

function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}
