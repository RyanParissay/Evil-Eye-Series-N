import { useEffect, useState } from 'react';
import { TradeView, confirmTrade, unconfirmTrade } from '../lib/api';

interface ConfirmButtonProps {
  trade: TradeView;
  refresh: () => void;
}

export function ConfirmButton({ trade, refresh }: ConfirmButtonProps) {
  // The yellow UNCONFIRM? step is purely local — 3 visual states over 2 API states.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (trade.status !== 'CONFIRMED') setArmed(false);
  }, [trade.status]);

  const onClick = () => {
    if (trade.status === 'CONFIRMED' && armed) {
      setArmed(false);
      void unconfirmTrade(trade.id).then(() => refresh());
    } else if (trade.status === 'CONFIRMED') {
      setArmed(true); // NO api call — arming is local
    } else {
      void confirmTrade(trade.id).then(() => refresh());
    }
  };

  if (trade.status === 'CONFIRMED' && armed) {
    return (
      <button className="confirm-btn state-unconfirm" onClick={onClick}>
        UNCONFIRM?
      </button>
    );
  }
  if (trade.status === 'CONFIRMED') {
    return (
      <button className="confirm-btn state-confirmed" onClick={onClick}>
        CONFIRMED ✓
      </button>
    );
  }
  return (
    <button className="confirm-btn state-confirm" onClick={onClick}>
      CONFIRM
    </button>
  );
}
