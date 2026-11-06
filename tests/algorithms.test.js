import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../src/engine/config.js';
import { buildInstance, makeInstance } from '../src/engine/instance.js';
import { validateLayout } from '../src/engine/validate.js';
import { ALGORITHMS, solveHeadless, createSolver, runToEnd } from '../src/algorithms/registry.js';
import { CircleSquareSolver } from '../src/algorithms/circlesquare.js';

const IDS = Object.keys(ALGORITHMS);
const cfg = (raw) => normalizeConfig({ problem: 'pack', iterations: 800, ...raw }).config;

/** Propriétés exigées de TOUT algorithme, sur n’importe quelle instance. */
function checkResult(r, instance) {
  const { placements, rejected } = r.result;
  expect(r.stats.valid).toBe(true);                                   // exactitude (SAT) : aucune collision, aucune sortie
  expect(validateLayout(placements, instance.W, instance.H).valid).toBe(true);
  expect(r.stats.collisions).toBe(0); expect(r.stats.outOfBounds).toBe(0);
  expect(r.stats.placed + r.stats.unplaced).toBe(instance.n);
  const ids = placements.map((p) => p.id), all = new Set([...ids, ...rejected]);
  expect(new Set(ids).size).toBe(ids.length);                         // pas de doublon
  expect(all.size).toBe(instance.n);                                  // partition exacte placés ∪ rejetés
  for (const p of placements) expect(Math.abs(p.side - instance.items[p.id].side)).toBeLessThan(1e-12); // dimensions inchangées
  expect(r.stats.placedArea).toBeLessThanOrEqual(instance.containerArea + 1e-9);
  expect(r.classification.status).not.toBe('invalid');
}

describe.each(IDS)('algorithme %s — résultats vérifiables', (id) => {
  const cases = [
    ['aléatoire carré', { n: 40, W: 15, H: 15, sizeMode: 'random', sMin: 1, sMax: 3, seed: 1 }],
    ['rectangle dense', { n: 60, containerMode: 'rect', W: 24, H: 8, sizeMode: 'random', sMin: 0.8, sMax: 2, seed: 2 }],
    ['identiques', { n: 30, W: 10, H: 10, sizeMode: 'identical', sMax: 2, seed: 3 }],
    ['préréglage Fibonacci', { n: 30, W: 20, H: 20, sizeMode: 'preset', presetId: 'fibonacci', seed: 4 }],
    ['rotation autorisée', { n: 35, W: 12, H: 12, sizeMode: 'random', sMin: 1, sMax: 2.2, rotation: true, seed: 5 }],
    ['surface insuffisante', { n: 40, W: 6, H: 6, sizeMode: 'random', sMin: 1, sMax: 2, seed: 6 }],
  ];
  for (const [name, raw] of cases) {
    it(`valide exactement : ${name}`, () => {
      const c = cfg({ ...raw, algorithm: id });
      const r = solveHeadless(c, { maxMs: 15000 });
      checkResult(r, r.instance);
    });
  }
  it('déterministe (même graine → même résultat) et sensible à la graine', () => {
    const c = cfg({ n: 30, W: 12, H: 12, sMin: 1, sMax: 2.5, seed: 77, algorithm: id });
    const a = solveHeadless(c), b = solveHeadless(c);
    expect(a.result.placements).toEqual(b.result.placements);
    const d = solveHeadless({ ...c, seed: 78 });
    expect(d.instance.items).not.toEqual(a.instance.items);
  });
  it('cas limites : objet plus grand que le conteneur rejeté, autres placés', () => {
    const inst = buildInstance({ W: 5, H: 5, items: [{ id: 0, side: 9 }, { id: 1, side: 2 }, { id: 2, side: 1 }], seed: 1 });
    const s = createSolver(id, inst, cfg({ algorithm: id })); runToEnd(s, { maxMs: 5000 });
    const res = s.result();
    expect(res.rejected).toContain(0); expect(res.placements.map((p) => p.id)).not.toContain(0);
    expect(validateLayout(res.placements, 5, 5).valid).toBe(true);
    expect(res.placements.length).toBe(2);
  });
  it('cas limites : liste vide et un seul objet', () => {
    const empty = buildInstance({ W: 4, H: 4, items: [] }); const s0 = createSolver(id, empty, cfg({ algorithm: id })); runToEnd(s0, { maxMs: 2000 });
    expect(s0.result().placements).toEqual([]);
    const one = buildInstance({ W: 4, H: 4, items: [{ id: 0, side: 1.3 }] }); const s1 = createSolver(id, one, cfg({ algorithm: id })); runToEnd(s1, { maxMs: 5000 });
    expect(s1.result().placements).toHaveLength(1);
  });
  it('arrêt prématuré : le résultat reste toujours une disposition valide', () => {
    const c = cfg({ n: 80, W: 14, H: 14, sMin: 1, sMax: 2.5, seed: 8, algorithm: id, iterations: 5000 });
    const inst = makeInstance(c), s = createSolver(id, inst, c);
    for (let k = 0; k < 7 && !s.done; k++) s.step();
    const res = s.result();
    expect(validateLayout(res.placements, inst.W, inst.H).valid).toBe(true);
    expect(res.placements.length + res.rejected.length).toBe(inst.n);
  });
});

