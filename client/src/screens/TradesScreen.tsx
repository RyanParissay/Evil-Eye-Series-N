import { AppState } from '../lib/api';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state }: TradesScreenProps) {
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
    </main>
  );
}
