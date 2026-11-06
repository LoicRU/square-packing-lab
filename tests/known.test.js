// Cohérence interne de la table des meilleures valeurs connues s(n) (garde-fou contre une faute de frappe qui ferait « battre la littérature »).
import { describe, it, expect } from 'vitest';
import { BEST, BEST_EXTRA, PROVEN, isProven, maxKnownCount, knownSide } from '../src/engine/known.js';
import { classifyMaxSize } from '../src/engine/classify.js';

describe('table s(n)', () => {
  const ns = Object.keys(BEST).map(Number).sort((a, b) => a - b);
  it('couvre 1..40 sans trou', () => { expect(ns).toEqual(Array.from({ length: 40 }, (_, i) => i + 1)); });
  it('borne d’aire √n ≤ s(n) ≤ ⌈√n⌉ (réseau)', () => { for (const n of ns) { expect(BEST[n]).toBeGreaterThanOrEqual(Math.sqrt(n) - 1e-12); expect(BEST[n]).toBeLessThanOrEqual(Math.ceil(Math.sqrt(n)) + 1e-12); } });
  it('croissante (plus de carrés ⇒ pas de conteneur plus petit)', () => { for (let i = 1; i < ns.length; i++) expect(BEST[ns[i]]).toBeGreaterThanOrEqual(BEST[ns[i - 1]] - 1e-12); });
  it('les valeurs prouvées sont listées, et k²−1, k²−2 (Nagamochi) valent k', () => {
    for (const n of PROVEN) expect(knownSide(n)).not.toBeNull();
    for (const k of [2, 3, 4, 5, 6]) { expect(BEST[k * k]).toBe(k); expect(BEST[k * k - 1]).toBe(k); if (k > 2) expect(BEST[k * k - 2]).toBe(k); }
  });
  it('valeurs exactes connues : s(5)=2+1/√2, s(10)=3+1/√2', () => { expect(BEST[5]).toBeCloseTo(2.70710678, 8); expect(BEST[10]).toBeCloseTo(3.70710678, 8); });
  it('valeurs mises à jour (page Friedman 2025-26) : 28, 29, 39, 41, 50', () => {
    expect(BEST[28]).toBeCloseTo(5.82444461667405, 12); expect(BEST[29]).toBeCloseTo(5.93383346267692, 12); expect(BEST[39]).toBeCloseTo(6.81072208306864, 12);
    expect(BEST_EXTRA[41]).toBeCloseTo(6.9266930944688, 12); expect(knownSide(50)).toBeCloseTo(7 + 4 / 7, 12); expect(knownSide(45)).toBeNull();
    for (const n of [28, 29, 39]) expect(isProven(n)).toBe(false);
    expect(BEST[28]).toBeLessThan(3 + 2 * Math.SQRT2); expect(BEST[28]).toBeGreaterThanOrEqual(Math.sqrt(28));
  });
  it('maxKnownCount est cohérent avec la table', () => { for (const n of ns) expect(maxKnownCount(BEST[n])).toBeGreaterThanOrEqual(n); expect(maxKnownCount(3.7)).toBeLessThan(10); });
  it('« optimal » n’est jamais annoncé sans preuve', () => {
    expect(classifyMaxSize({ n: 17, S: 4.6756, valid: true }).status).toBe('valid'); // meilleur connu, NON prouvé
    expect(classifyMaxSize({ n: 11, S: 3.8771, valid: true }).status).toBe('valid');
    expect(classifyMaxSize({ n: 10, S: BEST[10] + 1e-6, valid: true }).status).toBe('optimal'); // prouvé (Stromquist)
    expect(classifyMaxSize({ n: 16, S: 4, valid: true }).status).toBe('optimal'); // k²
    expect(classifyMaxSize({ n: 10, S: 3.6, valid: false }).status).toBe('invalid');
    expect(isProven(17)).toBe(false);
  });
});