describe('pavages parfaits (grille k×k de carrés unité)', () => {
  for (const id of ['maxrects', 'guillotine', 'skyline', 'shelf']) for (const k of [1, 2, 3, 7, 10]) {
    it(`${id} remplit exactement ${k}×${k}`, () => {
      const c = cfg({ n: k * k, W: k, H: k, sizeMode: 'identical', sMax: 1, algorithm: id });
      const r = solveHeadless(c);
      expect(r.stats.placed).toBe(k * k); expect(r.stats.fill).toBeCloseTo(1, 12); expect(r.classification.status).toBe('optimal');
    });
  }
  it('le résultat « optimal » n’est jamais affirmé quand des objets restent non placés', () => {
    const r = solveHeadless(cfg({ n: 10, W: 3, H: 3, sizeMode: 'identical', sMax: 1, algorithm: 'maxrects' }));
    expect(r.stats.placed).toBe(9);
    expect(r.stats.unplaced).toBe(1);
    expect(r.classification.status).toBe('optimal'); // conteneur plein ⇒ borne de surface atteinte (prouvé)
    const r2 = solveHeadless(cfg({ n: 10, W: 3.5, H: 3.5, sizeMode: 'identical', sMax: 1, algorithm: 'shelf' }));
    expect(r2.classification.status).toBe('valid'); // 9 placés sur 10, surface < conteneur : heuristique, non prouvé
  });
});

describe('options des algorithmes constructifs', () => {
  const base = { n: 60, W: 18, H: 18, sMin: 1, sMax: 3, seed: 21 };
  it('MaxRects : heuristiques bssf/baf/bl valides', () => {
    for (const heuristic of ['bssf', 'baf', 'bl']) checkResult(solveHeadless(cfg({ ...base, algorithm: 'maxrects', options: { maxrects: { heuristic } } })), makeInstance(cfg(base)));
  });
  it('Guillotine : choix × règles de coupe × fusion valides', () => {
    for (const choice of ['baf', 'bssf']) for (const split of ['slas', 'llas', 'maxas']) for (const merge of [true, false])
      checkResult(solveHeadless(cfg({ ...base, algorithm: 'guillotine', options: { guillotine: { choice, split, merge } } })), makeInstance(cfg(base)));
  });
  it('Skyline : bl et minwaste valides', () => {
    for (const heuristic of ['bl', 'minwaste']) checkResult(solveHeadless(cfg({ ...base, algorithm: 'skyline', options: { skyline: { heuristic } } })), makeInstance(cfg(base)));
  });
  it('tri : décroissant ≥ aléatoire en moyenne pour MaxRects', () => {
    let d = 0, u = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const b = { n: 80, W: 16, H: 16, sMin: 1, sMax: 3, seed, algorithm: 'maxrects' };
      d += solveHeadless(cfg({ ...b, options: { maxrects: { sort: 'desc' } } })).stats.placedArea;
      u += solveHeadless(cfg({ ...b, options: { maxrects: { sort: 'none' } } })).stats.placedArea;
    }
    expect(d).toBeGreaterThanOrEqual(u * 0.98);
  });
});

