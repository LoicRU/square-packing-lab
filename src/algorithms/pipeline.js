/**
 * PIPELINE « Circle Packing → Square Packing » en 5 phases OBSERVABLES.
 * Chaque image produite par view() est l'état réel du calcul à cet instant (aucune animation factice).
 *
 *  0 Génération          N cercles aléatoires (qui se chevauchent) apparaissent progressivement.
 *  1 Circle Packing      formation (séparation) puis optimisation (compaction par dichotomie + recuit).
 *  2 Transformation      chaque cercle → carré inscrit (même centre, orientation alignée sur le plus proche
 *                        voisin), puis agrandissement ×√2 pour obtenir des carrés de côté commun 1.
 *  3 Square Packing      MaxSizeSolver (dichotomie + recuit + mouvements de groupe + NFP) depuis la disposition transformée.
 *  4 Optimisation finale pool de solutions valides (réseau k×k, meilleure de la phase 3), perturbations contrôlées.
 *
 * Toute solution acceptée est certifiée par validateLayout ; la sortie finale peut être revérifiée par verifyIndependent.
 */
import { MaxSizeSolver } from './maxsize.js';
import { CirclePacker } from './circlepack.js';
import { createRng } from '../engine/rng.js';
import { validateLayout } from '../engine/validate.js';

export const PHASES = ['Génération', 'Circle Packing', 'Transformation', 'Square Packing', 'Optimisation finale'];
const SQ2 = Math.SQRT2, INS = 1 / SQ2, HALF_PI = Math.PI / 2;
const TM = 24, TS = 12; // images de transformation (morphing) puis d'agrandissement

