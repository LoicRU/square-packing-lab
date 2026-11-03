import { ContinuousSolver } from './continuous.js';
import { SQRT2, penetration } from '../engine/geometry.js';
import { validateLayout, stripConflicts } from '../engine/validate.js';

const wrapQuarter = (a) => { let r = (a + Math.PI / 4) % (Math.PI / 2); if (r < 0) r += Math.PI / 2; return r - Math.PI / 4; };

/**
 * CIRCLE PACKING → SQUARE PACKING (méthode expérimentale, heuristique).
 *
 *  1. Cercles : chaque objet (carré de côté a) est représenté par un disque de rayon
 *     ρ = a/2 + λ·(a/√2 − a/2)  (λ=0 : disque inscrit dans le carré ; λ=1 : disque
 *     circonscrit, donc le carré est INSCRIT dans le cercle).
 *  2. Packing des cercles (solveur continu, modèle 'circle') — positions garanties
 *     sans chevauchement de disques.
 *  3. Transformation : chaque disque devient le carré de côté a de même centre.
 *       - inscrit (λ=1)      : carré ⊂ disque ⇒ non-chevauchement GARANTI ;
 *       - circonscrit (λ=0)  : aucune garantie, collisions possibles ;
 *       - optimisé           : λ choisi (ou cherché parmi 5 valeurs) + orientation
 *                              des carrés minimisant les collisions (si rotation autorisée).
 *  4. Vérification EXACTE des collisions (SAT).
 *  5. Réoptimisation : relaxation directement sur les carrés (forces/recuit), puis
 *     tentative d'insertion des objets rejetés.
 *  6. Résultat final = disposition valide la plus remplie entre le sous-ensemble
 *     certifié de la transformation brute et celle de la réoptimisation.
 */
