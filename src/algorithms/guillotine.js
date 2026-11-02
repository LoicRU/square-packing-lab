import { ConstructiveSolver } from './base.js';

const EPS = 1e-12;

/**
 * Guillotine (Jylänki 2010) : chaque placement dans un rectangle libre le découpe
 * en DEUX rectangles disjoints par une coupe « guillotine » (bord à bord).
 * Choix du rectangle : baf (Best Area Fit) ou bssf (Best Short Side Fit).
 * Règle de coupe : slas (axe le plus court restant), llas (plus long), maxas (aire max).
 * Option merge : fusionne les rectangles libres adjacents de même largeur/hauteur.
 */
export class GuillotineSolver extends ConstructiveSolver {
  constructor(instance, options) {
    super(instance, { choice: 'baf', split: 'slas', merge: true, ...options }, `Guillotine (${options?.choice || 'baf'}/${options?.split || 'slas'})`);
  }
  init() { this.free = [{ x: 0, y: 0, w: this.instance.W, h: this.instance.H }]; }
  place(it) {
    const s = it.side;
    let bi = -1, b1 = Infinity, b2 = Infinity;
    this.free.forEach((r, i) => {
      if (r.w + EPS < s || r.h + EPS < s) return;
      const sc1 = this.options.choice === 'bssf' ? Math.min(r.w - s, r.h - s) : r.w * r.h - s * s;
      const sc2 = this.options.choice === 'bssf' ? Math.max(r.w - s, r.h - s) : Math.min(r.w - s, r.h - s);
      if (sc1 < b1 - EPS || (Math.abs(sc1 - b1) <= EPS && sc2 < b2)) { bi = i; b1 = sc1; b2 = sc2; }
    });
    if (bi < 0) return null;
    const r = this.free[bi];
    this.free.splice(bi, 1);
    const lw = r.w - s, lh = r.h - s;
    let horizontal; // true : la coupe sépare le bandeau du haut sur toute la largeur
    switch (this.options.split) {
      case 'llas': horizontal = lw > lh; break;
      case 'maxas': horizontal = s * lh > lw * s; break;
      default: horizontal = lw <= lh; // slas
    }
    const bottom = horizontal ? { x: r.x, y: r.y + s, w: r.w, h: lh } : { x: r.x, y: r.y + s, w: s, h: lh };
    const right = horizontal ? { x: r.x + s, y: r.y, w: lw, h: s } : { x: r.x + s, y: r.y, w: lw, h: r.h };
    if (bottom.w > EPS && bottom.h > EPS) this.free.push(bottom);
    if (right.w > EPS && right.h > EPS) this.free.push(right);
    if (this.options.merge) this.mergeFree();
    return { x: r.x, y: r.y };
  }
  mergeFree() {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < this.free.length; i++) for (let j = i + 1; j < this.free.length; j++) {
        const a = this.free[i], b = this.free[j];
        if (Math.abs(a.x - b.x) < EPS && Math.abs(a.w - b.w) < EPS && (Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS)) {
          this.free[i] = { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h }; this.free.splice(j, 1); merged = true; break outer;
        }
        if (Math.abs(a.y - b.y) < EPS && Math.abs(a.h - b.h) < EPS && (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS)) {
          this.free[i] = { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h }; this.free.splice(j, 1); merged = true; break outer;
        }
      }
    }
  }
}
