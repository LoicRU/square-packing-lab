import { describe, it, expect } from 'vitest';
import { ElitePool } from '../src/parallel/elite.js';
import { createRng } from '../src/engine/rng.js';
import { MaxSizeSolver } from '../src/algorithms/maxsize.js';

const grid = (k, n = k * k) => ({ n, S: k, x: Array.from({ length: n }, (_, i) => (i % k) + 0.5), y: Array.from({ length: n }, (_, i) => Math.floor(i / k) + 0.5), th: new Array(n).fill(0) });
// disposition valide et structurellement différente : colonnes décalées (S = k + 0.5)
const shifted = (k, dx) => { const g = grid(k, k * k - 1); g.S = k + 0.5; g.x = g.x.map((v, i) => v + (Math.floor(i / k) % 2 ? 0.5 * dx : 0)); g.th = g.th.map((_, i) => (i % 3) * 0.02); return g; };
const solve = (n, seed) => { const s = new MaxSizeSolver({ n, W: 1, seed, iterations: 25000 }); while (!s.done) s.step(); const b = s.best(); return { n, S: b.S, x: Array.from(b.x), y: Array.from(b.y), th: Array.from(b.th) }; };

describe('Elite Pool', () => {
  it('rejette une solution invalide, garde le record', () => {
    const p = new ElitePool({ n: 9 }); expect(p.submit(grid(3)).status).toBe('record');
    const bad = grid(3); bad.x[1] -= 0.3; const r = p.submit(bad); expect(r.status).toBe('invalid'); expect(p.bestS).toBe(3);
  });
  it('rejette une taille annoncée mensongère', () => {
    const p = new ElitePool({ n: 9 }); expect(p.submit(grid(3), {}, { S: 2.5 }).status).toBe('invalid');
  });
  it('doublon géométrique (rotation 90° + permutation) : non compté comme nouvelle découverte', () => {
    const a = solve(7, 1), p = new ElitePool({ n: 7 }); expect(p.submit(a).status).toBe('record');
    const rot = { ...a, x: a.y.map((v) => a.S - v), y: a.x.slice() }; rot.x.reverse(); rot.y.reverse(); rot.th.reverse();
    expect(p.submit(rot).status).toBe('duplicate'); expect(p.entries.length).toBe(1);
  });
  it('solution moins bonne mais distincte : conservée (diverse/elite) ; record intact', () => {
    const p = new ElitePool({ n: 10 }); const g = grid(4, 10); p.submit(solve(10, 3)); const rec = p.bestS;
    const r = p.submit({ ...g }); expect(['accepted', 'record']).toContain(r.status); expect(p.entries.length).toBeGreaterThanOrEqual(2); expect(p.bestS).toBeLessThanOrEqual(rec);
  });
  it('le record ne régresse jamais et n\'est jamais évincé (capacités minuscules)', () => {
    const p = new ElitePool({ n: 6, maxElite: 1, maxDiverse: 1, maxHistorical: 1 }); const rng = createRng(5); let prev = Infinity; const recId = [];
    for (let i = 0; i < 12; i++) { const s = solve(6, 1 + i); p.submit(s); expect(p.bestS).toBeLessThanOrEqual(prev + 1e-12); prev = p.bestS; recId.push(p.record.id); }
    expect(p.record).toBeTruthy(); expect(p.entries.length).toBeLessThanOrEqual(1 + 1 + 1 + 1 + 1);
    expect(p.entries.filter((e) => e.category === 'record')).toHaveLength(1); void rng;
  });
  it('sélection de parents diversifiée et reproductible', () => {
    const p = new ElitePool({ n: 10 }); for (let i = 1; i <= 4; i++) p.submit(solve(10, i)); expect(p.entries.length).toBeGreaterThan(2);
    const a = p.selectParents(createRng(7), 3).map((e) => e.id), b = p.selectParents(createRng(7), 3).map((e) => e.id);
    expect(a).toEqual(b); expect(new Set(a).size).toBe(a.length);
    const seen = new Set(); for (let s = 1; s < 40; s++) seen.add(p.selectParents(createRng(s), 1)[0].id); expect(seen.size).toBeGreaterThan(1); // pas toujours le meilleur
  });
  it('sérialisation aller-retour', () => {
    const p = new ElitePool({ n: 5 }); p.submit(solve(5, 1)); const q = ElitePool.fromJSON(JSON.parse(JSON.stringify(p.toJSON()))); expect(q.bestS).toBe(p.bestS); expect(q.submit(solve(5, 1)).status).toBe('duplicate');
  });
});
