import { TOL, SQRT2, halfExtent, satPenCS, containerExcess } from './geometry.js';
import { Grid } from './grid.js';

/**
 * VALIDATEUR EXACT — seule autorité pour déclarer une disposition valide.
 *
 * Valide ⇔ toutes les valeurs sont finies et strictement positives,
 * aucune paire n'a de pénétration > tol (SAT exact sur toutes les paires
 * proches) et aucun carré ne dépasse du conteneur de plus de tol.
 * Les carrés non marqués (flags=0) forment toujours une sous-disposition valide.
 *
 * @param {{id?:number,x:number,y:number,side:number,theta:number}[]} placements
 * @param {number} W @param {number} H @param {number} [tol]
 */
export function validateLayout(placements, W, H, tol = TOL) {
  const n = placements.length, flags = new Uint8Array(n), pairs = [], oob = [], invalid = [];
  let area = 0, rMax = 0;
  for (let i = 0; i < n; i++) {
    const q = placements[i];
    if (![q.x, q.y, q.side, q.theta].every(Number.isFinite) || !(q.side > 0)) { invalid.push(i); flags[i] = 1; continue; }
    area += q.side * q.side;
    rMax = Math.max(rMax, q.side / SQRT2);
  }
  const g = new Grid(W, H, 2 * rMax, n);
  const cs = new Float64Array(n), sn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (flags[i]) continue;
    const q = placements[i];
    cs[i] = Math.cos(q.theta); sn[i] = Math.sin(q.theta);
    g.insert(i, q.x, q.y);
    if (containerExcess(q, W, H) > tol) { oob.push(i); flags[i] = 1; }
  }
  g.pairs((i, j) => {
    const A = placements[i], B = placements[j];
    const d = satPenCS(A.x, A.y, A.side, cs[i], sn[i], B.x, B.y, B.side, cs[j], sn[j]);
    if (d > tol) { pairs.push([i, j, d]); flags[i] = 1; flags[j] = 1; }
  });
  let nBad = 0, validArea = 0, maxPenetration = 0;
  for (const p of pairs) maxPenetration = Math.max(maxPenetration, p[2]);
  for (let i = 0; i < n; i++) { if (flags[i]) nBad++; else validArea += placements[i].side * placements[i].side; }
  return {
    n, flags, pairs, oob, invalid, nBad, area, validArea, maxPenetration, tol,
    valid: pairs.length === 0 && oob.length === 0 && invalid.length === 0,
  };
}

/** Retire gloutonnement le carré le plus conflictuel jusqu'à obtenir une disposition valide. */
export function stripConflicts(placements, W, H, tol = TOL) {
  const v = validateLayout(placements, W, H, tol), n = placements.length;
  if (v.valid) return { kept: placements.slice(), removed: [] };
  const adj = new Map(), deg = new Int32Array(n), dead = new Uint8Array(n);
  for (const [i, j] of v.pairs) {
    if (!adj.has(i)) adj.set(i, []); if (!adj.has(j)) adj.set(j, []);
    adj.get(i).push(j); adj.get(j).push(i); deg[i]++; deg[j]++;
  }
  for (const i of [...v.oob, ...v.invalid]) { dead[i] = 1; for (const j of adj.get(i) || []) deg[j]--; }
  for (;;) {
    let best = -1, bd = 0;
    for (const k of adj.keys()) if (!dead[k] && deg[k] > bd) { bd = deg[k]; best = k; }
    if (best < 0) break;
    dead[best] = 1; for (const j of adj.get(best)) if (!dead[j]) deg[j]--;
  }
  const kept = [], removed = [];
  placements.forEach((p, i) => (dead[i] ? removed : kept).push(p));
  return { kept, removed };
}
