// client/src/hooks/useAppState.ts — poll GET /api/state every 5s.
// Any error → state null (the UI renders its degraded-but-calm form; no banner).
import { useCallback, useEffect, useState } from 'react';
import { AppState, fetchState } from '../lib/api';

const POLL_MS = 5000;

export function useAppState(): { state: AppState | null; refresh: () => void } {
  const [state, setState] = useState<AppState | null>(null);

  const refresh = useCallback(() => {
    void fetchState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { state, refresh };
}
