import { describe, it, expect } from 'vitest';
import { judge, foldAngle, normalizeSolution } from '../src/parallel/authority.js';
import { dissimilarity, DUP_THRESHOLD } from '../src/parallel/canonical.js';

const grid = (k, n = k * k) => ({ n, S: k, x: Array.from({ length: n }, (_, i) => (i % k) + 0.5), y: Array.from({ length: n }, (_, i) => Math.floor(i / k) + 0.5), th: new Array(n).fill(0) });

describe('autorité de validation', () => {
  it('accepte le réseau et recalcule taille/remplissage', () => {
    const v = judge(grid(3), { n: 9 }); expect(v.ok).toBe(true); expect(v.fill).toBeCloseTo(1, 12); expect(v.size).toBeCloseTo(1 / 3, 12);
  });
  it('carrés parallèles tangents : valides (tolérance ≠ intersection)', () => { expect(judge(grid(4, 13), { n: 13 }).ok).toBe(true); });
  it('rejette un chevauchement net, même minime (> tolérance)', () => {
    const g = grid(3); g.x[1] -= 1e-4; expect(judge(g).ok).toBe(false);
  });
  it('accepte un presque-tangent (1e-12) mais rejette 1e-6', () => {
    const g = grid(2); g.x[1] -= 1e-12; expect(judge(g).ok).toBe(true); g.x[1] -= 1e-6; expect(judge(g).ok).toBe(false);
  });
  it('rejette débordement, NaN, mauvais N, S < √N', () => {
    const g = grid(3); g.x[0] = 0.2; expect(judge(g).ok).toBe(false);
    const h = grid(3); h.y[2] = NaN; expect(judge(h).ok).toBe(false);
    expect(judge(grid(3), { n: 10 }).ok).toBe(false);
    expect(judge({ ...grid(3), S: 2.9 }).ok).toBe(false);
    expect(judge(null).ok).toBe(false); expect(judge({ x: [1], y: [1] }).ok).toBe(false);
  });
  it('rotations de 0° et 90° équivalentes ; angle replié', () => {
    const g = grid(3); g.th[4] = Math.PI / 2; expect(judge(g).ok).toBe(true);
    expect(foldAngle(-0.1)).toBeCloseTo(Math.PI / 2 - 0.1, 12); expect(normalizeSolution(g).th[4]).toBeCloseTo(0, 12);
  });
  it('carré tourné de 45° dans une case de côté 1 : rejeté (déborde sur les voisins)', () => {
    const g = grid(3); g.th[4] = Math.PI / 4; expect(judge(g).ok).toBe(false);
  });
  it('conteneur presque plein (N = k², S = k) valide ; S légèrement plus petit invalide', () => {
    expect(judge(grid(5)).ok).toBe(true); expect(judge({ ...grid(5), S: 5 - 1e-6 }).ok).toBe(false);
  });
});

describe('dissimilarité géométrique (symétries)', () => {
  const base = { n: 4, S: 2.8, x: [0.5, 1.9, 0.6, 1.8], y: [0.5, 0.6, 1.9, 1.7], th: [0.1, 0.5, 1.0, 0.0] };
  const rot = (s) => ({ ...s, x: s.y.map((v) => s.S - v), y: s.x.slice() }); // rotation 90°
  const refl = (s) => ({ ...s, x: s.x.map((v) => s.S - v), th: s.th.map((t) => Math.PI / 2 - t) });
  const perm = (s) => ({ ...s, x: [...s.x].reverse(), y: [...s.y].reverse(), th: [...s.th].reverse() });
  it('invariante par rotation 90°, réflexion, permutation', () => {
    expect(dissimilarity(base, rot(base))).toBeLessThan(1e-9);
    expect(dissimilarity(base, refl(base))).toBeLessThan(1e-9);
    expect(dissimilarity(base, perm(base))).toBeLessThan(1e-9);
    expect(dissimilarity(base, perm(rot(refl(base))))).toBeLessThan(1e-9);
  });
  it('invariante par compression homothétique ; distingue deux structures', () => {
    const c = { ...base, S: 2.7, x: base.x.map((v) => v * 2.7 / 2.8), y: base.y.map((v) => v * 2.7 / 2.8) };
    expect(dissimilarity(base, c)).toBeLessThan(DUP_THRESHOLD);
    const other = { ...base, x: [0.5, 0.5, 2.0, 2.0], y: [0.5, 2.0, 0.5, 2.0], th: [0.7, 0.2, 1.3, 0.9] };
    expect(dissimilarity(base, other)).toBeGreaterThan(DUP_THRESHOLD);
  });
});
