import { useState } from 'react';
import { TradeView, reportLimited } from '../lib/api';
import { parseDollarsToCents } from '../lib/format';

interface LimitedPanelProps {
  trade: TradeView;
  onClose: () => void;
  refresh: () => void;
}

export function LimitedPanel({ trade, onClose, refresh }: LimitedPanelProps) {
  const [book, setBook] = useState<string | null>(null); // strict single-select
  const [amount, setAmount] = useState('');
  const [armed, setArmed] = useState(false);

  const cents = parseDollarsToCents(amount);
  const ready = book !== null && cents !== null;

  const onSend = () => {
    if (!ready || book === null || cents === null) return;
    if (!armed) {
      setArmed(true); // first click arms — yellow CONFIRM? ✓
      return;
    }
    void reportLimited(trade.id, book, cents).then(() => refresh());
    onClose(); // second click sends, then closes + resets (unmount)
  };

  const sendClass = !ready ? 'send-btn disabled' : armed ? 'send-btn armed' : 'send-btn ready';

  return (
    <div className="limited-panel">
      <div className="limited-label">
        WHICH BOOK LIMITED YOU? — ONE AT A TIME; REOPEN TO REPORT ANOTHER
      </div>
      <div className="book-chips">
        {trade.legs.map((leg) => (
          <button
            key={leg.book}
            className={leg.book === book ? 'book-chip selected' : 'book-chip'}
            onClick={() => {
              setBook(leg.book === book ? null : leg.book); // re-click deselects
              setArmed(false);
            }}
          >
            {leg.bookLabel ?? leg.book}
          </button>
        ))}
      </div>
      <div className="limited-label max">MAX BET THEY ALLOWED</div>
      <div className="limited-row">
        <input
          className="limited-input"
          placeholder="$25"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setArmed(false);
          }}
        />
        <button className={sendClass} disabled={!ready} onClick={onSend}>
          {armed ? 'CONFIRM? ✓' : '✓ SEND TO MODEL'}
        </button>
      </div>
    </div>
  );
}
