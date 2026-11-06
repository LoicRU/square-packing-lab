import { describe, it, expect } from 'vitest';
import { MaxSizeSolver, solveMaxSize } from '../src/algorithms/maxsize.js';
import { validateLayout } from '../src/engine/validate.js';
import { classifyMaxSize, maxSizeLiterature } from '../src/engine/classify.js';
import { normalizeConfig, msIterationsFor } from '../src/engine/config.js';
import { BEST } from '../src/engine/known.js';

const check = (r, W = 20) => validateLayout(r.result.placements, W, W);

describe('problème « taille maximale » : propriétés', () => {
  it('N = k² : le réseau k × k est optimal (borne de surface), côté a = W/k', () => {
    for (const k of [1, 2, 3, 5, 7]) {
      const r = solveMaxSize({ n: k * k, W: 10, seed: 1, iterations: 100 });
      expect(r.S).toBeCloseTo(k, 12);
      expect(r.result.placements[0].side).toBeCloseTo(10 / k, 12);
      expect(check(r, 10).valid).toBe(true);
      expect(classifyMaxSize({ n: k * k, S: r.S, valid: true }).status).toBe('optimal');
    }
  });
  it('toujours valide, tous les carrés placés, pour N = 1…24 (budget court)', () => {
    for (let n = 1; n <= 24; n++) {
      const r = solveMaxSize({ n, W: 20, seed: n, iterations: 1500 });
      const v = check(r);
      expect(r.result.placements).toHaveLength(n);
      expect(v.valid).toBe(true);
      expect(v.pairs.length).toBe(0);
      expect(r.S).toBeGreaterThanOrEqual(Math.sqrt(n) - 1e-9); // borne de surface
      expect(r.S).toBeLessThanOrEqual(Math.ceil(Math.sqrt(n)) + 1e-9); // jamais pire que le réseau
    }
  });
  it('N = 5 : la rotation est exploitée (côté < 3, proche de 2 + 1/√2 ≈ 2,7071)', () => {
    const r = solveMaxSize({ n: 5, W: 20, seed: 1, iterations: 300000 });
    expect(check(r).valid).toBe(true);
    expect(r.S).toBeLessThan(2.75);
    expect(r.S).toBeGreaterThanOrEqual(BEST[5] - 1e-6); // jamais mieux que l'optimum prouvé
    expect(r.result.placements.some((p) => Math.abs(Math.sin(2 * p.theta)) > 0.5)).toBe(true); // au moins un carré franchement incliné
  }, 60000);
  it('la meilleure taille ne diminue jamais (dichotomie monotone)', () => {
    const r = solveMaxSize({ n: 7, W: 20, seed: 3, iterations: 6000 });
    for (let i = 1; i < r.history.length; i++) expect(r.history[i].S).toBeLessThan(r.history[i - 1].S);
  });
  it('encadrement : borne de surface ≤ S trouvé ≤ réseau', () => {
    const s = new MaxSizeSolver({ n: 10, W: 20, seed: 2, iterations: 4000 });
    while (!s.done) s.step();
    const a = s.analysis;
    expect(a.S).toBeGreaterThanOrEqual(Math.sqrt(10)); expect(a.S).toBeLessThanOrEqual(4); expect(a.attempts).toBeGreaterThan(0);
  });
  it('déterministe : même graine → même résultat', () => {
    const a = solveMaxSize({ n: 9 + 2, W: 20, seed: 7, iterations: 3000 }), b = solveMaxSize({ n: 11, W: 20, seed: 7, iterations: 3000 });
    expect(a.S).toBe(b.S);
  });
  it('arrêt utilisateur : conserve la meilleure solution valide', () => {
    const s = new MaxSizeSolver({ n: 12, W: 20, seed: 1, iterations: 100000 });
    for (let i = 0; i < 50; i++) s.step();
    s.stop();
    expect(s.done).toBe(true);
    expect(validateLayout(s.result().placements, 20, 20).valid).toBe(true);
  });
  it('vue animée : N carrés, angles finis, drapeaux de collision pendant la recherche', () => {
    const s = new MaxSizeSolver({ n: 14, W: 20, seed: 1, iterations: 100000 });
    for (let i = 0; i < 20; i++) s.step();
    const v = s.view();
    expect(v.sq.length).toBe(14 * 6);
    for (let i = 0; i < 14; i++) expect(Number.isFinite(v.sq[i * 6 + 4])).toBe(true);
    expect(v.metrics.collisions).toBe(0); // la meilleure solution n'a aucune collision
  });
  it('stratégies alternatives (recuit seul, Circle→Square) : solutions valides', () => {
    for (const strategy of ['anneal', 'circle']) {
      const r = solveMaxSize({ n: 8, W: 20, seed: 4, iterations: 3000, strategy });
      expect(check(r).valid).toBe(true);
    }
  });
  it('cas limites : N = 1 et grand conteneur', () => {
    const r = solveMaxSize({ n: 1, W: 1000, seed: 1 });
    expect(r.S).toBe(1); expect(r.result.placements[0].side).toBe(1000);
  });
  it('performance : N = 100, budget de 1 500 itérations, solution valide en moins de 20 s', () => {
    const r = solveMaxSize({ n: 100, W: 20, seed: 1, iterations: 1500 }, { maxMs: 20000 });
    expect(check(r).valid).toBe(true); expect(r.ms).toBeLessThan(25000);
  }, 40000);
});

describe('statuts : jamais d’optimalité sans preuve', () => {
  it('invalide', () => { expect(classifyMaxSize({ n: 5, S: 2.8, valid: false }).status).toBe('invalid'); });
  it('N non carré parfait et non prouvé (11, 17, 19…) : jamais « optimal »', () => {
    for (const n of [11, 13, 17, 18, 19, 26, 27, 29, 37]) expect(classifyMaxSize({ n, S: BEST[n], valid: true }).status).toBe('valid');
  });
  it('valeurs prouvées de la littérature (5, 10, 14…) : optimal seulement si S atteint la valeur', () => {
    expect(classifyMaxSize({ n: 5, S: BEST[5] * 1.0001, valid: true }).status).toBe('optimal');
    expect(classifyMaxSize({ n: 5, S: 2.9, valid: true }).status).toBe('valid');
    expect(classifyMaxSize({ n: 10, S: 3.79, valid: true }).status).toBe('valid');
  });
  it('littérature : écart relatif et avertissement si inférieur au record', () => {
    expect(maxSizeLiterature(5, 2.9).gapPct).toBeGreaterThan(5);
    expect(maxSizeLiterature(5, 2.5).text).toMatch(/vérifier/);
    expect(maxSizeLiterature(500, 30)).toBeNull();
  });
});

describe('configuration', () => {
  it('problème par défaut : taille maximale, rotation libre, conteneur carré', () => {
    const { config } = normalizeConfig({ containerMode: 'rect', W: 10, H: 4 });
    expect(config.problem).toBe('maxsize'); expect(config.rotation).toBe(true); expect(config.H).toBe(config.W);
  });
  it('budget automatique ≈ 4 M mouvements, borné', () => {
    expect(msIterationsFor({ n: 10, msIterations: 0 })).toBe(400000); expect(msIterationsFor({ n: 1000, msIterations: 0 })).toBe(5000); expect(msIterationsFor({ n: 10, msIterations: 777 })).toBe(777);
  });
});
