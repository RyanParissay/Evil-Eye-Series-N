/**
 * HTTP boundary for the P&L read model: aggregates + CSV export. Read-only.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { LedgerService } from '../ledger/ledgerService';

export function createLedgerRouter(ledger: LedgerService): Router {
  const router = Router();

  router.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await ledger.summarize());
    } catch (err) {
      next(err);
    }
  });

  router.get('/export.csv', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="evil-eye-ledger.csv"');
      await ledger.exportCsv((chunk) => res.write(chunk));
      res.end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
