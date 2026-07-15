import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard key={t.id} trade={t} now={now} refresh={refresh} />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
    </main>
  );
}