export class CircleSquareSolver {
  constructor(instance, o = {}) {
    this.instance = instance;
    this.o = { transform: 'optimized', lambda: 0.5, radiusSearch: false, relaxer: 'forces', iterations: 3000, ...o };
    const t = this.o.transform;
    this.lambdas = t === 'inscribed' ? [1] : t === 'circumscribed' ? [0] : this.o.radiusSearch ? [0, 0.25, 0.5, 0.75, 1] : [this.o.lambda];
    this.trialIdx = 0; this.bestTrial = null; this.phase = 'circles'; this.done = false;
    this.iterTotal = 0; this.morphSteps = 40; this.morphStep = 0; this.circles = []; this.sqRaw = []; this.rawValid = null;
    this.label = 'Circle → Square';
    this.startTrial();
  }
  get lambda() { return this.lambdas[this.trialIdx]; }
  startTrial() {
    const lam = this.lambda, per = Math.max(30, Math.floor((0.4 * this.o.iterations) / this.lambdas.length));
    const dims = this.instance.items.map((it) => it.side / 2 + lam * (it.side / SQRT2 - it.side / 2));
    this.circle = new ContinuousSolver(this.instance, { model: 'circle', relaxer: 'forces', dims, iterations: per, seed: this.instance.seed + this.trialIdx, label: 'Circle packing' });
  }
  /** Transforme une disposition de cercles en carrés (orientation optionnelle). */
  transform(circles) {
    const { W, H, items, rotation } = this.instance;
    const sq = circles.map((c) => ({ id: c.id, x: c.x, y: c.y, side: items[c.id].side, theta: 0 }));
    if (this.o.transform === 'optimized' && rotation) this.optimizeOrientation(sq);
    return sq;
  }
  /** Orientation gloutonne (pas de 5°) : minimise nb de collisions puis profondeur. */
  optimizeOrientation(sq) {
    const { W, H } = this.instance, n = sq.length;
    if (!n) return;
    const nb = sq.map((q, i) => { const L = []; for (let j = 0; j < n; j++) if (j !== i && Math.hypot(sq[j].x - q.x, sq[j].y - q.y) < (q.side + sq[j].side) / SQRT2) L.push(j); return L; });
    const order = sq.map((_, i) => i).sort((a, b) => sq[b].side - sq[a].side);
    const cost = (i, a) => {
      const q = sq[i], old = q.theta; q.theta = a;
      const he = (q.side / 2) * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      let c = Math.max(0, he - q.x, q.x + he - W, he - q.y, q.y + he - H) * 1e4;
      for (const j of nb[i]) { const d = penetration(q, sq[j]); if (d > 1e-9) c += 10 + d; }
      q.theta = old; return c;
    };
    for (let pass = 0; pass < 2; pass++) for (const i of order) {
      let best = sq[i].theta, bc = cost(i, best);
      for (let k = 0; k < 18; k++) { const a = (k * 5 * Math.PI) / 180, c = cost(i, a); if (c < bc - 1e-12) { bc = c; best = a; } }
      sq[i].theta = best;
    }
  }
  finishTrial() {
    const circles = this.circle.circleLayout(), sq = this.transform(circles);
    const v = validateLayout(sq, this.instance.W, this.instance.H);
    const score = v.validArea;
    if (!this.bestTrial || score > this.bestTrial.score) this.bestTrial = { circles, sq, v, score, lambda: this.lambda };
    this.iterTotal += this.circle.iter;
    if (++this.trialIdx < this.lambdas.length) { this.startTrial(); return; }
    this.circles = this.bestTrial.circles; this.sqRaw = this.bestTrial.sq; this.rawValid = this.bestTrial.v;
    this.phase = 'transform'; this.morphStep = 0; this.label = `Transformation cercle → carré (λ=${this.bestTrial.lambda.toFixed(2)})`;
  }
  startRepair() {
    this.phase = 'repair'; this.label = 'Réoptimisation sur les carrés';
    const remaining = Math.max(60, this.o.iterations - this.iterTotal);
    this.square = new ContinuousSolver(this.instance, {
      model: 'square', relaxer: this.o.relaxer, iterations: remaining, initial: this.sqRaw, seed: this.instance.seed + 77, label: this.label,
    });
  }
  step() {
    if (this.done) return;
    if (this.phase === 'circles') { this.circle.step(); if (this.circle.done) this.finishTrial(); }
    else if (this.phase === 'transform') { this.morphStep++; if (this.morphStep >= this.morphSteps) this.startRepair(); }
    else if (this.phase === 'repair') { this.square.step(); if (this.square.done) { this.phase = 'done'; this.done = true; this.label = 'Terminé'; } }
  }
  get iteration() {
    return this.iterTotal + (this.phase === 'circles' ? this.circle.iter : 0) + this.morphStep + (this.square ? this.square.iter : 0);
  }
  setParams(p) {
    if (p.relaxer) this.o.relaxer = p.relaxer;
    if (this.circle && this.phase === 'circles') this.circle.setParams(p);
    if (this.square) this.square.setParams(p);
  }
  view() {
    if (this.phase === 'circles') {
      const v = this.circle.view();
      return { ...v, label: `Circle packing · λ=${this.lambda.toFixed(2)}${this.lambdas.length > 1 ? ` (essai ${this.trialIdx + 1}/${this.lambdas.length})` : ''}`, phase: 'circles', metrics: { ...v.metrics, iteration: this.iteration } };
    }
    if (this.phase === 'transform') {
      const c = new Float64Array(this.circles.length * 4); this.circles.forEach((q, i) => c.set([q.id, q.x, q.y, q.r], i * 4));
      const s = new Float64Array(this.sqRaw.length * 6);
      this.sqRaw.forEach((q, i) => s.set([q.id, q.x, q.y, q.side, q.theta, this.rawValid.flags[i]], i * 6));
      return { sq: s, circ: c, morph: Math.min(1, this.morphStep / this.morphSteps), phase: 'transform', label: this.label,
        metrics: { iteration: this.iteration, energy: 0, collisions: this.rawValid.pairs.length + this.rawValid.oob.length, certArea: this.rawValid.validArea, certCount: this.rawValid.n - this.rawValid.nBad, progress: 0.5, stage: `collisions après transformation : ${this.rawValid.pairs.length}` } };
    }
    const v = this.square.view();
    return { ...v, label: this.label, phase: this.phase === 'done' ? 'done' : 'repair', metrics: { ...v.metrics, iteration: this.iteration } };
  }
  result() {
    const { W, H } = this.instance;
    const candidates = [];
    if (this.square) candidates.push(this.square.result());
    if (this.sqRaw.length) { const { kept } = stripConflicts(this.sqRaw, W, H); const ids = new Set(kept.map((p) => p.id)); candidates.push({ placements: kept, rejected: this.instance.items.map((i) => i.id).filter((i) => !ids.has(i)) }); }
    if (!candidates.length) {
      // arrêt pendant la phase de cercles : disposition transformée de l'état courant
      const sq = this.transform(this.circle.circleLayout()), { kept } = stripConflicts(sq, W, H), ids = new Set(kept.map((p) => p.id));
      candidates.push({ placements: kept, rejected: this.instance.items.map((i) => i.id).filter((i) => !ids.has(i)) });
    }
    const area = (c) => c.placements.reduce((a, p) => a + p.side * p.side, 0);
    return candidates.sort((a, b) => area(b) - area(a))[0];
  }
  /** Informations d'analyse de la dernière transformation (affichage / étude). */
  get analysis() {
    return this.rawValid ? { lambda: this.bestTrial.lambda, rawCollisions: this.rawValid.pairs.length, rawOob: this.rawValid.oob.length, rawCertifiedArea: this.rawValid.validArea, rawPlaced: this.rawValid.n - this.rawValid.nBad, circlesPlaced: this.circles.length } : null;
  }
}
