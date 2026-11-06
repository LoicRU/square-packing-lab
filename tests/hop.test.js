import { describe, it, expect } from 'vitest';
import { HopSolver, gridLayout, expand, shake, relocate, transferFrom, isValid } from '../src/algorithms/hop.js';
import { polishSLP } from '../src/algorithms/slp.js';
import { stripSearch, stripLayout } from '../src/algorithms/strips.js';
import { Cycle } from '../src/parallel/task.js';
import { judge } from '../src/parallel/authority.js';
import { createRng } from '../src/engine/rng.js';

const start = (n) => { const c = stripSearch(n, { maxMs: 1500, keep: 4 })[0]; return c ? stripLayout(n, c) : gridLayout(n); };

describe('basin hopping : expansion – secousse – compression', () => {
  it('expand, shake et relocate restent valides', () => {
    const rng = createRng(3);
    for (const n of [5, 10, 17, 26]) {
      const L = start(n);
      expect(isValid(L)).toBe(true);
      const E = expand(L, 0.04); expect(isValid(E)).toBe(true); expect(E.S).toBeCloseTo(L.S * 1.04, 12);
      expect(isValid(shake(E, rng, 0.04))).toBe(true);
      expect(isValid(relocate(E, rng, 0))).toBe(true);
    }
  });
  it('transfert N+1 → N et N−1 → N : disposition valide de bon nombre de carrés', () => {
    const rng = createRng(5);
    const T1 = transferFrom(gridLayout(10), 9, rng); expect(T1.x.length).toBe(9); expect(isValid(T1)).toBe(true);
    const T2 = transferFrom(start(17), 18, rng); expect(T2 === null || (T2.x.length === 18 && isValid(T2))).toBe(true);
    expect(transferFrom(gridLayout(10), 20, rng)).toBeNull();
  });
  it('ne dégrade jamais le départ, reste valide et ≥ √N (N = 5, 10)', () => {
    for (const n of [5, 10]) {
      const h = new HopSolver({ n, seed: 2, init: gridLayout(n), budgetMs: 1500 }); const s0 = h.hi;
      while (!h.done) h.step();
      const b = { n, S: h.hi, x: h.bx, y: h.by, th: h.bth };
      expect(h.hi).toBeLessThanOrEqual(s0); expect(isValid(b)).toBe(true); expect(h.hi).toBeGreaterThanOrEqual(Math.sqrt(n));
      expect(judge({ n, S: b.S, x: Array.from(b.x), y: Array.from(b.y), th: Array.from(b.th) }, { n }).ok).toBe(true);
    }
  });
  it('N = 5 : ne descend jamais sous l\'optimum prouvé 2 + √2/2', () => {
    const h = new HopSolver({ n: 5, seed: 4, init: gridLayout(5), budgetMs: 2500 }); while (!h.done) h.step();
    expect(h.hi).toBeGreaterThanOrEqual(2 + Math.SQRT1_2 - 1e-6);
  });
  it('un cycle « hop » passe l\'autorité et finalize ne dégrade pas', () => {
    const c = new Cycle({ n: 12, seed: 9, strategy: 'hop', budgetMs: 1500, parents: [] }); while (!c.done) c.step(30);
    const b = c.best(), f = c.finalize();
    expect(f.sol.S).toBeLessThanOrEqual(b.S + 1e-12);
    expect(judge(f.sol, { n: 12 }).ok).toBe(true);
  });
  it('SLP depuis un départ très lâche : monotone, valide, sans dérive sous √N', () => {
    const rng = createRng(8), n = 9, S = 7, L = { n, S, x: [], y: [], th: [] };
    for (let i = 0; i < n; i++) for (let t = 0; t < 2000; t++) {
      const x = 0.8 + rng.next() * (S - 1.6), y = 0.8 + rng.next() * (S - 1.6), th = rng.next() * Math.PI / 2;
      const M = { S, x: [...L.x, x], y: [...L.y, y], th: [...L.th, th] }; if (isValid(M)) { L.x.push(x); L.y.push(y); L.th.push(th); break; }
    }
    expect(L.x.length).toBe(n);
    const P = polishSLP(L, { maxMs: 4000, maxIter: 400, r0: 0.15 });
    expect(P.S).toBeLessThan(S); expect(P.S).toBeGreaterThanOrEqual(3 * (1 + 1e-12)); expect(isValid({ n, S: P.S, x: P.x, y: P.y, th: P.th })).toBe(true);
  });
});
