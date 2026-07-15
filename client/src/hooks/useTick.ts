// client/src/hooks/useTick.ts — THE single shared 1s tick.
// Call once in App and pass `now` down as a prop; never mount a second interval.
import { useEffect, useState } from 'react';

export function useTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
