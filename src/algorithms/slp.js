/**
 * AFFINAGE CONTINU PAR PROGRAMMATION LINÉAIRE SÉQUENTIELLE (SLP).
 *
 * Partant d'une disposition VALIDE, on cherche des déplacements (x, y, θ de chaque carré, côté S du conteneur) qui
 * réduisent S en gardant tous les contacts séparés. À chaque itération :
 *   1. pour chaque paire proche, on retient l'axe séparateur (SAT) le plus favorable ; pour chaque mur proche, la contrainte de bord ;
 *   2. on linéarise ces « écarts » (gradients par différences finies centrées). Les termes |cos|+|sin| (rayon d'un carré projeté) sont
 *      des maxima de 4 branches lisses : on impose les branches proches du maximum, ce qui est exact au premier ordre, y compris pour
 *      des carrés alignés (angle relatif nul) ;
 *   3. on résout le PL « minimiser ΔS » sous région de confiance |Δ| ≤ r (simplexe dense, règle de Bland en secours) ;
 *   4. on applique le pas, on REVÉRIFIE avec le validateur exact ; pas accepté seulement s'il est valide et réduit S, sinon r ← r/2.
 * Aucun pas invalide n'est jamais conservé : le résultat est toujours une disposition valide (re-jugée par l'autorité en aval).
 * Ce n'est pas un optimiseur global : il resserre les contacts d'une configuration donnée jusqu'à un optimum local.
 */
import { validateLayout } from '../engine/validate.js';

const BR = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const rad = (s1, s2, d) => 0.5 * (s1 * Math.cos(d) + s2 * Math.sin(d));
const rAbs = (d) => 0.5 * (Math.abs(Math.cos(d)) + Math.abs(Math.sin(d)));

/** Écart signé d'une paire le long de l'axe `ax` (0..3) pour la branche (s1,s2) ; v = [xi,yi,ti,xj,yj,tj]. */
function pairGap(ax, sign, br, v) {
  const ti = v[2], tj = v[5], alpha = (ax < 2 ? ti : tj) + (ax & 1 ? Math.PI / 2 : 0), c = Math.cos(alpha), s = Math.sin(alpha);
  const proj = sign * ((v[3] - v[0]) * c + (v[4] - v[1]) * s), other = (ax < 2 ? tj : ti) - alpha;
  return proj - 0.5 - (br ? rad(br[0], br[1], other) : rAbs(other));
}
function wallGap(kind, br, x, y, th, S) {
  const h = br ? rad(br[0], br[1], th) : rAbs(th);
  return (kind === 0 ? x : kind === 1 ? S - x : kind === 2 ? y : S - y) - h;
}

/**
 * Simplexe dense À BORNES SUPÉRIEURES : max c·x, A x ≤ b (b ≥ 0), 0 ≤ x_j ≤ ub (j < n), x ≥ 0 pour les écarts.
 * Les bornes (région de confiance) ne sont plus des lignes du tableau : une variable qui atteint sa borne est « retournée »
 * (substitution x' = ub − x) ; une variable de base qui atteint sa borne est retournée avant le pivot. Le tableau a ~3× moins de
 * lignes que la version à lignes de bornes, donc des pivots ~4× moins chers. Retourne x ou null (non borné / échec).
 */
