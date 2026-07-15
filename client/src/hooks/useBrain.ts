// client/src/hooks/useBrain.ts — poll GET /api/brain every 5s (same contract as
// useAppState): any error → null, the screen renders its calm degraded form.
import { useCallback, useEffect, useState } from 'react';
import { fetchBrain } from '../lib/api';
import type { BrainView } from '../lib/brain';

const POLL_MS = 5000;

export function useBrain(): { brain: BrainView | null; refresh: () => void } {
  const [brain, setBrain] = useState<BrainView | null>(null);

  const refresh = useCallback(() => {
    void fetchBrain().then(setBrain);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { brain, refresh };
}
