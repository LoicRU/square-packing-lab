import { describe, it, expect } from 'vitest';
import { nfpPolygon, strictlyInside, freeCenters, largestHole } from '../src/engine/nfp.js';
import { penetration } from '../src/engine/geometry.js';
import { verifyIndependent } from '../src/engine/verify.js';
import { validateLayout } from '../src/engine/validate.js';
import { createRng } from '../src/engine/rng.js';

const sq = (x, y, side = 1, theta = 0) => ({ x, y, side, theta });

describe('No-Fit Polygon', () => {
  it('somme de Minkowski de deux carrés : octogone convexe ≤ 8 sommets, aire correcte pour θ identiques', () => {
    const p = nfpPolygon(sq(0, 0, 1, 0), { side: 1, theta: 0 });
    expect(p).toHaveLength(4); // deux carrés alignés : carré de côté 2
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 12); expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 12);
    expect(nfpPolygon(sq(0, 0, 1, 0), { side: 1, theta: Math.PI / 4 }).length).toBeLessThanOrEqual(8);
  });
  it('P strictement dans le NFP ⇔ les carrés se chevauchent (SAT), 20 000 points', () => {
    const rng = createRng(11); let inside = 0, outside = 0;
    for (let i = 0; i < 20000; i++) {
      const B = sq(0, 0, rng.range(0.5, 1.5), rng.range(0, 3.2)), A = { side: rng.range(0.5, 1.5), theta: rng.range(0, 3.2) };
      const poly = nfpPolygon(B, A), px = rng.range(-2.2, 2.2), py = rng.range(-2.2, 2.2);
      const pen = penetration(B, { x: px, y: py, side: A.side, theta: A.theta });
      if (pen > 1e-6) { expect(strictlyInside(poly, px, py)).toBe(true); inside++; } else if (pen === 0) { expect(strictlyInside(poly, px, py)).toBe(false); outside++; }
    }
    expect(inside).toBeGreaterThan(1000); expect(outside).toBeGreaterThan(1000);
  });
});

describe('freeCenters / largestHole : décision exacte de l’existence d’une place', () => {
  const layout = (rng, n, W) => { // carrés valides générés par rejet
    const out = [];
    for (let t = 0; t < 4000 && out.length < n; t++) {
      const q = sq(rng.range(0.5, W - 0.5), rng.range(0.5, W - 0.5), 1, rng.range(0, 1.57));
      if (validateLayout([...out, q], W, W).valid) out.push(q);
    }
    return out;
  };
  it('tout point retourné est réellement libre (aucune pénétration, dans le conteneur)', () => {
    const rng = createRng(5);
    for (let k = 0; k < 15; k++) {
      const W = 5, L = layout(rng, 10, W), probe = { side: rng.range(0.3, 0.9), theta: rng.range(0, 1.5) };
      const { points } = freeCenters(L, W, probe);
      for (const [x, y] of points) {
        const q = { x, y, ...probe };
        expect(validateLayout([...L, q], W, W, 1e-7).valid).toBe(true);
      }
    }
  });
  it('complétude : si un point aléatoire est libre, la région libre est détectée non vide', () => {
    const rng = createRng(8); let tested = 0;
    for (let k = 0; k < 30; k++) {
      const W = 4.5, L = layout(rng, 9, W), probe = { side: rng.range(0.25, 0.8), theta: rng.range(0, 1.5) };
      let anyFree = false;
      for (let s = 0; s < 3000 && !anyFree; s++) {
        const q = { x: rng.range(0.4, W - 0.4), y: rng.range(0.4, W - 0.4), ...probe };
        if (validateLayout([...L, q], W, W, 0).valid) anyFree = true;
      }
      if (anyFree) { tested++; expect(freeCenters(L, W, probe).points.length).toBeGreaterThan(0); }
    }
    expect(tested).toBeGreaterThan(5);
  });
  it('grille 3×3 privée d’un carré : le trou de côté 1 est retrouvé', () => {
    const L = []; for (let i = 0; i < 9; i++) if (i !== 4) L.push(sq((i % 3) + 0.5, Math.floor(i / 3) + 0.5));
    const h = largestHole(L, 3, { angles: [0] });
    expect(h.side).toBeGreaterThan(0.999); expect(h.x).toBeCloseTo(1.5, 3); expect(h.y).toBeCloseTo(1.5, 3);
    expect(freeCenters(L, 3, { side: 1.01, theta: 0 }).points).toHaveLength(0);
  });
  it('grille complète : aucun carré non dégénéré ne peut être inséré', () => {
    const L = []; for (let i = 0; i < 9; i++) L.push(sq((i % 3) + 0.5, Math.floor(i / 3) + 0.5));
    const h = largestHole(L, 3, { angles: [0, Math.PI / 4] });
    expect(!h || h.side < 1e-2).toBe(true);
  });
  it('exclusion d’un carré : il peut revenir à sa propre place', () => {
    const L = [sq(0.5, 0.5), sq(1.5, 0.5), sq(0.5, 1.5)];
    const { points } = freeCenters(L, 2, { side: 1, theta: 0 }, { exclude: 1 });
    expect(points.some(([x, y]) => Math.abs(x - 1.5) < 1e-9 && Math.abs(y - 0.5) < 1e-9)).toBe(true);
  });
});

