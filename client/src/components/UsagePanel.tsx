import type { ReactNode } from 'react';
import type { ScanMeta } from '../../../shared/types';

/**
 * The real cost meter: credits burned by the last scan, account totals from
 * The Odds API usage headers, and the scan priced in dollars.
 */
export function UsagePanel({ meta }: { meta: ScanMeta | null }) {
  const usage = meta?.usage ?? null;
  return (
    <section className="usage-panel" aria-label="API usage">
      <Stat label="Credits / scan" value={usage ? String(usage.creditsComputedThisScan) : '—'} />
      <Stat label="Est. cost" value={usage ? formatDollars(usage.estimatedDollarCost) : '—'} />
      <Stat
        label="Used total"
        value={usage?.requestsUsedTotal != null ? usage.requestsUsedTotal.toLocaleString() : '—'}
      />
      <Stat
        label="Remaining"
        value={
          usage?.requestsRemainingTotal != null
            ? usage.requestsRemainingTotal.toLocaleString()
            : '—'
        }
      />
      <Stat label="Last scan" value={meta ? formatTimestamp(meta.scannedAt) : 'never'}>
        {meta?.providerMode === 'mock' && <span className="chip chip-mock">Mock data</span>}
      </Stat>
    </section>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="micro-label">{label}</span>
      <span className="stat-value">
        {value}
        {children}
      </span>
    </div>
  );
}

function formatDollars(cost: number): string {
  if (cost === 0) return '$0';
  return cost >= 1 ? `~$${cost.toFixed(2)}` : `~$${cost.toFixed(3)}`;
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
