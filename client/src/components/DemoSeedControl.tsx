// Demo scaffolding (feat-demo-seed): a single button that backfills the sim
// board with simulated paper history so the beta preview never opens empty.
// Additive + simulation-only on the server side; this control is just the
// trigger + a status label, styled inline to match the dark theme tokens.
import { useState } from 'react';
import { seedDemo } from '../lib/api';

interface DemoSeedControlProps {
  refresh: () => void;
}

type Status = 'idle' | 'loading' | 'done' | 'unavailable';

const LABEL: Record<Status, string> = {
  idle: 'Load Demo Data',
  loading: 'Loading…',
  done: 'Demo data loaded',
  unavailable: 'Demo data unavailable',
};

export function DemoSeedControl({ refresh }: DemoSeedControlProps) {
  const [status, setStatus] = useState<Status>('idle');

  const onClick = () => {
    setStatus('loading');
    // seedDemo() resolves false when the server refuses (e.g. the live-mode
    // gate → 409) or on any network failure — only claim success when it took.
    void seedDemo().then((ok) => {
      setStatus(ok ? 'done' : 'unavailable');
      if (ok) refresh();
    });
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 16px', borderBottom: '1px solid var(--grey-divider)',
      }}
    >
      <button
        onClick={onClick}
        disabled={status === 'loading'}
        style={{
          background: 'var(--raised-bg)', color: 'var(--body-text)',
          border: '1px solid var(--grey-divider)',
          padding: '4px 10px', fontSize: '12px', cursor: status === 'loading' ? 'default' : 'pointer',
        }}
      >
        {LABEL[status]}
      </button>
      <span style={{ color: 'var(--muted-label)', fontSize: '11px' }}>
        Demo scaffolding — loads simulated history, not a live track record.
      </span>
    </div>
  );
}
