import { expect, test } from 'vitest';
import { passesToleranceGate } from './tolerance.js'; // ADAPTED from brief: NodeNext needs the .js extension
test('5% default: small weakening passes, big weakening fails', () => {
  expect(passesToleranceGate(0.0100, 0.0096, 5)).toBe(true);  // −4% relative
  expect(passesToleranceGate(0.0100, 0.0094, 5)).toBe(false); // −6% relative
});
test('100% ⇒ edge may get up to twice as weak (halve), not more', () => {
  expect(passesToleranceGate(0.0100, 0.0050, 100)).toBe(true);
  expect(passesToleranceGate(0.0100, 0.0049, 100)).toBe(false);
});
test('0% ⇒ no weakening allowed; improvement always passes', () => {
  expect(passesToleranceGate(0.0100, 0.0099, 0)).toBe(false);
  expect(passesToleranceGate(0.0100, 0.0130, 0)).toBe(true);
});