export class PipelineSolver {
  constructor(o = {}) {
    const n = this.n = Math.max(1, Math.floor(o.n || 1));
    this.W = o.W || 1; this.seed = o.seed ?? 1; this.total = Math.max(300, o.iterations ?? 40000);
    this.params = { retries: 8, tempScale: 0.3, ampScale: 1, effort: 8, ...(o.params || {}) };
    this.k = Math.ceil(Math.sqrt(n) - 1e-12);
    this.rng = createRng(this.seed ^ 0x51ed270b);
    this.iteration = 0; this.done = false; this.phaseIdx = 0; this.label = 'Pipeline Circle → Square';
    this.events = []; this.history = []; this.stopReason = null; this.sinceFrame = 0; this.frameDue = true;
    this.frameEvery = Math.max(1, Math.round(this.total / 260));
    this.stats = PHASES.map((name) => ({ name, fill: null, S: null, a: null, unit: 'carré', iterations: 0, ms: 0, done: false, note: '' }));
    // ----- phase 0 : génération aléatoire
    const k = this.k;
    this.gx = new Float64Array(n); this.gy = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.gx[i] = 0.5 + this.rng.next() * (k - 1 || 0.0001); this.gy[i] = 0.5 + this.rng.next() * (k - 1 || 0.0001); }
    this.shown = 0; this.chunk = Math.max(1, Math.ceil(n / 24));
    const s0 = this.stats[0]; s0.unit = 'cercle'; s0.S = k; s0.a = this.W / k; s0.fill = (n * Math.PI / 4) / (k * k); s0.note = `${n} cercles aléatoires dans ${k}×${k}`;
    // ----- baseline valide (réseau k × k) = borne haute toujours disponible
    this.grid = { S: k, x: Float64Array.from({ length: n }, (_, i) => (i % k) + 0.5), y: Float64Array.from({ length: n }, (_, i) => Math.floor(i / k) + 0.5), th: new Float64Array(n) };
    this.pool = []; this.altDone = false; this.cp = null; this.sub = null; this.tr = null; this.trStep = 0; this.finalSol = null;
    this.budget = { circles: Math.min(4000, Math.max(300, Math.round(0.07 * this.total))), sq: Math.round(0.30 * this.total), fin: Math.round(0.63 * this.total) };
    this.t0 = performance.now();
  }

  get phaseName() { return PHASES[this.phaseIdx]; }
  mark(type, extra = {}) { this.events.push({ type, phase: this.phaseIdx, iteration: this.iteration, ...extra }); this.frameDue = true; }
  bump(units) { this.iteration += units; this.sinceFrame += units; this.stats[this.phaseIdx].iterations += units; if (this.sinceFrame >= this.frameEvery) { this.frameDue = true; } }
  takeFrame() { const f = this.frameDue; if (f) { this.frameDue = false; this.sinceFrame = 0; } return f; }

  /* ------------------------------------------------------------------ pas */
  step() {
    if (this.done) return;
    const t = performance.now(), ph = this.phaseIdx;
    if (ph === 0) this.stepGen(); else if (ph === 1) this.stepCircles(); else if (ph === 2) this.stepTransform(); else this.stepSquares();
    this.stats[ph].ms += performance.now() - t;
  }
  nextPhase() { this.stats[this.phaseIdx].done = true; this.phaseIdx++; this.mark('phase', { name: PHASES[this.phaseIdx] }); }

  stepGen() {
    this.shown = Math.min(this.n, this.shown + this.chunk); this.bump(1); this.frameDue = true;
    if (this.shown >= this.n) {
      this.stats[0].note += ' · chevauchements initiaux : ' + this.genOverlaps();
      this.nextPhase();
      this.cp = new CirclePacker({ n: this.n, W: this.W, seed: this.seed, iterations: this.budget.circles, init: { x: this.gx, y: this.gy }, params: { tempScale: this.params.tempScale } });
    }
  }
  genOverlaps() { let c = 0; for (let i = 0; i < this.n; i++) for (let j = i + 1; j < this.n; j++) if (Math.hypot(this.gx[i] - this.gx[j], this.gy[i] - this.gy[j]) < 1) c++; return c; }

  stepCircles() {
    const cp = this.cp, it0 = cp.iteration, wasFormed = cp.formed, s0 = cp.successCount;
    cp.step(); this.bump(cp.iteration - it0);
    if (!wasFormed && cp.formed) { this.mark('circles-formed', { S: cp.hi }); this.stats[1].note = `formation en ${cp.formIter} itérations${cp.fallback ? ' (repli réseau)' : ''}`; }
    if (cp.successCount > s0) { this.history.push({ phase: 1, iteration: this.iteration, S: cp.hi, unit: 'cercle' }); this.mark('circles-better', { S: cp.hi }); }
    if (cp.done) {
      const s = this.stats[1]; s.S = cp.hi; s.a = this.W / cp.hi; s.fill = cp.radiusFill; s.unit = 'cercle'; s.note += ` · S=${cp.hi.toFixed(4)}`;
      this.nextPhase(); this.buildTransform();
    }
  }

  /** Cercle → carré inscrit : orientation alignée sur le voisin le plus proche (modulo 90°). */
  buildTransform() {
    const n = this.n, b = this.cp.best(), ang = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let bd = Infinity, bj = -1;
      for (let j = 0; j < n; j++) { if (j === i) continue; const d = Math.hypot(b.x[i] - b.x[j], b.y[i] - b.y[j]); if (d < bd) { bd = d; bj = j; } }
      ang[i] = bj >= 0 && bd < 1.5 ? ((Math.atan2(b.y[bj] - b.y[i], b.x[bj] - b.x[i]) % HALF_PI) + HALF_PI) % HALF_PI : 0;
    }
    this.tr = { Sc: b.S, x: b.x, y: b.y, ang }; this.trStep = 0;
  }
  /** Disposition finale de la transformation, carrés de côté 1 dans S_c·√2. */
  transformed() {
    const t = this.tr, n = this.n, x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = t.x[i] * SQ2; y[i] = t.y[i] * SQ2; }
    return { S: t.Sc * SQ2, x, y, th: t.ang };
  }
  stepTransform() {
    this.trStep++; this.bump(1); this.frameDue = true;
    if (this.trStep < TM + TS) return;
    const sol = this.transformed(), pl = Array.from(sol.x, (_, i) => ({ id: i, x: sol.x[i], y: sol.y[i], side: 1, theta: sol.th[i] }));
    const ok = validateLayout(pl, sol.S, sol.S).valid;
    const s = this.stats[2]; s.unit = 'carré'; s.S = sol.S; s.a = this.W / sol.S; s.fill = this.n / (sol.S * sol.S);
    s.note = ok ? `carrés inscrits ×√2 : valide, S=${sol.S.toFixed(4)} (le réseau k×k donne S=${this.k})` : 'transformation invalide → repli sur le réseau';
    this.start3 = ok ? sol : { ...this.grid }; if (!ok) { s.S = this.k; s.a = this.W / this.k; s.fill = this.n / (this.k * this.k); }
    this.nextPhase();
    this.sub = new MaxSizeSolver({ n: this.n, W: this.W, seed: this.seed + 101, iterations: this.budget.sq, strategy: 'full', init: this.start3, params: this.params });
    this.subIt0 = 0;
  }

  stepSquares() {
    const sub = this.sub, it0 = sub.iteration;
    sub.event = null; sub.step(); this.bump(sub.iteration - it0);
    if (sub.event) {
      this.history.push({ phase: this.phaseIdx, iteration: this.iteration, S: sub.hi, unit: 'carré', type: sub.event.type });
      this.mark(sub.event.type === 'adopt' ? 'adopt' : 'square-better', { S: sub.hi });
    }
    if (!sub.done) return;
    const s = this.stats[this.phaseIdx]; if (this.phaseIdx === 4 && this.altDone && this.pool.length) { /* cumul */ }
    s.S = sub.hi; s.a = this.W / sub.hi; s.fill = this.n / (sub.hi * sub.hi); s.unit = 'carré';
    s.note = `${sub.stopReason || ''} · ${sub.attemptCount} tentatives, ${sub.successCount} succès, ${sub.relocs} relocalisations NFP, ${sub.clusterAcc} mouvements de groupe`;
    if (this.phaseIdx === 3) {
      this.nextPhase();
      const b = sub.best();
      this.sub = new MaxSizeSolver({ n: this.n, W: this.W, seed: this.seed + 202, iterations: Math.round(0.45 * this.budget.fin), strategy: 'final', init: b, params: { ...this.params, effort: this.params.effort } });
      const had = this.sub.hi, adopted = this.sub.adopt(this.grid); // pool : le réseau k×k est-il meilleur ?
      this.stats[4].note = adopted ? `réseau k×k (S=${this.k}) adopté : meilleur que S=${had.toFixed(4)}` : 'solution de la phase 3 conservée (meilleure que le réseau)';
      if (adopted) this.history.push({ phase: 4, iteration: this.iteration, S: this.k, unit: 'carré', type: 'baseline' });
      this.mark('pool', { adopted });
    } else if (!this.altDone) { // pool : deuxième solution initiale indépendante (réseau k×k) optimisée à son tour
      this.altDone = true; this.pool.push(sub.best());
      this.sub = new MaxSizeSolver({ n: this.n, W: this.W, seed: this.seed + 303, iterations: Math.round(0.55 * this.budget.fin), strategy: 'full', init: { ...this.grid }, params: this.params });
      this.stats[4].note += ` · 2e départ indépendant (réseau ${this.k}×${this.k})`; this.mark('pool-alt', { S: this.sub.hi });
    } else this.finishAll('terminé');
  }

  finishAll(reason) {
    this.stats[this.phaseIdx].done = true; this.done = true; this.stopReason = reason;
    let s = this.sub ? this.sub.best() : { ...this.grid };
    for (const c of this.pool) if (c.S < s.S - 1e-12) s = c; // meilleure solution valide du pool
    this.finalSol = s; const f = this.stats[4]; f.S = s.S; f.a = this.W / s.S; f.fill = this.n / (s.S * s.S); f.unit = 'carré'; f.done = true;
    f.note = (f.note ? f.note + ' · ' : '') + `${reason}`;
    this.phaseIdx = Math.min(this.phaseIdx, 4); this.mark('done', { S: s.S });
  }
  stop() {
    if (this.done) return;
    if (this.sub) this.sub.stop();
    if (this.phaseIdx < 3) { this.stats[this.phaseIdx].done = true; this.phaseIdx = 4; }
    this.finishAll('arrêt demandé');
  }
  setParams(p) { Object.assign(this.params, p); if (this.sub) this.sub.setParams(p); if (this.cp) this.cp.setParams(p); }

  /* ------------------------------------------------------------ sorties */
  get bestS() { return this.finalSol ? this.finalSol.S : this.sub ? Math.min(this.sub.hi, ...this.pool.map((c) => c.S)) : this.start3 ? this.start3.S : this.k; }
  get analysis() {
    const S = this.bestS, sub = this.sub;
    return {
      S, a: 1 / S, aAbs: this.W / S, lo: Math.sqrt(this.n), hi: S, history: this.history.slice(), attempts: sub ? sub.attemptCount : 0, successes: sub ? sub.successCount : 0,
      strategy: 'pipeline', stopReason: this.stopReason, tolerance: 1e-4 * S, phases: this.stats.map((p) => ({ ...p })), events: this.events.slice(-200), gridBaseline: this.k,
      relocations: sub ? sub.relocs : 0, clusterMoves: sub ? sub.clusterAcc : 0,
    };
  }
  /** Zones libres exactes (NFP) de la meilleure disposition courante : { spots, hole }. */
  freeInfo() {
    const sub = this.sub; if (!sub) return null;
    const b = sub.best(), sq = Array.from(b.x, (_, i) => ({ x: b.x[i], y: b.y[i], side: 1, theta: b.th[i] }));
    return { S: b.S, squares: sq };
  }

  view() {
    const n = this.n, W = this.W, ph = this.phaseIdx, ext = { phaseIdx: ph, phaseName: PHASES[ph], phases: this.stats.map((p) => ({ ...p })), best: this.bestS, gridBaseline: this.k };
    const base = (o) => ({ morph: 0, phase: PHASES[ph], label: this.label, ...o });
    const prog = (p) => Math.min(1, [0, 0.03, 0.12, 0.15, 0.7, 1][ph] + p * ([0.03, 0.09, 0.03, 0.55, 0.3][ph] || 0));
    if (ph === 0) {
      const k = W / this.k, c = new Float64Array(this.shown * 4), fl = new Uint8Array(this.shown);
      for (let i = 0; i < this.shown; i++) { c.set([i, this.gx[i] * k, this.gy[i] * k, 0.5 * k], i * 4); for (let j = 0; j < this.shown; j++) if (j !== i && Math.hypot(this.gx[i] - this.gx[j], this.gy[i] - this.gy[j]) < 1) fl[i] = 1; }
      return base({ sq: null, circ: c, circFlags: fl, metrics: { iteration: this.iteration, energy: 0, collisions: fl.reduce((a, b) => a + b, 0), progress: prog(this.shown / n), certArea: this.shown * Math.PI / 4 * k * k, certCount: this.shown, stage: `génération ${this.shown}/${n}` }, extra: { ...ext, S: this.k, working: true } });
    }
    if (ph === 1) {
      const v = this.cp.view(), cp = this.cp;
      return base({ sq: null, circ: v.circ, circFlags: v.circFlags, metrics: { iteration: this.iteration, energy: v.metrics.energy, collisions: v.metrics.collisions, progress: prog(cp.iteration / cp.maxSweeps), certArea: n * Math.PI / 4 * (W / v.S) ** 2, certCount: n, stage: cp.phase === 'formation' ? 'formation des cercles' : `compaction S=${cp.hi.toFixed(4)}` }, extra: { ...ext, ...v.extra, S: cp.hi, working: v.working, sub: cp.phase } });
    }
    if (ph === 2) {
      const t = this.tr, s = this.trStep, m = Math.min(1, s / TM), u = Math.max(0, (s - TM) / TS), f = 1 + (SQ2 - 1) * u, kk = W / (t.Sc * f);
      const sq = new Float64Array(n * 6), c = m < 1 ? new Float64Array(n * 4) : null;
      for (let i = 0; i < n; i++) {
        sq.set([i, t.x[i] * f * kk, t.y[i] * f * kk, INS * f * kk, t.ang[i] * m, 0], i * 6);
        if (c) c.set([i, t.x[i] * kk, t.y[i] * kk, 0.5 * kk], i * 4);
      }
      const mm = c ? Math.max(0.001, m) : 1;
      return base({ sq, circ: c, morph: mm, metrics: { iteration: this.iteration, energy: 0, collisions: 0, progress: prog(s / (TM + TS)), certArea: n * (INS * f * kk) ** 2, certCount: n, stage: m < 1 ? `cercle → carré ${(m * 100) | 0} %` : `agrandissement ×${f.toFixed(3)}` }, extra: { ...ext, S: t.Sc * f, working: true, step: s, steps: TM + TS, factor: f } });
    }
    const v = this.sub.view(), sub = this.sub;
    return base({ sq: v.sq, circ: null, metrics: { ...v.metrics, iteration: this.iteration, progress: this.done ? 1 : prog(Math.min(1, sub.iteration / sub.maxSweeps)) }, extra: { ...v.extra, ...ext, S: sub.hi, working: v.extra.working } });
  }
  result() {
    const s = this.finalSol || (this.sub ? this.sub.best() : this.start3 || this.grid), k = this.W / s.S, placements = [];
    for (let i = 0; i < this.n; i++) placements.push({ id: i, x: s.x[i] * k, y: s.y[i] * k, side: k, theta: s.th ? s.th[i] : 0 });
    return { placements, rejected: [] };
  }
}

/** Exécution complète sans interface (tests, bancs d'essai). */
export function solvePipeline(opts = {}, { maxMs = Infinity } = {}) {
  const s = new PipelineSolver(opts), t0 = performance.now();
  while (!s.done) { s.step(); if (performance.now() - t0 > maxMs) { s.stop(); break; } }
  return { solver: s, ms: performance.now() - t0, ...s.analysis, result: s.result() };
}