function simplexMaxB(c, A, b, n, ub) {
  const m = A.length, W = n + m + 1, R = W - 1, T = new Float64Array((m + 1) * W), basis = new Int32Array(m), flipped = new Uint8Array(n), idx = new Int32Array(W);
  for (let i = 0; i < m; i++) { const Ai = A[i]; for (let j = 0; j < n; j++) T[i * W + j] = Ai[j]; T[i * W + n + i] = 1; T[i * W + R] = b[i]; basis[i] = n + i; }
  for (let j = 0; j < n; j++) T[m * W + j] = -c[j];
  const eps = 1e-11, maxIt = 20 * (m + n), NC = n + m;
  for (let it = 0; it < maxIt; it++) {
    let e = -1;
    if (it < 4 * (m + n)) { let best = -eps; for (let j = 0; j < NC; j++) if (T[m * W + j] < best) { best = T[m * W + j]; e = j; } }
    else for (let j = 0; j < NC; j++) if (T[m * W + j] < -eps) { e = j; break; } // Bland
    if (e < 0) break;
    let r = -1, bestRatio = Infinity, up = false;
    for (let i = 0; i < m; i++) {
      const a = T[i * W + e]; let q, u = false;
      if (a > eps) q = T[i * W + R] / a;
      else if (a < -eps && basis[i] < n) { q = Math.max(0, (ub - T[i * W + R]) / -a); u = true; }
      else continue;
      if (q < bestRatio - 1e-15 || (Math.abs(q - bestRatio) <= 1e-15 && r >= 0 && basis[i] < basis[r])) { bestRatio = q; r = i; up = u; }
    }
    if (e < n && ub <= bestRatio + 1e-15) { // la variable entrante atteint sa propre borne : simple retournement
      for (let i = 0; i < m; i++) T[i * W + R] -= T[i * W + e] * ub;
      for (let i = 0; i <= m; i++) T[i * W + e] = -T[i * W + e];
      flipped[e] ^= 1; continue;
    }
    if (r < 0) return null;
    if (up) { // la variable de base de la ligne r atteint sa borne : substitution x_B = ub − x_B'
      const B = basis[r]; for (let j = 0; j < R; j++) if (j !== B) T[r * W + j] = -T[r * W + j];
      T[r * W + R] = ub - T[r * W + R]; flipped[B] ^= 1;
    }
    const pv = T[r * W + e]; let nz = 0; // colonnes non nulles de la ligne pivot (le tableau reste creux longtemps)
    for (let j = 0; j < W; j++) { const v = T[r * W + j]; if (v !== 0) { T[r * W + j] = v / pv; idx[nz++] = j; } }
    for (let i = 0; i <= m; i++) { if (i === r) continue; const f = T[i * W + e]; if (f !== 0) { const o = i * W, ro = r * W; for (let k = 0; k < nz; k++) { const j = idx[k]; T[o + j] -= f * T[ro + j]; } } }
    basis[r] = e;
  }
  const x = new Float64Array(n); for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i * W + R];
  for (let j = 0; j < n; j++) if (flipped[j]) x[j] = ub - x[j];
  return x;
}

const toPl = (x, y, th) => Array.from(x, (_, i) => ({ x: x[i], y: y[i], side: 1, theta: th[i] }));

/**
 * @param {{n:number,S:number,x:number[],y:number[],th:number[]}} sol  disposition valide (carrés unité, conteneur S×S)
 * @returns {{S:number,x:number[],y:number[],th:number[],iterations:number,accepted:number}} toujours valide (au pire, la solution d'entrée)
 */
