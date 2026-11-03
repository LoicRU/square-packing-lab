/**
 * EXPANSION – SECOUSSE – COMPRESSION (basin hopping) avec affinage SLP dans la boucle.
 *
 *  1. expansion : le conteneur grandit de δ et les centres sont dilatés autour de son centre → disposition
 *     valide par construction (les distances entre carrés ne font que croître, les murs aussi) ;
 *  2. secousse : petits déplacements / rotations (annulés par dichotomie s'ils créent un chevauchement),
 *     éventuellement un carré retiré puis replacé dans un vide ;
 *  3. compression : polishSLP (toujours valide, strictement décroissant) resserre le tout.
 *  Une nouvelle disposition remplace la courante si elle est meilleure (ou presque, avec une faible
 *  probabilité, pour franchir des cols) ; la meilleure est conservée à part.
 *
 * Transfert entre N : retirer un carré à un packing de N+1 ou en insérer un dans un packing de N−1
 * (le conteneur est dilaté juste assez), puis laisser la boucle ci-dessus compresser.
 *
 * Tout est revalidé (validateLayout) avant d'être gardé ; aucune optimalité n'est revendiquée.
 */
import { polishSLP } from './slp.js';
import { validateLayout } from '../engine/validate.js';
import { createRng } from '../engine/rng.js';

const toPl = (L) => L.x.map((x, i) => ({ x, y: L.y[i], side: 1, theta: L.th[i] }));
export const isValid = (L, S = L.S) => S >= Math.sqrt(L.x.length) * (1 + 1e-12) && validateLayout(toPl(L), S, S, 1e-10).valid;
const clone = (L) => ({ n: L.x.length, S: L.S, x: Array.from(L.x), y: Array.from(L.y), th: Array.from(L.th) });

/** Grille alignée ⌈√n⌉ × ⌈√n⌉ (toujours valide). */
export function gridLayout(n) {
  const k = Math.ceil(Math.sqrt(n)), x = [], y = [], th = [];
  for (let i = 0; i < n; i++) { x.push((i % k) + 0.5); y.push(Math.floor(i / k) + 0.5); th.push(0); }
  return { n, S: k, x, y, th };
}

/** Dilate la disposition (centres et conteneur) du facteur 1+δ : valide si l'entrée l'est. */
export function expand(L, delta) {
  const f = 1 + delta, S2 = L.S * f, c = L.S / 2, c2 = S2 / 2;
  return { n: L.x.length, S: S2, x: L.x.map((v) => c2 + (v - c) * f), y: L.y.map((v) => c2 + (v - c) * f), th: Array.from(L.th) };
}

/** Secoue une disposition expansée de δ ; garantit la validité (dichotomie de l'amplitude, au pire aucune secousse). */
export function shake(L, rng, delta, share = 1) {
  for (let a = 0.35 * delta, k = 0; k < 6; k++, a /= 2) {
    const M = clone(L);
    for (let i = 0; i < M.n; i++) {
      if (rng.next() > share) continue;
      M.x[i] += (rng.next() * 2 - 1) * a; M.y[i] += (rng.next() * 2 - 1) * a; M.th[i] += (rng.next() * 2 - 1) * a * 1.2;
    }
    if (isValid(M)) return M;
  }
  return clone(L);
}

/** Fait tourner un groupe de carrés voisins (rayon ρ) autour de son centroïde : introduit des angles différents ; reste valide (amplitude réduite par dichotomie). */
export function rotateCluster(L, rng, delta) {
  const n = L.x.length, c = Math.floor(rng.next() * n), rho = 1.4 + 1.6 * rng.next(), idx = [];
  for (let j = 0; j < n; j++) if (Math.hypot(L.x[j] - L.x[c], L.y[j] - L.y[c]) <= rho) idx.push(j);
  if (idx.length < 2) return clone(L);
  const mx = idx.reduce((a, j) => a + L.x[j], 0) / idx.length, my = idx.reduce((a, j) => a + L.y[j], 0) / idx.length;
  for (let a = (rng.next() < 0.5 ? -1 : 1) * Math.max(0.03, 0.9 * delta / rho), k = 0; k < 7; k++, a /= 2) {
    const M = clone(L), co = Math.cos(a), si = Math.sin(a);
    for (const j of idx) { const dx = L.x[j] - mx, dy = L.y[j] - my; M.x[j] = mx + dx * co - dy * si; M.y[j] = my + dx * si + dy * co; M.th[j] = L.th[j] + a; }
    if (isValid(M)) return M;
  }
  return clone(L);
}

