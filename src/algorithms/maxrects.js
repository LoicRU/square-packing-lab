import { ConstructiveSolver } from './base.js';

const EPS = 1e-12;
const contains = (a, b) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;

/**
 * MaxRects (Jylänki, « A Thousand Ways to Pack the Bin », 2010).
 * Maintient la liste des rectangles libres MAXIMAUX (ils peuvent se chevaucher).
 * Chaque placement découpe les rectangles qu'il intersecte en au plus 4 rectangles
 * maximaux et élimine ceux qui sont contenus dans un autre.
 * Heuristiques : bssf (Best Short Side Fit), baf (Best Area Fit), bl (Bottom-Left).
 */
export class MaxRectsSolver extends ConstructiveSolver {
  constructor(instance, options) { super(instance, { heuristic: 'bssf', ...options }, `MaxRects (${options?.heuristic || 'bssf'})`); }
  init() { this.free = [{ x: 0, y: 0, w: this.instance.W, h: this.instance.H }]; }
  score(r, s) {
    const h = this.options.heuristic;
    if (h === 'baf') return [r.w * r.h - s * s, Math.min(r.w - s, r.h - s)];
    if (h === 'bl') return [r.y + s, r.x];
    return [Math.min(r.w - s, r.h - s), Math.max(r.w - s, r.h - s)]; // bssf
  }
  place(it) {
    const s = it.side;
    let best = null, b1 = Infinity, b2 = Infinity;
    for (const r of this.free) {
      if (r.w + EPS < s || r.h + EPS < s) continue;
      const [s1, s2] = this.score(r, s);
      if (s1 < b1 - EPS || (Math.abs(s1 - b1) <= EPS && s2 < b2)) { best = r; b1 = s1; b2 = s2; }
    }
    if (!best) return null;
    const P = { x: best.x, y: best.y, w: s, h: s };
    const kept = [], fresh = [];
    for (const f of this.free) {
      if (P.x >= f.x + f.w - EPS || P.x + s <= f.x + EPS || P.y >= f.y + f.h - EPS || P.y + s <= f.y + EPS) { kept.push(f); continue; }
      if (P.y > f.y + EPS) fresh.push({ x: f.x, y: f.y, w: f.w, h: P.y - f.y });
      if (P.y + s < f.y + f.h - EPS) fresh.push({ x: f.x, y: P.y + s, w: f.w, h: f.y + f.h - (P.y + s) });
      if (P.x > f.x + EPS) fresh.push({ x: f.x, y: f.y, w: P.x - f.x, h: f.h });
      if (P.x + s < f.x + f.w - EPS) fresh.push({ x: P.x + s, y: f.y, w: f.x + f.w - (P.x + s), h: f.h });
    }
    // Élagage : un nouveau rectangle contenu dans un autre est supprimé ; les anciens
    // (déjà maximaux entre eux) ne peuvent être contenus que dans un nouveau.
    const fr = [];
    for (let i = 0; i < fresh.length; i++) {
      let dead = false;
      for (let j = 0; j < fresh.length && !dead; j++) if (i !== j && contains(fresh[j], fresh[i]) && (!contains(fresh[i], fresh[j]) || j < i)) dead = true;
      if (!dead) for (const k of kept) if (contains(k, fresh[i])) { dead = true; break; }
      if (!dead) fr.push(fresh[i]);
    }
    this.free = kept.filter((k) => !fr.some((f) => contains(f, k))).concat(fr);
    return { x: P.x, y: P.y };
  }
}
