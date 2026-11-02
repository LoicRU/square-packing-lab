import { TOL } from '../engine/geometry.js';

/**
 * Base des algorithmes CONSTRUCTIFS (un objet placé par étape) : MaxRects,
 * Guillotine, Skyline, Étagères. Ils placent des carrés alignés (θ = 0) :
 * pour un carré, une rotation de 90° est une symétrie, seule une rotation libre
 * (angle quelconque) changerait quelque chose — ces méthodes ne la proposent pas.
 *
 * Interface commune des solveurs : step(), done, view(), result(), setParams().
 */
export class ConstructiveSolver {
  constructor(instance, options = {}, label = '') {
    this.instance = instance;
    this.options = { sort: 'desc', ...options };
    this.label = label;
    let items = instance.items.slice();
    if (this.options.sort === 'desc') items.sort((a, b) => b.side - a.side || a.id - b.id);
    else if (this.options.sort === 'asc') items.sort((a, b) => a.side - b.side || a.id - b.id);
    this.queue = items;
    this.pos = 0;
    this.placed = [];
    this.rejected = [];
    this.iteration = 0;
    this.phase = 'placement';
    this.init();
  }
  init() {}
  /** Retourne { x, y } (coin supérieur gauche) ou null si l'objet ne rentre pas. */
  place() { return null; }
  get done() { return this.pos >= this.queue.length; }
  step() {
    if (this.done) return;
    const it = this.queue[this.pos++];
    this.iteration++;
    const { W, H } = this.instance;
    const p = it.side > Math.min(W, H) + TOL ? null : this.place(it);
    if (p) this.placed.push({ id: it.id, x: p.x + it.side / 2, y: p.y + it.side / 2, side: it.side, theta: 0 });
    else this.rejected.push(it.id);
  }
  setParams(p) { Object.assign(this.options, p); }
  view() {
    const a = new Float64Array(this.placed.length * 6);
    this.placed.forEach((p, i) => { a.set([p.id, p.x, p.y, p.side, p.theta, 0], i * 6); });
    return {
      sq: a, circ: null, morph: 0, phase: this.phase, label: this.label,
      metrics: { iteration: this.iteration, energy: 0, collisions: 0, progress: this.queue.length ? this.pos / this.queue.length : 1, stage: `${this.pos}/${this.queue.length}` },
    };
  }
  result() {
    const rest = this.queue.slice(this.pos).map((i) => i.id);
    return { placements: this.placed.slice(), rejected: [...this.rejected, ...rest] };
  }
}
