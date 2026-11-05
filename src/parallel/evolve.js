/**
 * OPÉRATEURS ÉVOLUTIFS (mutation, recombinaison). Fonctions pures : (solution, rng, paramètres) → disposition
 * « graine » {n,S,x,y,th} qui n'est PAS garantie valide : elle est réparée par le solveur (recuit + projection
 * + certification) avant d'être proposée à l'Elite Pool. Aucun mélange naïf de coordonnées.
 */
import { HALF_PI, foldAngle } from './authority.js';

export const MUTATIONS = ['move-one', 'rotate-one', 'move-several', 'rotate-coordinated', 'local-reorg', 'region', 'partial-reset', 'multi'];
export const AMPLITUDES = { small: 0.08, medium: 0.3, large: 0.9 }; // en côtés de carré

const clone = (s) => ({ n: s.n, S: s.S, x: Array.from(s.x), y: Array.from(s.y), th: Array.from(s.th) });
const clampPos = (v, S) => Math.min(S - 0.5, Math.max(0.5, v));
const neighbors = (s, i, r) => { const out = []; for (let j = 0; j < s.n; j++) if (Math.hypot(s.x[j] - s.x[i], s.y[j] - s.y[i]) <= r) out.push(j); return out; };
const pick = (rng, n) => Math.floor(rng.next() * n);
const jit = (rng, a) => (rng.next() * 2 - 1) * a;

/** Applique l'opérateur `op` d'amplitude `amp` (en côtés) à une copie de `parent`. */
export function mutate(parent, rng, { op = 'multi', amp = AMPLITUDES.medium } = {}) {
  const c = clone(parent), n = c.n, S = c.S;
  const moveSq = (i, a) => { c.x[i] = clampPos(c.x[i] + jit(rng, a), S); c.y[i] = clampPos(c.y[i] + jit(rng, a), S); };
  const rotSq = (i, a) => { c.th[i] = foldAngle(c.th[i] + jit(rng, a * 1.8)); };
  const apply = {
    'move-one': () => moveSq(pick(rng, n), amp),
    'rotate-one': () => rotSq(pick(rng, n), amp),
    'move-several': () => { const m = Math.max(2, Math.round(n * (0.05 + 0.15 * amp))); for (let k = 0; k < m; k++) moveSq(pick(rng, n), amp); },
    'rotate-coordinated': () => { const g = neighbors(c, pick(rng, n), 1.2 + amp), d = jit(rng, amp * 1.5); for (const j of g) c.th[j] = foldAngle(c.th[j] + d); },
    'local-reorg': () => { // permute les positions de quelques voisins et ré-oriente légèrement
      const g = neighbors(c, pick(rng, n), 1.6 + amp); if (g.length < 2) return moveSq(g[0] ?? 0, amp);
      const xs = g.map((j) => c.x[j]), ys = g.map((j) => c.y[j]); for (let k = g.length - 1; k > 0; k--) { const r = pick(rng, k + 1); [xs[k], xs[r]] = [xs[r], xs[k]]; [ys[k], ys[r]] = [ys[r], ys[k]]; }
      g.forEach((j, k) => { c.x[j] = xs[k]; c.y[j] = ys[k]; rotSq(j, amp * 0.5); });
    },
    region: () => { const i = pick(rng, n), r = 1.5 + 2 * amp; for (const j of neighbors(c, i, r)) { moveSq(j, amp * 0.6); rotSq(j, amp * 0.6); } },
    'partial-reset': () => { const m = Math.max(1, Math.round(n * (0.04 + 0.12 * amp))); for (let k = 0; k < m; k++) { const i = pick(rng, n); c.x[i] = 0.5 + rng.next() * (S - 1); c.y[i] = 0.5 + rng.next() * (S - 1); c.th[i] = rng.next() * HALF_PI; } },
    multi: () => { const ops = MUTATIONS.filter((o) => o !== 'multi'), k = 2 + pick(rng, 2); for (let q = 0; q < k; q++) mutate_inplace(ops[pick(rng, ops.length)]); },
  };
  const mutate_inplace = (o) => apply[o]();
  apply[op in apply ? op : 'multi']();
  return c;
}

/** Symétrie k ∈ 0..7 de D4 appliquée à une solution (coordonnées dans [0,S]). */
export function transformSolution(s, k) {
  const c = clone(s), S = s.S;
  for (let i = 0; i < s.n; i++) {
    let x = c.x[i], y = c.y[i], t = c.th[i];
    if (k & 4) { x = S - x; t = HALF_PI - t; }
    for (let r = 0; r < (k & 3); r++) { const nx = S - y; y = x; x = nx; }
    c.x[i] = x; c.y[i] = y; c.th[i] = foldAngle(t);
  }
  return c;
}

/**
 * RECOMBINAISON géométrique : on aligne le parent B sur A par une symétrie aléatoire de D4, on coupe le
 * conteneur par une droite aléatoire (en fractions du conteneur), A fournit un côté et B l'autre ; le nombre de
 * carrés est rétabli (on retire les carrés les plus proches de la coupure en excès, on en ajoute au hasard le long
 * de la coupure s'il en manque). Le résultat vit dans un conteneur de côté max(S_A, S_B) et doit être réparé.
 */
export function recombine(A, B, rng) {
  const Bt = transformSolution(B, pick(rng, 8)), S = Math.max(A.S, B.S), n = A.n;
  const phi = rng.next() * Math.PI, cx = 0.3 + 0.4 * rng.next(), cy = 0.3 + 0.4 * rng.next(), nx = Math.cos(phi), ny = Math.sin(phi);
  const items = [];
  const side = (s, i) => ((s.x[i] / s.S - cx) * nx + (s.y[i] / s.S - cy) * ny) * S;
  for (let i = 0; i < A.n; i++) { const d = side(A, i); if (d < 0) items.push({ x: (A.x[i] / A.S) * S, y: (A.y[i] / A.S) * S, th: A.th[i], d }); }
  for (let i = 0; i < Bt.n; i++) { const d = side(Bt, i); if (d >= 0) items.push({ x: (Bt.x[i] / Bt.S) * S, y: (Bt.y[i] / Bt.S) * S, th: Bt.th[i], d }); }
  while (items.length > n) { let k = 0; for (let i = 1; i < items.length; i++) if (Math.abs(items[i].d) < Math.abs(items[k].d)) k = i; items.splice(k, 1); }
  while (items.length < n) { const along = jit(rng, 0.4) * S; items.push({ x: cx * S - ny * along + jit(rng, 0.5), y: cy * S + nx * along + jit(rng, 0.5), th: rng.next() * HALF_PI, d: 0 }); }
  return { n, S, x: items.map((q) => clampPos(q.x, S)), y: items.map((q) => clampPos(q.y, S)), th: items.map((q) => q.th) };
}
