/**
 * AUTORITÉ DE VALIDATION — unique porte d'entrée de l'Elite Pool.
 * Indépendante des algorithmes : elle ne fait confiance à AUCUNE valeur annoncée par un worker
 * (taille, remplissage) et recalcule tout. Deux méthodes de collision indépendantes (SAT + grille,
 * puis intersection polygonale de Sutherland–Hodgman) doivent toutes deux conclure « valide ».
 *
 * Format d'une solution (unités : côté des petits carrés = 1, conteneur S × S) :
 *   { n, S, x:number[], y:number[], th:number[] }   (th en radians, replié dans [0, π/2))
 * La taille réelle des carrés dans un conteneur de côté L est s = L / S ; remplissage R = N / S² × 100.
 */
import { validateLayout } from '../engine/validate.js';
import { verifyIndependent } from '../engine/verify.js';

export const HALF_PI = Math.PI / 2;
export const MAX_N = 2000;
export const foldAngle = (t) => { const r = t % HALF_PI; return r < 0 ? r + HALF_PI : r; };

/** Renvoie une copie propre (Float64) ou null si le format est inexploitable. */
export function normalizeSolution(sol) {
  if (!sol || typeof sol !== 'object') return null;
  const { x, y, th } = sol, n = Array.isArray(x) || ArrayBuffer.isView(x) ? x.length : -1;
  if (n < 1 || n > MAX_N || !y || !th || y.length !== n || th.length !== n) return null;
  const out = { n, S: +sol.S, x: new Array(n), y: new Array(n), th: new Array(n) };
  for (let i = 0; i < n; i++) { out.x[i] = +x[i]; out.y[i] = +y[i]; out.th[i] = foldAngle(+th[i]); }
  return out;
}

/**
 * @returns {{ok:boolean, reasons:string[], solution:object|null, S:number, size:number, fill:number}}
 *  `size` = côté commun pour un conteneur L=1 (= 1/S) ; `fill` ∈ [0,1].
 */
export function judge(sol, { n = null, tol = 1e-9 } = {}) {
  const reasons = [], s = normalizeSolution(sol);
  if (!s) return { ok: false, reasons: ['format de solution invalide'], solution: null, S: NaN, size: NaN, fill: NaN };
  if (n !== null && s.n !== n) reasons.push(`${s.n} carrés au lieu de ${n}`);
  if (!(Number.isFinite(s.S) && s.S > 0)) reasons.push('taille de conteneur invalide');
  for (let i = 0; i < s.n; i++) if (![s.x[i], s.y[i], s.th[i]].every(Number.isFinite)) { reasons.push('coordonnée ou angle non fini'); break; }
  if (reasons.length) return { ok: false, reasons, solution: null, S: s.S, size: NaN, fill: NaN };
  if (s.S < Math.sqrt(s.n) - 1e-9) reasons.push('S < √N : contredit la borne d’aire (impossible)');
  const pl = s.x.map((_, i) => ({ id: i, x: s.x[i], y: s.y[i], side: 1, theta: s.th[i] }));
  const a = validateLayout(pl, s.S, s.S, tol);
  if (!a.valid) reasons.push(`SAT : ${a.pairs ? a.pairs.length : '?'} collision(s), ${a.oob ? a.oob.length : '?'} sortie(s)`);
  const b = verifyIndependent(pl, s.S, { expectedN: s.n, areaTol: 1e-9, boundTol: 1e-7 });
  if (!b.valid) reasons.push(`polygones : ${b.problems.join(' ; ')}`);
  const fill = s.n / (s.S * s.S);
  if (!(fill > 0 && fill <= 1 + 1e-9)) reasons.push('remplissage incohérent');
  return { ok: reasons.length === 0, reasons, solution: reasons.length ? null : s, S: s.S, size: 1 / s.S, fill };
}

/** Cohérence d'une taille/remplissage ANNONCÉS avec la solution réellement jugée. */
export function consistent(claimed, verdict, eps = 1e-6) {
  return !claimed || ((claimed.S === undefined || Math.abs(claimed.S - verdict.S) <= eps * verdict.S) && (claimed.fill === undefined || Math.abs(claimed.fill - verdict.fill) <= eps));
}