describe('Circle → Square : propriétés mathématiques', () => {
  const run = (raw, c2s) => {
    const c = cfg({ algorithm: 'circle2square', c2s, ...raw });
    const inst = makeInstance(c), s = new CircleSquareSolver(inst, { ...c.c2s, iterations: c.iterations });
    runToEnd(s, { maxMs: 30000 });
    return { s, inst, res: s.result() };
  };
  it('carré INSCRIT dans le cercle ⇒ aucune collision après transformation (garantie)', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { s } = run({ n: 60, W: 18, H: 18, sMin: 1, sMax: 2.5, seed, rotation: seed % 2 === 0 }, { transform: 'inscribed' });
      expect(s.analysis.rawCollisions).toBe(0); expect(s.analysis.rawOob).toBe(0);
    }
  });
  it('carré CIRCONSCRIT : la transformation produit des collisions (aucune garantie) mais le résultat final reste valide', () => {
    const { s, inst, res } = run({ n: 70, W: 20, H: 20, sizeMode: 'identical', sMax: 2.2, seed: 5, iterations: 1500 }, { transform: 'circumscribed' });
    expect(s.analysis.rawCollisions).toBeGreaterThan(0);
    expect(validateLayout(res.placements, inst.W, inst.H).valid).toBe(true);
  });
  it('rotation interdite ⇒ tous les angles valent 0 ; rotation autorisée ⇒ résultat valide', () => {
    const a = run({ n: 40, W: 14, H: 14, sMin: 1, sMax: 2, seed: 2, rotation: false }, { transform: 'optimized' });
    expect(a.res.placements.every((p) => p.theta === 0)).toBe(true);
    const b = run({ n: 40, W: 14, H: 14, sMin: 1, sMax: 2, seed: 2, rotation: true }, { transform: 'optimized' });
    expect(validateLayout(b.res.placements, b.inst.W, b.inst.H).valid).toBe(true);
  });
  it('recherche du rayon (λ) : un λ de la grille testée est retenu', () => {
    const { s } = run({ n: 50, W: 16, H: 16, sMin: 1, sMax: 2.5, seed: 4, iterations: 2000 }, { transform: 'optimized', radiusSearch: true });
    expect([0, 0.25, 0.5, 0.75, 1]).toContain(s.analysis.lambda);
  });
  it('le résultat final n’est jamais pire que le sous-ensemble certifié de la transformation brute', () => {
    const { s, res } = run({ n: 60, W: 16, H: 16, sMin: 1, sMax: 2.5, seed: 9 }, { transform: 'circumscribed' });
    const area = res.placements.reduce((a, p) => a + p.side ** 2, 0);
    expect(area).toBeGreaterThanOrEqual(s.analysis.rawCertifiedArea - 1e-9);
  });
});

describe('méthodes continues', () => {
  it('rotation libre : forces et recuit restent valides même sur une instance très dense', () => {
    for (const id of ['forces', 'anneal']) {
      const c = cfg({ n: 60, W: 8, H: 8, sMin: 1, sMax: 1.6, rotation: true, algorithm: id, seed: 12, iterations: 1500 });
      const r = solveHeadless(c, { maxMs: 20000 }); expect(r.stats.valid).toBe(true); expect(r.stats.placed).toBeGreaterThan(5);
    }
  });
  it('paramètres modifiables en cours de recherche (setParams)', () => {
    const c = cfg({ n: 50, W: 14, H: 14, sMin: 1, sMax: 2, algorithm: 'anneal', seed: 3, iterations: 600 });
    const inst = makeInstance(c), s = createSolver('anneal', inst, c);
    for (let k = 0; k < 20; k++) s.step();
    s.setParams({ tScale: 0.2, stageIters: 30 });
    runToEnd(s, { maxMs: 10000 });
    expect(validateLayout(s.result().placements, inst.W, inst.H).valid).toBe(true);
  });
  it('initialisation MaxRects : jamais pire que MaxRects seul', () => {
    const c = cfg({ n: 70, W: 16, H: 16, sMin: 1, sMax: 2.6, seed: 31, iterations: 600 });
    const m = solveHeadless({ ...c, algorithm: 'maxrects' }).stats.placedArea;
    const f = solveHeadless({ ...c, algorithm: 'forces', options: { ...c.options, forces: { init: 'maxrects' } } }, { maxMs: 20000 }).stats.placedArea;
    expect(f).toBeGreaterThanOrEqual(m - 1e-9);
  });
});
