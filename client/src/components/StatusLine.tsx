import { AppState, deriveStatusLine } from '../lib/api';

interface StatusLineProps {
  state: AppState | null;
}

export function StatusLine({ state }: StatusLineProps) {
  const { nextScanText } = deriveStatusLine(state);
  return (
    <div className="status-line">
      NEXT SCAN <span className="time">{nextScanText}</span>
    </div>
  );
}
