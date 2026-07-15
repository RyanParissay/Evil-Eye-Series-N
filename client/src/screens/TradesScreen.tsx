import { useState } from 'react';
import { AppState } from '../lib/api';
import { LiveCard } from '../components/LiveCard';
import { PendingCard } from '../components/PendingCard';

interface TradesScreenProps {
  state: AppState | null;
  now: number;
  refresh: () => void;
}

export function TradesScreen({ state, now, refresh }: TradesScreenProps) {
  const [limitedOpenId, setLimitedOpenId] = useState<string | null>(null);
  const verified = state?.trades.verified ?? [];
  const pending = state?.trades.pending ?? [];
  return (
    <main>
      <h2 className="section-header">VERIFIED LIVE ({verified.length})</h2>
      {verified.map((t) => (
        <LiveCard
          key={t.id}
          trade={t}
          now={now}
          refresh={refresh}
          limitedOpen={limitedOpenId === t.id}
          onToggleLimited={() => setLimitedOpenId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
      <h2 className="section-header pending">PENDING VERIFICATION ({pending.length})</h2>
      {pending.map((t) => (
        <PendingCard key={t.id} trade={t} now={now} />
      ))}
    </main>
  );
}
