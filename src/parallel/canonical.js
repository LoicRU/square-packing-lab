/**
 * COMPARAISON GÉOMÉTRIQUE cohérente avec les symétries du problème :
 *  – les 8 symétries du conteneur carré (groupe diédral D4 : rotations de 90°, réflexions),
 *  – la permutation des carrés (ils sont identiques et non numérotés),
 *  – l'angle d'un carré est défini modulo 90°,
 *  – une homothétie de la même structure (compression) n'est PAS une nouvelle découverte :
 *    les positions sont comparées en fractions du conteneur.
 * dissimilarité = distance moyenne (en côtés de carré) d'un appariement glouton sous la meilleure
 * des 8 symétries, + 0,25 × écart d'angle moyen (en côtés/quart de tour).
 */
import { HALF_PI } from './authority.js';

const cyc = (a, b) => { const d = Math.abs(a - b) % HALF_PI; return Math.min(d, HALF_PI - d) / HALF_PI; }; // ∈ [0, 0.5]

/** Applique la symétrie k ∈ 0..7 de D4 à (fx, fy, θ) en fractions du conteneur. */
function sym(k, fx, fy, th) {
  let x = fx, y = fy, t = th;
  if (k & 4) { x = 1 - x; t = HALF_PI - t; } // réflexion
  for (let r = 0; r < (k & 3); r++) { const nx = 1 - y; y = x; x = nx; } // rotation 90° (θ inchangé mod 90°)
  return [x, y, ((t % HALF_PI) + HALF_PI) % HALF_PI];
}

/** Dissimilarité minimale sur les 8 symétries (0 = identiques à une symétrie/permutation près). */
export function dissimilarity(A, B) {
  if (A.n !== B.n) return Infinity;
  const n = A.n, S = (A.S + B.S) / 2, fa = new Float64Array(n * 3), fb = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { fa.set([A.x[i] / A.S, A.y[i] / A.S, A.th[i]], i * 3); fb.set([B.x[i] / B.S, B.y[i] / B.S, B.th[i]], i * 3); }
  let best = Infinity; const used = new Uint8Array(n);
  for (let k = 0; k < 8; k++) {
    used.fill(0); let tot = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, t] = sym(k, fa[i * 3], fa[i * 3 + 1], fa[i * 3 + 2]);
      let bj = -1, bd = Infinity;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const d = Math.hypot((x - fb[j * 3]) * S, (y - fb[j * 3 + 1]) * S) + 0.25 * cyc(t, fb[j * 3 + 2]);
        if (d < bd) { bd = d; bj = j; }
      }
      used[bj] = 1; tot += bd;
      if (tot / n > best) break; // élagage
    }
    best = Math.min(best, tot / n);
  }
  return best;
}

export const DUP_THRESHOLD = 0.06; // côtés de carré : en dessous, « même disposition »

/** Signature grossière invariante par D4/permutation (indexation, non décisive). */
export function signature(sol) {
  const bins = new Array(6).fill(0);
  for (let i = 0; i < sol.n; i++) { const m = Math.min(sol.th[i], HALF_PI - sol.th[i]); bins[Math.min(5, Math.floor((m / (HALF_PI / 2)) * 6))]++; }
  return `${sol.n}:${bins.join('.')}`;
}
