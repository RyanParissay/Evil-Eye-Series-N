import type { RecordSafety, SafetySettings } from '../../../shared/types';
import { isSafetyFiltered, reasonLabel, scoreLabel } from '../safetyDisplay';

/**
 * Score badge + expandable breakdown (Phase 17 deliverable 1). Renders
 * NOTHING when `safety` is absent — a record that was never scored is not
 * the same as a record that scored 0 (REJECTED). Every SafetyComponent's
 * `detail` string is pre-formatted server-side ("−30: leg 2 is 5.1% off
 * consensus") and rendered verbatim; this component adds no money math and
 * no re-derivation of the score.
 *
 * `settings` (safeMode/safetyThreshold) is optional — while it hasn't
 * loaded yet the FILTERED chip simply doesn't render (isSafetyFiltered
 * treats a null settings as "not filtered", never a guess).
 */
export function SafetyBadge({
  safety,
  settings,
  compact = false,
}: {
  safety?: RecordSafety;
  settings?: Pick<SafetySettings, 'safeMode' | 'safetyThreshold'> | null;
  compact?: boolean;
}) {
  if (!safety) return null;
  const filtered = isSafetyFiltered(safety, settings ?? null);

  return (
    <details className={`safety-badge${compact ? ' safety-badge-compact' : ''}`}>
      <summary className="safety-badge-summary">
        <span className={`safety-score${safety.score === 0 ? ' is-rejected' : ''}`}>
          {scoreLabel(safety.score)}
        </span>
        {filtered && (
          <span
            className="chip chip-amber safety-filtered-chip"
            title="Confirmed and persisted, but the safety gate declined to alert or auto-purchase it at current settings."
          >
            FILTERED
          </span>
        )}
      </summary>
      <div className="safety-breakdown">
        {safety.reasons.length > 0 && (
          <p className="safety-reasons micro-label">
            hard reject — {safety.reasons.map(reasonLabel).join(' · ')}
          </p>
        )}
        <ul className="safety-components">
          {safety.components.map((component, i) => (
            <li key={`${component.key}-${i}`}>{component.detail}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
