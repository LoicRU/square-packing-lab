import { describe, it, expect } from 'vitest';
import { Coordinator } from '../src/parallel/coordinator.js';
import { MemoryStore } from '../src/parallel/memstore.js';
import { gridLayout } from '../src/algorithms/hop.js';
import { stripSearch, stripLayout } from '../src/algorithms/strips.js';

const make = (n, over = {}) => new Coordinator({ id: 'p', params: { n, sims: 4, seed: 5, mode: 'evolutionary', cycleMs: 2000, ...over }, spawn: () => ({ postMessage() {}, on() {}, terminate() {} }), store: new MemoryStore(), resources: () => ({ cpus: 4, load1: 0, freeMemMB: 4000 }), tickMs: 1000 });
const sub = (c, L) => c.pool.submit({ n: L.x.length, S: L.S, x: L.x, y: L.y, th: L.th }, { slot: 0, strategy: 'direct', t: 1 });
const plans = (c, k = 200) => Array.from({ length: k }, (_, i) => c.planCycle(c.slots[i % c.slots.length]));

describe('planification des cycles (exploration)', () => {
  it('pool réduit à la grille : 100 % de départs indépendants (muter la grille est inutile)', () => {
    const c = make(17); sub(c, gridLayout(17));
    expect(plans(c).every((p) => p.origin === 'random' && p.parents.length === 0)).toBe(true);
  });
  it('avec une vraie solution non triviale, les origines évolutives reviennent', () => {
    const c = make(17); const cand = stripSearch(17, { maxMs: 1500, keep: 2 })[0]; expect(cand).toBeTruthy();
    sub(c, stripLayout(17, cand));
    const ps = plans(c, 300); expect(ps.some((p) => p.origin !== 'random')).toBe(true); expect(ps.some((p) => p.origin === 'random')).toBe(true);
  });
  it('le hop n\'est tiré que s\'il est activé, et le bandit evoKind le suit', () => {
    const cand = (() => { const c0 = stripSearch(17, { maxMs: 1500, keep: 2 })[0]; return c0; })();
    const off = make(17, { strategies: ['direct', 'anneal'] }); sub(off, stripLayout(17, cand));
    expect(plans(off, 200).some((p) => p.strategy === 'hop')).toBe(false);
    const on = make(17, { strategies: ['direct', 'hop'] }); sub(on, stripLayout(17, cand));
    expect(plans(on, 200).some((p) => p.strategy === 'hop')).toBe(true);
    for (let i = 0; i < 60; i++) { on.evoKind.update('hop', 1, { outcome: 'record', ms: 1000 }); on.evoKind.update('evo', 0, { outcome: 'none', ms: 1000 }); }
    const share = (c) => plans(c, 400).filter((p) => p.origin !== 'random' && p.strategy === 'hop').length / Math.max(1, plans(c, 400).filter((p) => p.origin !== 'random').length);
    expect(share(on)).toBeGreaterThan(0.6);
  });
  it('stagnation prolongée : une part des cycles repart de zéro', () => {
    const c = make(17); const cand = stripSearch(17, { maxMs: 1500, keep: 2 })[0]; sub(c, stripLayout(17, cand));
    const base = plans(c, 600).filter((p) => p.origin === 'random').length;
    c.searchMs = 3e6; c.lastImproveMs = 0;
    const stag = plans(c, 600).filter((p) => p.origin === 'random').length;
    expect(stag).toBeGreaterThan(base);
  });
});
