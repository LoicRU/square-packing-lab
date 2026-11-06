import { describe, it, expect } from 'vitest';
import { PipelineSolver, PHASES } from '../src/algorithms/pipeline.js';
import { CirclePacker } from '../src/algorithms/circlepack.js';
import { validateLayout } from '../src/engine/validate.js';
import { verifyIndependent } from '../src/engine/verify.js';

function run(n, iterations, seed = 1, W = 20) {
  const s = new PipelineSolver({ n, W, seed, iterations }), frames = [];
  let guard = 0;
  while (!s.done && guard++ < 5e6) { s.step(); if (s.takeFrame()) { const v = s.view(); frames.push({ ph: v.extra.phaseIdx, sq: v.sq && Array.from(v.sq), circ: v.circ && Array.from(v.circ), morph: v.morph, it: v.metrics.iteration }); } }
  return { s, frames, W };
}
const check = (s, W, n) => {
  const r = s.result(), pl = r.placements;
  const a = validateLayout(pl.map((p) => ({ ...p })), W, W), b = verifyIndependent(pl, W, { expectedN: n });
  return { a, b, pl };
};

describe('CirclePacker', () => {
  for (const n of [17, 25, 50]) it(`N=${n} : disques identiques, sans chevauchement, certifiés`, () => {
    const c = new CirclePacker({ n, W: 1, seed: 2, iterations: 1500 });
    while (!c.done) c.step();
    expect(c.certify(c.hi)).toBe(true);
    expect(c.hi).toBeLessThanOrEqual(Math.ceil(Math.sqrt(n)) + 1e-9);
    expect(c.radiusFill).toBeLessThanOrEqual(0.9069 + 1e-6); // densité hexagonale = borne supérieure
  });
});

describe('Pipeline Circle → Square (5 phases)', () => {
  for (const n of [17, 25, 50]) it(`N=${n} : phases dans l'ordre, images intermédiaires réelles, résultat valide`, () => {
    const { s, frames, W } = run(n, n === 50 ? 4000 : 6000);
    // 1) toutes les phases apparaissent, dans l'ordre
    const seq = frames.map((f) => f.ph); expect([...new Set(seq)]).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
    // 2) les images sont de vrais états différents (pas un rejeu figé)
    const circ = frames.filter((f) => f.ph === 1 && f.circ);
    expect(circ.length).toBeGreaterThan(3);
    expect(new Set(circ.map((f) => f.circ.slice(0, 12).join(','))).size).toBeGreaterThan(3);
    const gen = frames.filter((f) => f.ph === 0); expect(gen[0].circ.length).toBeLessThan(gen[gen.length - 1].circ.length); // apparition progressive
    const tr = frames.filter((f) => f.ph === 2); expect(tr[0].morph).toBeLessThan(tr.find((f) => f.morph >= 1).morph); expect(tr.some((f) => f.morph > 0 && f.morph < 1)).toBe(true);
    // 3) statistiques par phase
    const st = s.analysis.phases; expect(st).toHaveLength(5); for (const p of st) { expect(p.S).toBeGreaterThan(0); expect(p.fill).toBeGreaterThan(0); expect(p.fill).toBeLessThanOrEqual(1 + 1e-9); expect(p.done).toBe(true); }
    expect(st[2].S).toBeCloseTo(st[1].S * Math.SQRT2, 9); // transformation = ×√2
    expect(st[4].S).toBeLessThanOrEqual(st[3].S + 1e-12); // l'optimisation finale ne dégrade jamais
    // 4) validité par DEUX méthodes indépendantes
    const { a, b, pl } = check(s, W, n);
    expect(a.valid).toBe(true); expect(b.valid).toBe(true);
    expect(b.sidesEqual && b.anglesInRange).toBe(true);
    expect(pl).toHaveLength(n);
    const k = Math.ceil(Math.sqrt(n)); expect(s.bestS).toBeLessThanOrEqual(k + 1e-9); expect(s.bestS).toBeGreaterThanOrEqual(Math.sqrt(n) - 1e-9);
    // 5) cohérence : côté mesuré = W / S
    expect(pl[0].side).toBeCloseTo(W / s.bestS, 9);
  }, 60000);

  it('N=100 : carré parfait → réseau 10×10 conservé (S = 10), valide', () => {
    const { s, W } = run(100, 3000);
    expect(s.bestS).toBeCloseTo(10, 6); const { a, b } = check(s, W, 100); expect(a.valid && b.valid).toBe(true);
  }, 60000);

  it('arrêt demandé : renvoie toujours une solution valide', () => {
    const s = new PipelineSolver({ n: 17, W: 20, seed: 3, iterations: 20000 });
    for (let i = 0; i < 200 && !s.done; i++) s.step();
    s.stop(); const { a, b } = check(s, 20, 17); expect(s.done).toBe(true); expect(a.valid && b.valid).toBe(true);
  });
  it('noms de phases exportés', () => { expect(PHASES).toHaveLength(5); });
});