describe('vérificateur indépendant (découpage de polygones)', () => {
  it('grille valide, côtés égaux, angles dans [0,90)', () => {
    const L = []; for (let i = 0; i < 16; i++) L.push(sq((i % 4) + 0.5, Math.floor(i / 4) + 0.5, 1, 0));
    const v = verifyIndependent(L, 4, { expectedN: 16 });
    expect(v.valid).toBe(true); expect(v.overlaps).toBe(0); expect(v.sidesEqual).toBe(true);
  });
  it('détecte chevauchement, sortie, côtés différents, mauvais N', () => {
    expect(verifyIndependent([sq(0.5, 0.5), sq(1.2, 0.5)], 3).overlaps).toBe(1);
    expect(verifyIndependent([sq(0.2, 0.5)], 3).outOfBounds).toBe(1);
    expect(verifyIndependent([sq(0.5, 0.5, 1), sq(2, 2, 1.1)], 4).sidesEqual).toBe(false);
    expect(verifyIndependent([sq(0.5, 0.5)], 3, { expectedN: 2 }).valid).toBe(false);
  });
  it('configuration optimale de N = 5 (carré à 45°) : valide ; réduite : invalide', () => {
    const s = 2 + 1 / Math.SQRT2, mk = (S) => [sq(0.5, 0.5), sq(S - 0.5, 0.5), sq(0.5, S - 0.5), sq(S - 0.5, S - 0.5), sq(S / 2, S / 2, 1, Math.PI / 4)];
    expect(verifyIndependent(mk(s + 1e-9), s + 1e-9).valid).toBe(true);
    expect(verifyIndependent(mk(s - 0.01), s - 0.01).valid).toBe(false);
  });
  it('accord avec le validateur SAT sur 300 dispositions aléatoires (hors zone de tolérance)', () => {
    const rng = createRng(3); let agree = 0;
    for (let t = 0; t < 300; t++) {
      const W = 4, L = []; for (let i = 0; i < 8; i++) L.push(sq(rng.range(0.4, W - 0.4), rng.range(0.4, W - 0.4), 1, rng.range(0, 3.2)));
      const a = validateLayout(L, W, W, 1e-9), b = verifyIndependent(L, W);
      if (a.maxPenetration > 1e-6 || a.valid) { expect(b.valid).toBe(a.valid); agree++; }
    }
    expect(agree).toBeGreaterThan(200);
  });
  it('angles ramenés dans [0°, 90°)', () => {
    const v = verifyIndependent([sq(1, 1, 1, Math.PI / 2 + 0.3), sq(3, 1, 1, -0.2), sq(5, 1, 1, 7)], 6);
    for (const a of v.angles) { expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(90); }
    expect(v.anglesInRange).toBe(true);
  });
});
