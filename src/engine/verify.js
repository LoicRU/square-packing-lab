/**
 * VÉRIFICATEUR INDÉPENDANT. N'utilise ni le SAT, ni la grille spatiale, ni le code de
 * placement : il repose uniquement sur
 *   – l'aire d'intersection de deux polygones convexes (découpage de Sutherland–Hodgman),
 *   – la position des 4 sommets de chaque carré par rapport aux bords du conteneur,
 *   – l'égalité stricte des côtés et la plage des angles.
 * Un chevauchement est détecté si l'aire d'intersection dépasse `areaTol`.
 */
const rad2deg = (t) => ((((t * 180) / Math.PI) % 90) + 90) % 90;

function vertices(p) {
  const h = p.side / 2, c = Math.cos(p.theta) * h, s = Math.sin(p.theta) * h;
  return [[p.x - c + s, p.y - s - c], [p.x + c + s, p.y + s - c], [p.x + c - s, p.y + s + c], [p.x - c - s, p.y - s + c]];
}
function clip(subject, clipper) {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length], inp = out; out = [];
    const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k], q = inp[(k + 1) % inp.length], sp = side(p), sq = side(q);
      if (sq >= 0) { if (sp < 0) out.push(cross(p, q, sp, sq)); out.push(q); } else if (sp >= 0) out.push(cross(p, q, sp, sq));
    }
  }
  return out;
}
const cross = (p, q, sp, sq) => { const t = sp / (sp - sq); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
const area = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; s += poly[i][0] * q[1] - q[0] * poly[i][1]; } return Math.abs(s) / 2; };

/**
 * @param {{x:number,y:number,side:number,theta:number}[]} placements
 * @param {number} W côté du conteneur (carré) ; H optionnel
 * @returns {{valid:boolean, n:number, overlaps:number, maxOverlapArea:number, outOfBounds:number, maxExcess:number, sidesEqual:boolean, anglesInRange:boolean, side:number, angles:number[], problems:string[]}}
 */
export function verifyIndependent(placements, W, { H = W, areaTol = 1e-9, boundTol = 1e-7, sideTol = 1e-9, expectedN = null } = {}) {
  const n = placements.length, polys = placements.map(vertices), problems = [];
  let overlaps = 0, maxArea = 0, oob = 0, maxExcess = 0;
  for (let i = 0; i < n; i++) {
    for (const [x, y] of polys[i]) {
      const ex = Math.max(0, -x, x - W, -y, y - H);
      if (ex > boundTol) { oob++; if (ex > maxExcess) maxExcess = ex; break; }
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.hypot(placements[i].x - placements[j].x, placements[i].y - placements[j].y) >= (placements[i].side + placements[j].side) / Math.SQRT2 + 1e-9) continue; // cercles circonscrits disjoints : intersection vide
    const inter = clip(polys[i], polys[j]), a = inter.length > 2 ? area(inter) : 0;
    if (a > areaTol) { overlaps++; if (a > maxArea) maxArea = a; }
  }
  const s0 = n ? placements[0].side : 0;
  const sidesEqual = placements.every((p) => Math.abs(p.side - s0) <= sideTol * Math.max(1, s0));
  const angles = placements.map((p) => rad2deg(p.theta));
  const anglesInRange = angles.every((a) => a >= 0 && a < 90 + 1e-9 && Number.isFinite(a));
  if (overlaps) problems.push(`${overlaps} chevauchement(s)`);
  if (oob) problems.push(`${oob} carré(s) hors du conteneur`);
  if (!sidesEqual) problems.push('côtés non identiques');
  if (!anglesInRange) problems.push('angle hors [0°, 90°)');
  if (expectedN !== null && n !== expectedN) problems.push(`${n} carrés au lieu de ${expectedN}`);
  return { valid: problems.length === 0, n, overlaps, maxOverlapArea: maxArea, outOfBounds: oob, maxExcess, sidesEqual, anglesInRange, side: s0, angles, problems };
}
