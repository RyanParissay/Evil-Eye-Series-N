import { describe, expect, it } from 'vitest';
import { evaluateWeights, optimizeWeights } from './optimizer';

describe('optimizeWeights — determinism', () => {
  it('the same input produces the exact same output every time', () => {
    const seriesReturns = [
      [0.01, -0.02, 0.03, 0.01, -0.01],
      [0.005, 0.005, -0.01, 0.02, 0.0],
      [-0.01, 0.02, 0.01, -0.005, 0.015],
    ];
    const first = optimizeWeights(seriesReturns);
    const second = optimizeWeights(seriesReturns);
    expect(second).toEqual(first);
  });

  it('weights always sum to 1 and stay within [0, boundsPct]', () => {
    const seriesReturns = [
      [0.02, -0.01, 0.03],
      [0.01, 0.01, -0.02],
      [-0.02, 0.03, 0.01],
    ];
    const { weights } = optimizeWeights(seriesReturns, 70);
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });
});

describe('optimizeWeights — degenerate dominant-series case proves the bound holds', () => {
  it('a series with a strictly dominant, riskless return is capped at the 70% bound', () => {
    // Series 0 returns a constant positive 5% every period; series 1 and 2
    // never return anything. Any weighting's combined return is constant
    // (variance 0), so the score collapses to the mean — maximized by
    // pushing as much weight as the bound allows into series 0.
    const seriesReturns = [
      [0.05, 0.05, 0.05, 0.05, 0.05],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    const { weights, expectedReturn, volatility } = optimizeWeights(seriesReturns, 70);
    expect(weights[0]).toBeCloseTo(0.7, 6);
    expect(weights[0]).toBeLessThanOrEqual(0.7 + 1e-9);
    expect(weights[1] + weights[2]).toBeCloseTo(0.3, 6);
    expect(volatility).toBeCloseTo(0, 6);
    expect(expectedReturn).toBeCloseTo(0.7 * 0.05, 6);
  });

  it('a lower bound would cap the dominant series even tighter', () => {
    const seriesReturns = [
      [0.1, 0.1, 0.1],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const { weights } = optimizeWeights(seriesReturns, 40);
    expect(weights[0]).toBeCloseTo(0.4, 6);
  });
});

describe('optimizeWeights — mean/variance behavior', () => {
  it('favors a higher-mean series over a flatter one when both have similar spread', () => {
    const seriesReturns = [
      [0.03, -0.01, 0.03, -0.01],
      [0.005, -0.005, 0.005, -0.005],
      [0, 0, 0, 0],
    ];
    const { weights } = optimizeWeights(seriesReturns, 70);
    expect(weights[0]).toBeGreaterThan(weights[1]);
  });

  it('the returned weights score at least as well as several hand-picked alternatives', () => {
    // Not a degenerate case — three genuinely different, noisy streams, so
    // this is a real spot-check that the search actually optimizes rather
    // than assuming a particular (fragile) tie-broken weight vector.
    const seriesReturns = [
      [0.02, -0.01, 0.015, 0.005, -0.02, 0.03],
      [0.01, 0.02, -0.015, 0.0, 0.01, -0.005],
      [-0.005, 0.0, 0.02, 0.015, -0.01, 0.02],
    ];
    const optimal = optimizeWeights(seriesReturns, 70);
    const optimalScore = evaluateWeights(seriesReturns, optimal.weights).sharpe;

    const alternatives = [
      [0.34, 0.33, 0.33],
      [0.6, 0.2, 0.2],
      [0.2, 0.6, 0.2],
      [0.2, 0.2, 0.6],
      [0.7, 0.15, 0.15],
      [0, 0.5, 0.5],
    ];
    for (const alt of alternatives) {
      const score = evaluateWeights(seriesReturns, alt).sharpe;
      expect(optimalScore).toBeGreaterThanOrEqual(score - 1e-9);
    }
  });

  it('pads shorter series with zeros so every candidate scores over the same period count', () => {
    const seriesReturns = [[0.02, 0.02, 0.02, 0.02], [0.01], [0.01, -0.01]];
    // Should not throw, and should still produce a valid simplex.
    const { weights } = optimizeWeights(seriesReturns, 70);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('evaluateWeights', () => {
  it('computes mean, population std, and mean/std sharpe for a given weight vector', () => {
    const seriesReturns = [
      [0.02, -0.02],
      [0.0, 0.0],
    ];
    const result = evaluateWeights(seriesReturns, [1, 0]);
    expect(result.expectedReturn).toBeCloseTo(0, 6);
    expect(result.volatility).toBeCloseTo(0.02, 6);
    expect(result.sharpe).toBeCloseTo(0, 6);
  });

  it('falls back to the mean as the score when volatility is exactly 0', () => {
    const seriesReturns = [[0.03, 0.03, 0.03]];
    const result = evaluateWeights(seriesReturns, [1]);
    expect(result.volatility).toBe(0);
    expect(result.sharpe).toBeCloseTo(0.03, 6);
  });
});
