import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../src/engine/config.js';
import { solveHeadless } from '../src/algorithms/registry.js';

/** Performances sur 10, 100, 500 et 1000 carrés (seuils volontairement larges, CI-friendly). */
const SIZES = [10, 100, 500, 1000];
const mk = (n, algorithm, extra = {}) => normalizeConfig({
  n, W: Math.sqrt(n) * 3.2, containerMode: 'square', sizeMode: 'random', sMin: 1, sMax: 3, seed: 5, algorithm, iterations: 400, limits: { maxN: 1000 }, ...extra,
}).config;

describe('performance & validité à grande échelle', () => {
  for (const n of SIZES) for (const id of ['maxrects', 'guillotine', 'skyline', 'shelf']) {
    it(`${id} n=${n} : exact et rapide`, () => {
      const r = solveHeadless(mk(n, id));
      expect(r.stats.valid).toBe(true);
      expect(r.stats.elapsedMs + r.verifyMs).toBeLessThan(n >= 1000 ? 8000 : 3000);
    });
  }
  for (const n of SIZES) for (const id of ['forces', 'anneal', 'circle2square']) {
    it(`${id} n=${n} : valide avec budget de temps (2,5 s)`, () => {
      const r = solveHeadless(mk(n, id), { maxMs: 2500 });
      expect(r.stats.valid).toBe(true);
      expect(r.stats.placed).toBeGreaterThan(0);
    });
  }
});
