import { ConstructiveSolver } from './base.js';

/**
 * Algorithme de RÉFÉRENCE simple : First-Fit Decreasing Shelf (étagères).
 * Les objets triés par taille décroissante sont rangés en lignes (« étagères »)
 * de gauche à droite ; une nouvelle étagère est ouverte quand aucune ne convient.
 * Complexité O(n · e) avec e = nombre d'étagères.
 */
export class ShelfSolver extends ConstructiveSolver {
  constructor(instance, options) { super(instance, options, 'Étagères (First-Fit Decreasing)'); }
  init() { this.shelves = []; this.top = 0; }
  place(it) {
    const { W, H } = this.instance, s = it.side, eps = 1e-12;
    let sh = this.shelves.find((e) => e.x + s <= W + eps && s <= e.h + eps);
    if (!sh && this.top + s <= H + eps) { sh = { y: this.top, h: s, x: 0 }; this.top += s; this.shelves.push(sh); }
    if (!sh) return null;
    const p = { x: sh.x, y: sh.y }; sh.x += s; return p;
  }
}
