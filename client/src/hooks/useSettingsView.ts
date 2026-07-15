// client/src/hooks/useSettingsView.ts — poll GET /api/settings/view every 5s
// (same contract as useAppState/useBrain): any error → null, calm degraded form.
import { useCallback, useEffect, useState } from 'react';
import { fetchSettingsView } from '../lib/api';
import type { SettingsView } from '../lib/settings';

const POLL_MS = 5000;

export function useSettingsView(): { view: SettingsView | null; refresh: () => void } {
  const [view, setView] = useState<SettingsView | null>(null);

  const refresh = useCallback(() => {
    void fetchSettingsView().then(setView);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { view, refresh };
}
