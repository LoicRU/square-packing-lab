/**
 * MOTIFS « BANDE INCLINÉE » — constructions déterministes de packings VALIDES par construction.
 *
 * Les meilleures dispositions connues de carrés unité dans un carré (Friedman) pour N = 17, 29, 39, 69, 88… sont une
 * grille avec une bande de w rangées de carrés inclinés d'un même angle θ. Ici on construit exactement ce motif :
 *   – bande : w rangées de carrés unité inclinés de θ, centrées sur une droite de direction θ (décalée de `off` du centre),
 *   – coin bas-gauche : cellules d'une grille alignée, ancrée en (0,0), du côté « bas » de la bande,
 *   – coin haut-droit : cellules d'une grille alignée, ancrée en (S,S), du côté « haut » de la bande.
 * Les deux grilles sont séparées par la dalle de la bande ⇒ aucun chevauchement par construction ; le nombre de carrés
 * obtenu est une fonction de (S, θ, w, off, phase). On cherche, par dichotomie sur S, le plus petit S qui en contient ≥ N,
 * puis on balaie θ, w, off et phase. Les résultats restent soumis à l'autorité de validation (jamais pris sur parole).
 *
 * Ce n'est PAS une preuve d'optimalité : c'est un générateur de points de départ de qualité (puis affinés par les solveurs).
 */
import { createRng } from '../engine/rng.js';

const D2R = Math.PI / 180;

/** Nombre de carrés du motif ; si `out` est fourni, y écrit les poses. */
export function stripCount(S, th, w, off, phase, out = null, shear = 0) {
  const c = Math.cos(th), s = Math.sin(th), ux = c, uy = s, vx = -s, vy = c;
  const px = S / 2 + off * vx, py = S / 2 + off * vy;
  const hb = 0.5 * (Math.abs(c) + Math.abs(s)), m = w / 2 + hb; // demi-étendue d'un carré (incliné ou aligné) / marge de la dalle
  let cnt = 0;
  const K = Math.floor(S + 1e-12);
  const push = (x, y, t) => { if (out) { out.x.push(x); out.y.push(y); out.th.push(t); } cnt++; };
  // bande
  const A = Math.ceil(1.5 * S) + 1;
  for (let a = -A; a <= A; a++) {
    for (let b = 0; b < w; b++) {
      const al = a + phase + b * shear, be = b - (w - 1) / 2;
      const x = px + al * ux + be * vx, y = py + al * uy + be * vy;
      if (x >= hb - 1e-12 && x <= S - hb + 1e-12 && y >= hb - 1e-12 && y <= S - hb + 1e-12) push(x, y, th);
    }
  }
  // grilles d'angle
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const x1 = i + 0.5, y1 = j + 0.5;
    if (vx * (x1 - px) + vy * (y1 - py) <= -m) push(x1, y1, 0);
    const x2 = S - i - 0.5, y2 = S - j - 0.5;
    if (vx * (x2 - px) + vy * (y2 - py) >= m) push(x2, y2, 0);
  }
  return cnt;
}

/** Plus petit S ∈ [lo, hi] tel que le motif contienne ≥ n carrés (dichotomie ; null si aucun). */
function minS(n, th, w, off, phase, lo, hi, shear = 0) {
  if (stripCount(hi, th, w, off, phase, null, shear) < n) return null;
  let a = lo, b = hi;
  for (let it = 0; it < 14; it++) { const mid = (a + b) / 2; if (stripCount(mid, th, w, off, phase, null, shear) >= n) b = mid; else a = mid; }
  return b;
}

/**
 * Balayage des motifs. Retourne les meilleurs candidats triés par S croissant :
 * [{ S, th, w, off, phase, count }]. Déterministe (aucun hasard) ; borné en temps par `maxMs`.
 */
export function stripSearch(n, { thStepDeg = 1, widths = [1, 2, 3, 4], offStep = 0.1, phases = 4, shears = [0, 0.5], keep = 24, maxMs = 4000, now = () => performance.now() } = {}) {
  const t0 = now(), lo = Math.sqrt(n), k = Math.ceil(lo - 1e-12), hi = k - 1e-4;
  if (hi - lo < 1e-9 || k * k === n) return []; // N = k² : la grille est déjà optimale
  const out = [];
  for (let d = -90 + thStepDeg / 2; d < 90; d += thStepDeg) {
    const th = d * D2R;
    for (const w of widths) {
      for (let off = -k / 2; off <= k / 2 + 1e-9; off += offStep) {
        for (const shear of (w > 1 ? shears : [0])) for (let q = 0; q < phases; q++) {
          const phase = q / phases, S = minS(n, th, w, off, phase, lo, hi, shear);
          if (S !== null) out.push({ S, th, w, off, phase, shear });
        }
      }
    }
    if (now() - t0 > maxMs) break;
  }
  out.sort((a, b) => a.S - b.S);
  // déduplication : même S (à 1e-4) et même angle (à 0,5°) = même famille
  const res = [];
  for (const c of out) { if (!res.some((r) => Math.abs(r.S - c.S) < 1e-4 && Math.abs(r.th - c.th) < 0.5 * D2R)) { c.count = stripCount(c.S, c.th, c.w, c.off, c.phase, null, c.shear); res.push(c); if (res.length >= keep) break; } }
  return res;
}

/** Construit la disposition (exactement n carrés) d'un candidat ; `rng` choisit quels carrés en surnombre retirer. */
export function stripLayout(n, cand, rng = createRng(1)) {
  const out = { x: [], y: [], th: [] };
  stripCount(cand.S, cand.th, cand.w, cand.off, cand.phase, out, cand.shear || 0);
  let m = out.x.length;
  if (m < n) return null;
  while (m > n) { const i = Math.floor(rng.next() * m); out.x.splice(i, 1); out.y.splice(i, 1); out.th.splice(i, 1); m--; }
  return { n, S: cand.S, x: out.x, y: out.y, th: out.th };
}
