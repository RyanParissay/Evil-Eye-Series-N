import { expect, test } from 'vitest';
import { nextRevealState, revealControls } from './reveal';

test('at 5 rows: single VIEW MORE → (when more exist)', () => {
  expect(revealControls(5, 18)).toEqual({ visible: 5, showMore: true, showLess: false, showAll: null });
  expect(nextRevealState(5)).toBe(15);
});

test('at 15 rows: VIEW LESS plus VIEW ALL (n) only when total > 15', () => {
  expect(revealControls(15, 18)).toEqual({ visible: 15, showMore: false, showLess: true, showAll: 18 });
  expect(revealControls(15, 12)).toEqual({ visible: 12, showMore: false, showLess: true, showAll: null });
  expect(nextRevealState(15)).toBe('all');
});

test('at full: VIEW LESS only', () => {
  expect(revealControls('all', 18)).toEqual({ visible: 18, showMore: false, showLess: true, showAll: null });
  expect(nextRevealState('all')).toBe('all');
});

test('tiny lists never show controls at the 5-state', () => {
  expect(revealControls(5, 3)).toEqual({ visible: 3, showMore: false, showLess: false, showAll: null });
  expect(revealControls(5, 5)).toEqual({ visible: 5, showMore: false, showLess: false, showAll: null });
});
