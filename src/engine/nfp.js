/**
 * No-Fit Polygon et recherche EXACTE des espaces libres pour carrés orientés.
 *
 * Pour un carré fixe B et un carré mobile A d'angle θ (centre de A = point P),
 * les positions de P qui font chevaucher A et B (intérieurs sécants) forment
 * l'INTÉRIEUR de la somme de Minkowski B ⊕ A : un polygone convexe (≤ 8 sommets),
 * le « No-Fit Polygon » (NFP). Toucher le bord est autorisé.
 *
 * Régions libres pour le centre de A = (rectangle des centres admissibles
 * [h, W−h]²) privé de l'union des intérieurs des NFP. Cet ensemble est fermé et
 * polygonal : s'il est non vide, il contient au moins un de ces points :
 *   – coins du rectangle des centres,
 *   – sommets des NFP,
 *   – intersections arête/arête de deux NFP,
 *   – intersections arête/bord du rectangle.
 * Tester ces candidats est donc une décision EXACTE de l'existence d'une place.
 */
import { corners, halfExtent } from './geometry.js';

const EPS = 1e-9;

/** Enveloppe convexe (chaîne monotone), sens anti-horaire, sans doublons. */
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/** NFP du carré fixe B = {x,y,side,theta} pour un carré mobile {side,theta} : polygone convexe CCW. */
export function nfpPolygon(B, A) {
  const cb = corners(B), ca = corners({ x: 0, y: 0, side: A.side, theta: A.theta }), pts = [];
  for (const u of cb) for (const v of ca) pts.push([u[0] + v[0], u[1] + v[1]]);
  return hull(pts);
}

/** Vrai si P est strictement à l'intérieur (de plus de EPS) du polygone convexe CCW. */
export function strictlyInside(poly, px, py, eps = EPS) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1;
    if ((ex * (py - a[1]) - ey * (px - a[0])) / len <= eps) return false;
  }
  return true;
}

function segIntersect(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1], den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den, u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return [a[0] + t * r0, a[1] + t * r1];
}

/**
 * Centres possibles pour poser un carré `probe` {side, theta} dans [0,W]² sans chevaucher
 * les carrés de `squares` (sauf l'indice `exclude`). Retourne les points-sommets de la
 * région libre (liste exacte des candidats valides, éventuellement tronquée à maxPoints).
 */
export function freeCenters(squares, W, probe, { exclude = -1, maxPoints = 600, H = W } = {}) {
  const h = halfExtent(probe.side, probe.theta), x0 = h, x1 = W - h, y0 = h, y1 = H - h;
  if (x1 < x0 - EPS || y1 < y0 - EPS) return { points: [], inner: [x0, y0, x1, y1] };
  const polys = [];
  for (let i = 0; i < squares.length; i++) {
    if (i === exclude) continue;
    const p = nfpPolygon(squares[i], probe);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const q of p) { if (q[0] < mnx) mnx = q[0]; if (q[0] > mxx) mxx = q[0]; if (q[1] < mny) mny = q[1]; if (q[1] > mxy) mxy = q[1]; }
    if (mxx < x0 - EPS || mnx > x1 + EPS || mxy < y0 - EPS || mny > y1 + EPS) continue; // hors zone utile
    polys.push({ p, bb: [mnx, mny, mxx, mxy] });
  }
  const cand = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const inInner = (q) => q[0] >= x0 - EPS && q[0] <= x1 + EPS && q[1] >= y0 - EPS && q[1] <= y1 + EPS;
  const border = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
  for (let i = 0; i < polys.length; i++) {
    const P = polys[i].p;
    for (const v of P) if (inInner(v)) cand.push(v);
    for (let a = 0; a < P.length; a++) {
      const e0 = P[a], e1 = P[(a + 1) % P.length];
      for (const bd of border) { const q = segIntersect(e0, e1, bd[0], bd[1]); if (q) cand.push(q); }
      for (let j = i + 1; j < polys.length; j++) {
        const A = polys[i].bb, B = polys[j].bb;
        if (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) continue;
        const Q = polys[j].p;
        for (let b = 0; b < Q.length; b++) { const q = segIntersect(e0, e1, Q[b], Q[(b + 1) % Q.length]); if (q && inInner(q)) cand.push(q); }
      }
    }
  }
  const out = [];
  for (const q of cand) {
    const px = Math.min(x1, Math.max(x0, q[0])), py = Math.min(y1, Math.max(y0, q[1]));
    let ok = true;
    for (let k = 0; k < polys.length; k++) {
      const b = polys[k].bb;
      if (px <= b[0] || px >= b[2] || py <= b[1] || py >= b[3]) continue;
      if (strictlyInside(polys[k].p, px, py)) { ok = false; break; }
    }
    if (ok) { out.push([px, py]); if (out.length >= maxPoints) break; }
  }
  return { points: out, inner: [x0, y0, x1, y1] };
}

/**
 * Plus grand carré d'angle donné (parmi `angles`) pouvant encore être inséré : dichotomie
 * sur son côté, décision exacte par freeCenters. Retourne { side, x, y, theta } ou null.
 * « Plus grand » est relatif aux angles testés (pas un maximum sur tous les angles).
 */
export function largestHole(squares, W, { angles = [0, Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8], maxSide = Infinity, iters = 14, H = W } = {}) {
  let best = null;
  for (const theta of angles) {
    let lo = 0, hi = Math.min(maxSide, W, H), found = null;
    const probe = (side) => { const r = freeCenters(squares, W, { side, theta }, { maxPoints: 1, H }); return r.points[0] || null; };
    if (!probe(1e-6)) continue;
    for (let k = 0; k < iters; k++) {
      const mid = (lo + hi) / 2, pt = probe(mid);
      if (pt) { lo = mid; found = { side: mid, x: pt[0], y: pt[1], theta }; } else hi = mid;
    }
    if (found && (!best || found.side > best.side)) best = found;
  }
  return best;
}
