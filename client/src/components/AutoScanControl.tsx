/**
 * The auto-scan switch. As of Phase 16 this drives the SERVER-side scheduler
 * (ops setting scheduler.enabled) — the client owns no scan timer anymore.
 * Green is reserved app-wide for "surveillance is live", so the switch turns
 * green when the scheduler is on. A self-disable (spent quota / rejected key)
 * shows its stored reason with the switch flipped off; flipping it back on
 * clears the reason server-side and re-arms the scheduler.
 */
interface AutoScanControlProps {
  /** scheduler.enabled from the server. */
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** scheduler.disabledReason — non-null after a self-disable. */
  disabledReason: string | null;
  /** True while the enable PATCH is in flight. */
  busy?: boolean;
}

export function AutoScanControl({ enabled, onToggle, disabledReason, busy = false }: AutoScanControlProps) {
  return (
    <div className="auto-block">
      <div className="auto-head">
        <span className="micro-label" id="auto-update-label">
          Auto scan
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="auto-update-label"
          className="switch"
          disabled={busy}
          onClick={() => onToggle(!enabled)}
        >
          <span className="switch-thumb" aria-hidden="true" />
        </button>
        <span className="auto-live micro-label" role="status">
          {enabled ? (
            <>
              <span className="live-dot live-dot-pulse" aria-hidden="true" />
              Scheduler on
            </>
          ) : (
            'Scheduler off'
          )}
        </span>
      </div>

      {disabledReason && (
        <p className="micro-label cadence-error" role="alert">
          Auto scan stopped itself: {disabledReason}
        </p>
      )}
    </div>
  );
}
