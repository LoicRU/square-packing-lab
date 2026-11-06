import { describe, it, expect } from 'vitest';
import { penetration, satPenCS, containerExcess, corners, halfExtent } from '../src/engine/geometry.js';
import { validateLayout } from '../src/engine/validate.js';
import { createRng } from '../src/engine/rng.js';

const sq = (x, y, side = 1, theta = 0) => ({ x, y, side, theta });
const R2 = Math.SQRT2;

/** Référence INDÉPENDANTE : aire d'intersection de deux polygones convexes (Sutherland–Hodgman). */
function clip(subject, clipper) {
  let out = subject;
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length], inp = out; out = [];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const inter = (p, q) => {
      const A1 = q[1] - p[1], B1 = p[0] - q[0], C1 = A1 * p[0] + B1 * p[1];
      const A2 = b[1] - a[1], B2 = a[0] - b[0], C2 = A2 * a[0] + B2 * a[1], det = A1 * B2 - A2 * B1;
      return [(B2 * C1 - B1 * C2) / det, (A1 * C2 - A2 * C1) / det];
    };
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k], q = inp[(k + 1) % inp.length];
      if (inside(q)) { if (!inside(p)) out.push(inter(p, q)); out.push(q); } else if (inside(p)) out.push(inter(p, q));
    }
    if (!out.length) break;
  }
  return out;
}
const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(s) / 2; };
const overlapArea = (A, B) => { const r = clip(corners(A), corners(B)); return r.length > 2 ? polyArea(r) : 0; };

describe('SAT sur carrés tournés : cas géométriques exacts', () => {
  it('coin contre face : carré à 45° posé contre une face, tangent puis enfoncé', () => {
    // carré aligné [0,1]², carré à 45° dont la pointe gauche touche la face x=1
    const h = R2 / 2;
    expect(penetration(sq(0.5, 0.5), sq(1 + h, 0.5, 1, Math.PI / 4))).toBeLessThan(1e-12);
    expect(penetration(sq(0.5, 0.5), sq(1 + h - 0.01, 0.5, 1, Math.PI / 4))).toBeCloseTo(0.01, 10);
  });
  it('arête contre arête : deux carrés de même angle alignés le long de l’axe tourné', () => {
    for (const th of [0.3, 0.7, 1.1, Math.PI / 3]) {
      const c = Math.cos(th), s = Math.sin(th);
      expect(penetration(sq(0, 0, 1, th), sq(c, s, 1, th))).toBeLessThan(1e-12);
      expect(penetration(sq(0, 0, 1, th), sq(0.9 * c, 0.9 * s, 1, th))).toBeCloseTo(0.1, 10);
    }
  });
  it('coin contre coin : deux carrés à 45° pointe contre pointe', () => {
    expect(penetration(sq(0, 0, 1, Math.PI / 4), sq(R2, 0, 1, Math.PI / 4))).toBeLessThan(1e-12);
    expect(penetration(sq(0, 0, 1, Math.PI / 4), sq(R2 - 0.02, 0, 1, Math.PI / 4))).toBeGreaterThan(0.01);
  });
  it('configuration optimale de N = 5 : tangences exactes, s = 2 + 1/√2', () => {
    const s = 2 + 1 / R2, pl = [sq(0.5, 0.5), sq(s - 0.5, 0.5), sq(0.5, s - 0.5), sq(s - 0.5, s - 0.5), sq(s / 2, s / 2, 1, Math.PI / 4)];
    const v = validateLayout(pl, s, s);
    expect(v.valid).toBe(true);
    expect(v.maxPenetration).toBeLessThan(1e-9);
    const t = s - 1e-3, shrunk = [sq(0.5, 0.5), sq(t - 0.5, 0.5), sq(0.5, t - 0.5), sq(t - 0.5, t - 0.5), sq(t / 2, t / 2, 1, Math.PI / 4)];
    expect(validateLayout(shrunk, t, t).valid).toBe(false);
  });
  it('tangence vs quasi-tangence à 1e-9 près', () => {
    const th = 0.4, c = Math.cos(th), s = Math.sin(th);
    expect(penetration(sq(0, 0, 1, th), sq(c * (1 - 1e-7), s * (1 - 1e-7), 1, th))).toBeGreaterThan(1e-8);
    expect(penetration(sq(0, 0, 1, th), sq(c * (1 + 1e-7), s * (1 + 1e-7), 1, th))).toBe(0);
  });
});

