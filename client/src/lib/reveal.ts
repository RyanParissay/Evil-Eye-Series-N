// client/src/lib/reveal.ts — pure list-reveal state machine for §2.5 list controls.

export type Reveal = 5 | 15 | 'all';

export interface RevealControlsView {
  visible: number;        // rows to slice
  showMore: boolean;      // VIEW MORE →
  showLess: boolean;      // VIEW LESS (always returns to 5)
  showAll: number | null; // VIEW ALL (n); null = hidden
}

export function nextRevealState(cur: Reveal): Reveal {
  return cur === 5 ? 15 : 'all';
}

export function revealControls(cur: Reveal, total: number): RevealControlsView {
  const visible = cur === 'all' ? total : Math.min(cur, total);
  return {
    visible,
    showMore: cur === 5 && total > 5,
    showLess: cur !== 5,
    showAll: cur === 15 && total > 15 ? total : null,
  };
}