export function polishSLP(sol, { maxMs = 3000, now = () => performance.now(), r0 = 0.03, maxIter = 200 } = {}) {
  const n = sol.n ?? sol.x.length, t0 = now();
  let x = Float64Array.from(sol.x), y = Float64Array.from(sol.y), th = Float64Array.from(sol.th), S = sol.S, r = r0, iterations = 0, accepted = 0;
  const nv = 3 * n + 1;
  while (iterations < maxIter && r > 1e-10 && now() - t0 < maxMs) {
    iterations++;
    const rows = [], rhs = [], thr = 3 * r;
    const addRow = (g0, grads) => { // contrainte linéarisée : g0 + Σ grad·Δ ≥ min(g0, plancher)
      const row = new Float64Array(2 * nv);
      for (const [k, g] of grads) { row[k] = -g; row[nv + k] = g; } // Δ = p − q
      // plancher d'écart par ligne ∈ [−2e-11, −4e-11] (anti-dégénérescence) : l'écart ne peut JAMAIS descendre sous ce plancher,
      // donc aucune dérive cumulée d'une itération à l'autre (l'ancienne version autorisait −j de plus à chaque pas)
      const floor = -2e-11 * (1 + ((rows.length * 2654435761) % 1000) / 1000);
      rows.push(row); rhs.push(g0 - Math.min(g0, floor)); // nouvel écart ≥ min(g0, plancher) ; rhs ≥ 0
    };
    const fd = (f, v, idxs) => idxs.map((k) => { const e = 1e-6, a = v.slice(), b = v.slice(); a[k] += e; b[k] -= e; return (f(a) - f(b)) / (2 * e); });
    // murs
    for (let i = 0; i < n; i++) for (let kind = 0; kind < 4; kind++) for (const br of BR) {
      const g0 = wallGap(kind, br, x[i], y[i], th[i], S); if (g0 > thr) continue;
      const f = (v) => wallGap(kind, br, v[0], v[1], v[2], v[3]), v = [x[i], y[i], th[i], S], d = fd(f, v, [0, 1, 2, 3]);
      addRow(g0, [[3 * i, d[0]], [3 * i + 1, d[1]], [3 * i + 2, d[2]], [3 * n, d[3]]]);
    }
    // paires
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i], dy = y[j] - y[i]; if (dx * dx + dy * dy > (Math.SQRT2 + thr + 0.2) ** 2) continue;
      const v = [x[i], y[i], th[i], x[j], y[j], th[j]]; let bestAx = -1, bestSign = 1, bestG = -Infinity;
      for (let ax = 0; ax < 4; ax++) for (const sign of [1, -1]) { const g = pairGap(ax, sign, null, v); if (g > bestG) { bestG = g; bestAx = ax; bestSign = sign; } }
      if (bestG > thr) continue;
      for (const br of BR) {
        const g0 = pairGap(bestAx, bestSign, br, v); if (g0 > bestG + 4 * r + 1e-9 && g0 > thr) continue; if (g0 > bestG + 4 * r + 1e-9) continue;
        const d = fd((w) => pairGap(bestAx, bestSign, br, w), v, [0, 1, 2, 3, 4, 5]);
        addRow(g0, [[3 * i, d[0]], [3 * i + 1, d[1]], [3 * i + 2, d[2]], [3 * j, d[3]], [3 * j + 1, d[4]], [3 * j + 2, d[5]]]);
      }
    }
    // région de confiance |Δ| ≤ r : p_k, q_k ∈ [0, r] — bornes du simplexe (plus de lignes)
    const c = new Float64Array(2 * nv); c[3 * n] = -1; c[nv + 3 * n] = 1; // minimiser ΔS
    const w = simplexMaxB(c, rows, rhs, 2 * nv, r);
    let ok = false;
    if (w) {
      const nx = new Float64Array(n), ny = new Float64Array(n), nt = new Float64Array(n);
      for (let t = 1; t > 0.05 && !ok; t /= 2) { // recherche linéaire le long du pas PL : l'erreur non linéaire croît en t², le gain en t
        let nS = S + t * (w[3 * n] - w[nv + 3 * n]);
        for (let i = 0; i < n; i++) { nx[i] = x[i] + t * (w[3 * i] - w[nv + 3 * i]); ny[i] = y[i] + t * (w[3 * i + 1] - w[nv + 3 * i + 1]); nt[i] = th[i] + t * (w[3 * i + 2] - w[nv + 3 * i + 2]); }
        // dilatation de 4e-10 (relative) du candidat : annule les très légers défauts de faisabilité du simplexe (≈1e-10) qui
        // s'accumulaient sinon de pas en pas ; coût ≈ 4e-10·S, négligeable devant le gain d'un vrai pas
        { const f = 1 + 4e-10, c = nS / 2; nS *= f; const c2 = nS / 2; for (let i = 0; i < n; i++) { nx[i] = c2 + (nx[i] - c) * f; ny[i] = c2 + (ny[i] - c) * f; } }
        if (nS < S - 1e-13 && nS >= Math.sqrt(n) * (1 + 1e-12) && validateLayout(toPl(nx, ny, nt), nS, nS, 1e-10).valid) { x = Float64Array.from(nx); y = Float64Array.from(ny); th = Float64Array.from(nt); S = nS; accepted++; ok = true; }
      }
    }
    // (tolérance d acceptation 1e-10, 10× plus stricte que le validateur par défaut : pas de dérive cumulée vers la borne d aire)
    r = ok ? Math.min(r0, r * 1.6) : r * 0.5;
  }
  return { n, S, x: Array.from(x), y: Array.from(y), th: Array.from(th), iterations, accepted };
}