describe('invariances', () => {
  it('rotation de 90° d’un carré = même carré (θ et θ + π/2)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 300; i++) {
      const A = sq(0, 0, 1, rng.range(0, 3)), B = sq(rng.range(-1.5, 1.5), rng.range(-1.5, 1.5), 1, rng.range(0, 3));
      expect(penetration({ ...A, theta: A.theta + Math.PI / 2 }, B)).toBeCloseTo(penetration(A, B), 9);
      expect(penetration(A, { ...B, theta: B.theta + Math.PI })).toBeCloseTo(penetration(A, B), 9);
    }
  });
  it('invariance par translation et par rotation d’ensemble', () => {
    const rng = createRng(9);
    for (let i = 0; i < 300; i++) {
      const A = sq(0, 0, 1, rng.range(0, 3)), B = sq(rng.range(-1.2, 1.2), rng.range(-1.2, 1.2), 1, rng.range(0, 3)), phi = rng.range(0, 6), c = Math.cos(phi), s = Math.sin(phi);
      const rot = (q) => ({ ...q, x: c * q.x - s * q.y + 5, y: s * q.x + c * q.y - 3, theta: q.theta + phi });
      expect(penetration(rot(A), rot(B))).toBeCloseTo(penetration(A, B), 9);
    }
  });
  it('la normale retournée sépare bien : déplacer B de pénétration·n rend les carrés tangents', () => {
    const rng = createRng(21), out = new Float64Array(2);
    for (let i = 0; i < 300; i++) {
      const A = sq(0, 0, 1, rng.range(0, 3)), B = sq(rng.range(-0.8, 0.8), rng.range(-0.8, 0.8), 1, rng.range(0, 3));
      const p = satPenCS(A.x, A.y, 1, Math.cos(A.theta), Math.sin(A.theta), B.x, B.y, 1, Math.cos(B.theta), Math.sin(B.theta), out);
      if (p <= 0) continue;
      expect(penetration(A, { ...B, x: B.x + out[0] * (p + 1e-9), y: B.y + out[1] * (p + 1e-9) })).toBe(0);
    }
  });
});

describe('SAT contre une référence indépendante (aire d’intersection polygonale)', () => {
  it('pénétration > 0 ⇔ aire d’intersection > 0 (10 000 paires aléatoires)', () => {
    const rng = createRng(2026); let overlap = 0, disjoint = 0;
    for (let i = 0; i < 10000; i++) {
      const A = sq(0, 0, 1, rng.range(0, 3.2)), B = sq(rng.range(-1.6, 1.6), rng.range(-1.6, 1.6), 1, rng.range(0, 3.2));
      const p = penetration(A, B), area = overlapArea(A, B);
      if (p > 1e-6) { expect(area).toBeGreaterThan(0); overlap++; } else if (p === 0) { expect(area).toBeLessThan(1e-9); disjoint++; }
    }
    expect(overlap).toBeGreaterThan(1000); expect(disjoint).toBeGreaterThan(1000);
  });
  it('tailles différentes', () => {
    const rng = createRng(77);
    for (let i = 0; i < 3000; i++) {
      const A = sq(0, 0, rng.range(0.4, 2), rng.range(0, 3.2)), B = sq(rng.range(-2, 2), rng.range(-2, 2), rng.range(0.4, 2), rng.range(0, 3.2));
      const p = penetration(A, B), area = overlapArea(A, B);
      if (p > 1e-6) expect(area).toBeGreaterThan(0); else if (p === 0) expect(area).toBeLessThan(1e-9);
    }
  });
});

describe('conteneur et rotations', () => {
  it('demi-étendue : maximale à 45° (√2/2), minimale à 0°', () => {
    expect(halfExtent(1, 0)).toBeCloseTo(0.5, 12); expect(halfExtent(1, Math.PI / 4)).toBeCloseTo(R2 / 2, 12); expect(halfExtent(1, Math.PI / 2)).toBeCloseTo(0.5, 12);
  });
  it('un carré à 45° ne tient pas dans un conteneur de côté 1.2 mais tient à 1.5', () => {
    expect(containerExcess(sq(0.6, 0.6, 1, Math.PI / 4), 1.2, 1.2)).toBeGreaterThan(0.1);
    expect(containerExcess(sq(0.75, 0.75, 1, Math.PI / 4), 1.5, 1.5)).toBe(0);
  });
  it('les sommets des carrés tournés restent dans la boîte [h, S−h] quand excès = 0', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const q = sq(rng.range(0, 4), rng.range(0, 4), 1, rng.range(0, 3.2));
      if (containerExcess(q, 4, 4) === 0) for (const [x, y] of corners(q)) { expect(x).toBeGreaterThanOrEqual(-1e-12); expect(x).toBeLessThanOrEqual(4 + 1e-12); expect(y).toBeGreaterThanOrEqual(-1e-12); expect(y).toBeLessThanOrEqual(4 + 1e-12); }
    }
  });
});
