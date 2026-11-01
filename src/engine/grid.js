/**
 * Grille uniforme (phase large). Correcte si cell ≥ 2·(rayon circonscrit max).
 * Supporte insertion, déplacement incrémental, requêtes de voisinage et
 * énumération des paires proches.
 */
export class Grid {
  constructor(W, H, cell, n) {
    let c = Math.max(cell, 1e-9);
    // Garde-fou mémoire : on n'agrandit que la cellule (reste correct).
    const maxCells = 160000;
    if ((W / c + 1) * (H / c + 1) > maxCells) c = Math.sqrt((W * H) / maxCells) * 1.01;
    this.cell = c;
    this.cols = Math.max(1, Math.ceil(W / c));
    this.rows = Math.max(1, Math.ceil(H / c));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.of = new Int32Array(Math.max(n, 1)).fill(-1);
  }
  _ix(v) { const c = Math.floor(v / this.cell); return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
  _iy(v) { const c = Math.floor(v / this.cell); return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c; }
  clear() { for (const c of this.cells) c.length = 0; this.of.fill(-1); }
  insert(i, x, y) { const c = this._iy(y) * this.cols + this._ix(x); this.cells[c].push(i); this.of[i] = c; }
  move(i, x, y) {
    const c = this._iy(y) * this.cols + this._ix(x), o = this.of[i];
    if (c === o) return;
    if (o >= 0) { const a = this.cells[o], k = a.indexOf(i); if (k >= 0) { a[k] = a[a.length - 1]; a.pop(); } }
    this.cells[c].push(i); this.of[i] = c;
  }
  remove(i) {
    const o = this.of[i]; if (o < 0) return;
    const a = this.cells[o], k = a.indexOf(i); if (k >= 0) { a[k] = a[a.length - 1]; a.pop(); }
    this.of[i] = -1;
  }
  /** cb(j) pour chaque objet des 3×3 cellules autour de (x,y). */
  near(x, y, cb) {
    const cx = this._ix(x), cy = this._iy(y), { cols, rows } = this;
    for (let ry = Math.max(0, cy - 1); ry <= Math.min(rows - 1, cy + 1); ry++)
      for (let rx = Math.max(0, cx - 1); rx <= Math.min(cols - 1, cx + 1); rx++) {
        const a = this.cells[ry * cols + rx];
        for (let k = 0; k < a.length; k++) cb(a[k]);
      }
  }
  /** cb(i, j) une fois par paire proche (i<j). */
  pairs(cb) {
    const { cols, rows } = this;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const a = this.cells[cy * cols + cx];
      if (!a.length) continue;
      for (let ry = Math.max(0, cy - 1); ry <= Math.min(rows - 1, cy + 1); ry++)
        for (let rx = Math.max(0, cx - 1); rx <= Math.min(cols - 1, cx + 1); rx++) {
          const b = this.cells[ry * cols + rx];
          for (let p = 0; p < a.length; p++) { const i = a[p]; for (let q = 0; q < b.length; q++) { const j = b[q]; if (j > i) cb(i, j); } }
        }
    }
  }
}
