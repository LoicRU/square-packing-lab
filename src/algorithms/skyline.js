import { ConstructiveSolver } from './base.js';

const EPS = 1e-12;

/**
 * Skyline (Jylänki 2010) : la frontière haute des objets déjà posés est une
 * « ligne d'horizon » en escalier (liste de segments). Un objet est posé au
 * point le plus bas possible (bl : Bottom-Left) ou minimisant l'espace perdu
 * sous lui (minwaste). Complexité O(n · s), s = nombre de segments.
 */
export class SkylineSolver extends ConstructiveSolver {
  constructor(instance, options) { super(instance, { heuristic: 'bl', ...options }, `Skyline (${options?.heuristic || 'bl'})`); }
  init() { this.segs = [{ x: 0, y: 0, w: this.instance.W }]; }
  /** Hauteur de pose si l'objet commence au segment i (ou -1 s'il ne rentre pas). */
  fit(i, s) {
    const { W, H } = this.instance, segs = this.segs;
    if (segs[i].x + s > W + EPS) return -1;
    let y = 0, left = s, j = i;
    while (left > EPS) { if (j >= segs.length) return -1; y = Math.max(y, segs[j].y); left -= segs[j].w; j++; }
    return y + s > H + EPS ? -1 : y;
  }
  waste(i, s, y) {
    let w = 0, left = s;
    for (let j = i; left > EPS && j < this.segs.length; j++) { const sw = Math.min(left, this.segs[j].w); w += (y - this.segs[j].y) * sw; left -= sw; }
    return w;
  }
  place(it) {
    const s = it.side;
    let bi = -1, by = Infinity, bw = Infinity, bx = Infinity;
    for (let i = 0; i < this.segs.length; i++) {
      const y = this.fit(i, s);
      if (y < 0) continue;
      const wst = this.options.heuristic === 'minwaste' ? this.waste(i, s, y) : 0;
      const key = this.options.heuristic === 'minwaste' ? [wst, y + s] : [y + s, this.segs[i].x];
      const k1 = key[0], k2 = key[1];
      if (bi < 0 || k1 < bw - EPS || (Math.abs(k1 - bw) <= EPS && k2 < bx - EPS)) { bi = i; by = y; bw = k1; bx = k2; }
    }
    if (bi < 0) return null;
    const x = this.segs[bi].x;
    this.segs.splice(bi, 0, { x, y: by + s, w: s });
    for (let k = bi + 1; k < this.segs.length; k++) {
      const prev = this.segs[k - 1], cur = this.segs[k];
      if (cur.x < prev.x + prev.w - EPS) {
        const shrink = prev.x + prev.w - cur.x;
        cur.x += shrink; cur.w -= shrink;
        if (cur.w <= EPS) { this.segs.splice(k, 1); k--; } else break;
      } else break;
    }
    for (let k = 0; k < this.segs.length - 1; k++) {
      if (Math.abs(this.segs[k].y - this.segs[k + 1].y) < EPS) { this.segs[k].w += this.segs[k + 1].w; this.segs.splice(k + 1, 1); k--; }
    }
    return { x, y: by };
  }
}
