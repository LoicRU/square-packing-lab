/**
 * Géométrie des carrés orientés — cœur mathématique, sans dépendance.
 * Un carré : { x, y, side, theta } (centre, côté, rotation en radians).
 * Conteneur : rectangle [0,W] × [0,H].  Formules : voir docs/MATHS.md.
 */
export const TOL = 1e-9;
export const SQRT2 = Math.SQRT2;

/** Demi-étendue de la boîte englobante alignée : (side/2)(|cosθ|+|sinθ|). */
export const halfExtent = (side, theta) => (side / 2) * (Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta)));

/** Quatre sommets du carré. */
export function corners(q) {
  const h = q.side / 2, c = Math.cos(q.theta) * h, s = Math.sin(q.theta) * h;
  return [
    [q.x - c + s, q.y - s - c],
    [q.x + c + s, q.y + s - c],
    [q.x + c - s, q.y + s + c],
    [q.x - c - s, q.y - s + c],
  ];
}

/**
 * Pénétration entre deux carrés orientés par le théorème de l'axe séparateur
 * (SAT), avec cos/sin précalculés (version « chaude »).
 *
 * Retourne 0 si les carrés sont disjoints ou simplement tangents, sinon la plus
 * petite translation qui les sépare (> 0). Si `out` est fourni, y écrit la
 * normale unitaire (de 1 vers 2) de l'axe de pénétration minimale.
 */
export function satPenCS(x1, y1, s1, c1, n1, x2, y2, s2, c2, n2, out) {
  const dx = x2 - x1, dy = y2 - y1, rr = (s1 + s2) / SQRT2;
  if (dx * dx + dy * dy >= rr * rr) return 0; // rejet rapide : cercles circonscrits disjoints
  const h1 = s1 * 0.5, h2 = s2 * 0.5;
  let min = Infinity, mx = 0, my = 0;
  for (let k = 0; k < 4; k++) {
    let ax, ay;
    if (k === 0) { ax = c1; ay = n1; } else if (k === 1) { ax = -n1; ay = c1; }
    else if (k === 2) { ax = c2; ay = n2; } else { ax = -n2; ay = c2; }
    const r1 = h1 * (Math.abs(ax * c1 + ay * n1) + Math.abs(-ax * n1 + ay * c1));
    const r2 = h2 * (Math.abs(ax * c2 + ay * n2) + Math.abs(-ax * n2 + ay * c2));
    const proj = dx * ax + dy * ay;
    const o = r1 + r2 - Math.abs(proj);
    if (o <= 0) return 0; // axe séparateur trouvé
    if (o < min) { min = o; if (proj >= 0) { mx = ax; my = ay; } else { mx = -ax; my = -ay; } }
  }
  if (out) { out[0] = mx; out[1] = my; }
  return min;
}

/** Pénétration entre deux carrés { x, y, side, theta }. */
export function penetration(A, B, out) {
  return satPenCS(A.x, A.y, A.side, Math.cos(A.theta), Math.sin(A.theta), B.x, B.y, B.side, Math.cos(B.theta), Math.sin(B.theta), out);
}
export const overlaps = (A, B, tol = TOL) => penetration(A, B) > tol;

/**
 * Dépassement hors du conteneur [0,W]×[0,H] (0 si entièrement dedans).
 * Condition exacte : h ≤ x ≤ W−h et h ≤ y ≤ H−h, h = demi-étendue.
 */
export function containerExcess(q, W, H) {
  const h = halfExtent(q.side, q.theta);
  return Math.max(0, h - q.x, q.x + h - W, h - q.y, q.y + h - H);
}

/** Aire d'un carré. */
export const area = (q) => q.side * q.side;
