// client/src/hooks/useAnalytics.ts — poll GET /api/analytics every 5s (same
// contract as useAppState/useBrain): any error → null, the screen renders its
// calm degraded form. Re-fetches immediately when the profile or range changes.
import { useCallback, useEffect, useState } from 'react';
import { fetchAnalytics } from '../lib/api';
import type { AnalyticsView, RangeKey } from '../lib/analytics';

const POLL_MS = 5000;

export function useAnalytics(
  profileId: number | null, range: RangeKey,
): { view: AnalyticsView | null; refresh: () => void } {
  const [view, setView] = useState<AnalyticsView | null>(null);

  const refresh = useCallback(() => {
    if (profileId === null) return;
    void fetchAnalytics(profileId, range).then(setView);
  }, [profileId, range]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { view, refresh };
}