/** Position libre pour un carré unité dans L (échantillonnage) ; renvoie {x,y,th} ou null. */
function freeSpot(L, rng, tries = 300) {
  const n = L.x.length, h = 0.5;
  for (let t = 0; t < tries; t++) {
    const x = h + rng.next() * (L.S - 2 * h), y = h + rng.next() * (L.S - 2 * h), th = t % 3 === 0 ? 0 : rng.next() * Math.PI / 2;
    const M = { x: [...L.x, x], y: [...L.y, y], th: [...L.th, th], S: L.S };
    if (isValid(M)) return { x, y, th };
  }
  void n; return null;
}

/** Retire le carré i et le replace dans un vide (ou, à défaut, à sa place) ; la disposition reste valide. */
export function relocate(L, rng, i) {
  const R = { S: L.S, x: L.x.filter((_, j) => j !== i), y: L.y.filter((_, j) => j !== i), th: L.th.filter((_, j) => j !== i) };
  const p = freeSpot(R, rng); if (!p) return clone(L);
  R.x.push(p.x); R.y.push(p.y); R.th.push(p.th); return { n: L.x.length, ...R };
}

/** Packing de n carrés à partir d'un packing de n+1 (en retire un) ou de n−1 (en insère un) ; null si impossible. */
export function transferFrom(src, n, rng) {
  const m = src.x.length;
  if (m === n + 1) { const i = Math.floor(rng.next() * m); return { n, S: src.S, x: src.x.filter((_, j) => j !== i), y: src.y.filter((_, j) => j !== i), th: src.th.filter((_, j) => j !== i) }; }
  if (m === n - 1) {
    const cap = Math.ceil(Math.sqrt(n));
    for (let d = 0.02; src.S * (1 + d) <= cap + 1e-9; d += 0.02) {
      const E = expand(src, d), p = freeSpot(E, rng, 200);
      if (p) { E.x.push(p.x); E.y.push(p.y); E.th.push(p.th); E.n = n; if (isValid(E)) return E; }
    }
  }
  return null;
}

export class HopSolver {
  /**
   * @param {{n:number,seed?:number,init?:object,budgetMs?:number,hopMs?:number,now?:Function}} o
   *   init : disposition de départ valide (sinon grille).
   */
  constructor({ n, seed = 1, init = null, budgetMs = 8000, hopMs = 700, now = () => performance.now(), explore = null }) {
    this.n = n; this.rng = createRng((seed >>> 0) ^ 0x9e3779b1); this.now = now; this.t0 = now(); this.budgetMs = budgetMs; this.hopMs = hopMs;
    let s = init && isValid(init) ? clone(init) : gridLayout(n);
    // mode exploration (optionnel) : secousses plus fortes, plus de déplacements structurels, marche sur le plateau
    this.explore = explore ?? false; // désactivé par défaut : aucun gain mesuré (N=29, 70 s, 2 graines) ; option conservée pour essais
    this.cur = s; this.bestL = clone(s); this.iteration = 0; this.accepted = 0; this.done = false; this.stopReason = null; this.attempt = null; this.freeSpots = null;
  }
  get hi() { return this.bestL.S; }
  get bx() { return this.bestL.x; } get by() { return this.bestL.y; } get bth() { return this.bestL.th; }
  best() { return { S: this.bestL.S, x: this.bestL.x, y: this.bestL.y, th: this.bestL.th }; }
  stop() { this.done = true; this.stopReason = this.stopReason || 'arrêt demandé'; }
  step() {
    if (this.done) return;
    const left = this.budgetMs - (this.now() - this.t0);
    if (left < 30) { this.done = true; this.stopReason = 'budget de temps'; return; }
    this.iteration++;
    const r = this.rng, L = this.cur;
    const X = this.explore, delta = X ? 0.04 + 0.2 * r.next() ** 2 : 0.012 + 0.06 * r.next() ** 2; // amplitude d'expansion
    let E = expand(L, delta);
    const mv = r.next(), pRel = X ? 0.4 : 0.25, pRot = X ? 0.8 : 0.5;
    if (mv < pRel) { E = relocate(E, r, Math.floor(r.next() * E.n)); if (X && r.next() < 0.5) E = relocate(E, r, Math.floor(r.next() * E.n)); } // carré(s) replacé(s) dans un vide
    else if (mv < pRot) E = rotateCluster(E, r, delta);               // groupe tourné : nouveaux angles
    E = shake(E, r, delta, mv < pRot ? 0.4 : 1);
    const P = polishSLP(E, { maxMs: Math.min(this.hopMs, left), now: this.now });
    const cand = { n: this.n, S: P.S, x: P.x, y: P.y, th: P.th };
    if (!(cand.S < L.S + (X ? 0.02 : 0.004)) || !isValid(cand)) return; // jamais de solution non certifiée
    const better = cand.S < L.S - 1e-9;
    if (better || r.next() < (X ? 0.35 : 0.1)) { this.cur = cand; this.accepted++; }
    if (cand.S < this.bestL.S - 1e-9) this.bestL = clone(cand);
  }
}
