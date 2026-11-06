// Affinage continu SLP : toujours valide, jamais pire, respecte le temps, améliore une disposition lâche.
import { describe, it, expect } from 'vitest';
import { polishSLP } from '../src/algorithms/slp.js';
import { stripSearch, stripLayout } from '../src/algorithms/strips.js';
import { MaxSizeSolver } from '../src/algorithms/maxsize.js';
import { judge } from '../src/parallel/authority.js';
import { Cycle } from '../src/parallel/task.js';
import { createRng } from '../src/engine/rng.js';

const sol = (r) => ({ n: r.x.length, S: r.S, x: r.x, y: r.y, th: r.th });
const gridSol = (n) => { const k = Math.ceil(Math.sqrt(n)); return { n, S: k, x: Array.from({ length: n }, (_, i) => (i % k) + 0.5), y: Array.from({ length: n }, (_, i) => Math.floor(i / k) + 0.5), th: Array(n).fill(0) }; };
const heuristic = (n, ms, seed = 5) => { const s = new MaxSizeSolver({ n, W: 1, seed, iterations: 1e9, strategy: 'full', params: { effort: 6 } }); const t0 = performance.now(); while (!s.done && performance.now() - t0 < ms) s.step(); const b = s.best(); return { n, S: b.S, x: Array.from(b.x), y: Array.from(b.y), th: Array.from(b.th) }; };

describe('polishSLP', () => {
  it('N = 5 : améliore une solution heuristique, reste valide, ne descend jamais sous la borne d’aire', () => {
    const start = heuristic(5, 800), r = polishSLP(start, { maxMs: 3000 });
    expect(judge(sol(r), { n: 5 }).ok).toBe(true); expect(r.S).toBeLessThanOrEqual(start.S + 1e-12); expect(r.S).toBeGreaterThanOrEqual(Math.sqrt(5));
    expect(r.S).toBeGreaterThanOrEqual(2 + 1 / Math.SQRT2 - 1e-6); // s(5) = 2 + 1/√2 est un optimum DÉMONTRÉ : aller en dessous serait un bug de validité
  });
  it('N = 10 : se rapproche de s(10) = 3 + 1/√2 sans jamais passer dessous', () => {
    const start = heuristic(10, 1500), r = polishSLP(start, { maxMs: 4000 }), opt = 3 + 1 / Math.SQRT2;
    expect(judge(sol(r), { n: 10 }).ok).toBe(true); expect(r.S).toBeGreaterThanOrEqual(opt - 1e-6); expect(r.S).toBeLessThanOrEqual(start.S + 1e-12);
  });
  it('part d’un motif à bande inclinée (N = 17) : valide et strictement meilleur', () => {
    const L = stripLayout(17, stripSearch(17, { maxMs: 3000 })[0]), r = polishSLP(L, { maxMs: 4000 });
    expect(judge(sol(r), { n: 17 }).ok).toBe(true); expect(r.S).toBeLessThan(L.S - 1e-3); expect(r.S).toBeGreaterThanOrEqual(4.6756 - 1e-6); // jamais sous le meilleur connu
  });
  it('grille k × k parfaite : reste exactement valide et ne descend pas sous k (borne d’aire)', () => {
    const g = gridSol(16), r = polishSLP(g, { maxMs: 1500 }); expect(judge(sol(r), { n: 16 }).ok).toBe(true); expect(r.S).toBeGreaterThanOrEqual(4 - 1e-9);
  });
  it('fuzz : sur 25 dispositions valides variées, le résultat est toujours valide et jamais pire', () => {
    const rng = createRng(99);
    for (let k = 0; k < 25; k++) {
      const n = 3 + Math.floor(rng.next() * 12), start = heuristic(n, 150, 1 + k), r = polishSLP(start, { maxMs: 400 });
      expect(judge(sol(r), { n }).ok, `n=${n}`).toBe(true); expect(r.S).toBeLessThanOrEqual(start.S + 1e-12); expect(r.S).toBeGreaterThanOrEqual(Math.sqrt(n) - 1e-9);
    }
  }, 120000);
  it('respecte le budget de temps et accepte les cas dégénérés (N = 1, 2)', () => {
    const t = performance.now(); polishSLP(gridSol(30), { maxMs: 300 }); expect(performance.now() - t).toBeLessThan(2500);
    for (const n of [1, 2]) expect(judge(sol(polishSLP(gridSol(n), { maxMs: 200 })), { n }).ok).toBe(true);
  });
});

describe('Cycle.finalize', () => {
  it('l’affinage final ne dégrade jamais et reste valide', () => {
    const c = new Cycle({ n: 10, seed: 4, strategy: 'direct', budgetMs: 700 }); const t0 = performance.now(); while (!c.done && performance.now() - t0 < 4000) c.step();
    const b = c.best(), f = c.finalize(); expect(f.sol.S).toBeLessThanOrEqual(b.S + 1e-12); expect(judge(f.sol, { n: 10 }).ok).toBe(true); expect(f.gain).toBeGreaterThanOrEqual(0);
  }, 20000);
  it('pas d’affinage si polish:false ou arrêt demandé', () => {
    const c = new Cycle({ n: 10, seed: 4, strategy: 'direct', budgetMs: 300, polish: false }); c.step(); c.stop(); expect(c.finalize().gain).toBe(0);
  });
});
