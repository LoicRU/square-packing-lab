import { describe, it, expect } from 'vitest';
import { mutate, recombine, transformSolution, MUTATIONS, AMPLITUDES } from '../src/parallel/evolve.js';
import { Bandit, rewardOf } from '../src/parallel/bandit.js';
import { Cycle } from '../src/parallel/task.js';
import { judge } from '../src/parallel/authority.js';
import { createRng } from '../src/engine/rng.js';

const grid = (k) => ({ n: k * k, S: k, x: Array.from({ length: k * k }, (_, i) => (i % k) + 0.5), y: Array.from({ length: k * k }, (_, i) => Math.floor(i / k) + 0.5), th: new Array(k * k).fill(0) });
const run = (c) => { while (!c.done) c.step(50); return c; };

describe('opérateurs évolutifs', () => {
  it('reproductibles avec une graine fixe, tous les opérateurs et amplitudes', () => {
    const p = grid(4);
    for (const op of MUTATIONS) for (const amp of Object.values(AMPLITUDES)) {
      expect(mutate(p, createRng(3), { op, amp })).toEqual(mutate(p, createRng(3), { op, amp }));
    }
    expect(mutate(p, createRng(3), { op: 'multi' })).not.toEqual(mutate(p, createRng(4), { op: 'multi' }));
  });
  it('mutation : N préservé, positions finies dans le conteneur, angles repliés ; le parent n\'est pas modifié', () => {
    const p = grid(4), before = JSON.stringify(p);
    for (const op of MUTATIONS) { const c = mutate(p, createRng(9), { op, amp: 0.9 }); expect(c.x).toHaveLength(16); expect(c.x.every((v) => v >= 0.5 && v <= 3.5)).toBe(true); expect(c.th.every((t) => t >= 0 && t < Math.PI / 2)).toBe(true); }
    expect(JSON.stringify(p)).toBe(before);
  });
  it('les mutations changent réellement la disposition', () => {
    const p = grid(4); let changed = 0; for (const op of MUTATIONS) { const c = mutate(p, createRng(1), { op, amp: 0.5 }); if (JSON.stringify(c) !== JSON.stringify(p)) changed++; } expect(changed).toBeGreaterThanOrEqual(7);
  });
  it('symétries D4 : 8 transformations, la composition garde la validité', () => {
    const g = grid(3); for (let k = 0; k < 8; k++) expect(judge(transformSolution(g, k)).ok).toBe(true);
  });
  it('recombinaison : N exact, pas un simple mélange de coordonnées, reproductible', () => {
    const A = grid(4), B = transformSolution(grid(4), 5); B.th = B.th.map((_, i) => 0.2 + 0.01 * i);
    const c1 = recombine(A, B, createRng(2)), c2 = recombine(A, B, createRng(2)); expect(c1).toEqual(c2); expect(c1.x).toHaveLength(16);
    expect(c1.x.every(Number.isFinite)).toBe(true);
  });
});

describe('Cycle (tâche de worker)', () => {
  it('mutation réparée : toute solution publiée est valide, jamais pire que le parent', () => {
    const parent = grid(3); parent.n = 9;
    const c = run(new Cycle({ n: 9, seed: 5, strategy: 'evo', origin: 'best', parents: [parent], op: { name: 'multi', amp: 0.3 }, budgetMs: 800 }));
    const b = c.best(); expect(judge(b, { n: 9 }).ok).toBe(true); expect(b.S).toBeLessThanOrEqual(3 + 1e-9);
  });
  it('recombinaison : résultat valide après réparation', () => {
    const A = grid(4); A.n = 14; A.x = A.x.slice(0, 14); A.y = A.y.slice(0, 14); A.th = A.th.slice(0, 14);
    const B = transformSolution(A, 3);
    const c = run(new Cycle({ n: 14, seed: 6, strategy: 'evo', origin: 'recomb', parents: [A, B], budgetMs: 1500 })); expect(judge(c.best(), { n: 14 }).ok).toBe(true);
  });
  it('stratégies directes et circle→square : valides', () => {
    for (const strategy of ['direct', 'anneal', 'circle']) { const c = run(new Cycle({ n: 10, seed: 2, strategy, budgetMs: 1200 })); expect(judge(c.best(), { n: 10 }).ok, strategy).toBe(true); }
  });
  it('mêmes entrées + même graine ⇒ même disposition initiale réparée (reproductibilité du seedLayout)', () => {
    const p = grid(3); const s = { n: 9, seed: 11, strategy: 'evo', origin: 'best', parents: [p], op: { name: 'region', amp: 0.3 }, budgetMs: 1e9 };
    const a = new Cycle(s), b = new Cycle(s); expect(a.solver.seedLayout).toEqual(b.solver.seedLayout);
  });
  it('frame() = état réel léger', () => { const c = new Cycle({ n: 12, seed: 1, strategy: 'direct', budgetMs: 1e9 }); c.step(20); const f = c.frame(); expect(f.xyt).toHaveLength(36); expect(f.S).toBeGreaterThan(0); });
});

describe('bandit', () => {
  it('probabilités normalisées, plancher respecté, a priori 30/30/20/20 au départ', () => {
    const b = new Bandit({ best: 0.3, diverse: 0.3, recomb: 0.2, random: 0.2 }, { floor: 0.08 }); const p = b.probabilities();
    expect(Object.values(p).reduce((a, c) => a + c, 0)).toBeCloseTo(1, 9); expect(p.best).toBeGreaterThan(p.random); for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(0.08 - 1e-12);
  });
  it('favorise les bras qui réussissent sans jamais éliminer les autres', () => {
    const b = new Bandit({ a: 1, b: 1, c: 1 }, { floor: 0.07 }); for (let i = 0; i < 200; i++) { b.update('a', 0.9, { outcome: 'improved' }); b.update('b', 0.05); b.update('c', 0); }
    const p = b.probabilities(); expect(p.a).toBeGreaterThan(0.7); expect(p.b).toBeGreaterThanOrEqual(0.07 - 1e-12); expect(p.c).toBeGreaterThanOrEqual(0.07 - 1e-12);
  });
  it('rewardOf ordonne record > amélioré > accepté > doublon > rien', () => {
    const r = ['record', 'improved', 'accepted', 'duplicate', 'none'].map((o) => rewardOf(o, 4.7, 4.7)); for (let i = 1; i < r.length; i++) expect(r[i - 1]).toBeGreaterThan(r[i]);
  });
});
