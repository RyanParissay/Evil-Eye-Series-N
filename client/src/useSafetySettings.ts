/**
 * Fetch-once hook for the Safety Score settings (Phase 17) — the same
 * fetch-on-mount pattern every page already repeats inline (FundPanel,
 * CadencePanel, BookmakerPanel, …), extracted once because five surfaces
 * need it: the FILTERED determination on opportunity cards, Risk Mode board
 * rows, and the cockpit all read the same current safeMode/threshold. Null
 * while loading or unreachable — callers degrade to "no FILTERED chip"
 * rather than guessing (see safetyDisplay.ts's isSafetyFiltered).
 */
import { useEffect, useState } from 'react';
import type { SafetySettings } from '../../shared/types';
import { fetchSafetySettings } from './api';

export function useSafetySettings(): SafetySettings | null {
  const [settings, setSettings] = useState<SafetySettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSafetySettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        // No settings yet (or server unreachable) — badges render without
        // a FILTERED chip; the safety score itself is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
