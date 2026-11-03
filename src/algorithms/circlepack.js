/**
 * Phase « Circle Packing » : N disques identiques (diamètre 1) dans un conteneur S × S,
 * on minimise S (donc on maximise le rayon commun). Même schéma que le solveur de carrés :
 *  1. FORMATION : à partir de positions générées au hasard (qui se chevauchent), un recuit
 *     + projection les sépare jusqu'à zéro chevauchement (conteneur S0 = ⌈√N⌉, toujours faisable).
 *  2. OPTIMISATION : dichotomie sur S (cible sous la meilleure solution), recuit sur les
 *     positions, projection finale exacte, certification indépendante (distances).
 * Aucune garantie d'optimalité ; borne basse indicative par la densité hexagonale.
 */
import { createRng } from '../engine/rng.js';
import { Grid } from '../engine/grid.js';

export const CGAP = 2e-5;

export class CirclePacker {
  constructor(o = {}) {
    const n = this.n = Math.max(1, Math.floor(o.n || 1));
    this.W = o.W || 1; this.seed = o.seed ?? 1; this.maxSweeps = Math.max(20, o.iterations ?? 4000);
    this.params = { tempScale: 0.3, effort: 6, retries: 6, ...(o.params || {}) };
    this.rng = createRng(this.seed ^ 0x9e3779b9);
    this.d = 1 + CGAP;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.bx = new Float64Array(n); this.by = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.dx = new Float64Array(n); this.dy = new Float64Array(n);
    this.flags = new Uint8Array(n);
    this.iteration = 0; this.done = false; this.attempt = null; this.attemptCount = 0; this.successCount = 0; this.retry = 0; this.target = null; this.closeCount = 0;
    this.curE = 0; this.curColl = 0; this.history = [];
    const k = this.k = Math.ceil(Math.sqrt(n) - 1e-12);
    this.S0 = k; this.hi = k; this.lo = Math.max(1, 0.97 * Math.sqrt((n * Math.PI) / 4 / 0.9069)); this.lo0 = this.lo; this.hi0 = k;
    this.formed = false; this.tol = 1e-4; this.stopReason = null;
    // positions initiales : fournies (génération) ou aléatoires
    const init = o.init;
    for (let i = 0; i < n; i++) {
      this.x[i] = init ? init.x[i] : 0.5 + this.rng.next() * (k - 1);
      this.y[i] = init ? init.y[i] : 0.5 + this.rng.next() * (k - 1);
      this.bx[i] = (i % k) + 0.5; this.by[i] = Math.floor(i / k) + 0.5; // repli : réseau valide
    }
    this.S = k; this.phase = 'formation';
    this.grid = new Grid(k, k, this.d + 1e-9, n); for (let i = 0; i < n; i++) this.grid.insert(i, this.x[i], this.y[i]);
    this.startFormation();
  }

  rebuild(S) { this.S = S; this.grid = new Grid(S, S, this.d + 1e-9, this.n); for (let i = 0; i < this.n; i++) this.grid.insert(i, this.x[i], this.y[i]); }
  localE(i, x, y) {
    const S = this.S, d = this.d, X = this.x, Y = this.y, r = d / 2;
    const ex = Math.max(0, r - x, x + r - S, r - y, y + r - S);
    let e = ex * ex;
    this.grid.near(x, y, (j) => { if (j === i) return; const dd = Math.hypot(x - X[j], y - Y[j]); if (dd < d) { const p = d - dd; e += p * p; } });
    return e;
  }
  measure() {
    const n = this.n, S = this.S, d = this.d, r = d / 2; let E = 0, c = 0; this.flags.fill(0);
    for (let i = 0; i < n; i++) { const ex = Math.max(0, r - this.x[i], this.x[i] + r - S, r - this.y[i], this.y[i] + r - S); if (ex > 1e-9) { E += ex * ex; c++; this.flags[i] = 1; } }
    this.grid.pairs((i, j) => { const dd = Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]); if (dd < d - 1e-9) { const p = d - dd; E += p * p; c++; this.flags[i] = 1; this.flags[j] = 1; } });
    this.curE = E; this.curColl = c; return E;
  }
  project(maxIter = 400) {
    const n = this.n, d = this.d, S = this.S, r = d / 2, dx = this.dx, dy = this.dy, rng = this.rng;
    this.px.set(this.x); this.py.set(this.y);
    const clamp = () => { for (let i = 0; i < n; i++) { this.x[i] = Math.min(Math.max(this.x[i], r), S - r); this.y[i] = Math.min(Math.max(this.y[i], r), S - r); } };
    clamp();
    for (let it = 0; it < maxIter; it++) {
      for (let i = 0; i < n; i++) this.grid.move(i, this.x[i], this.y[i]);
      dx.fill(0); dy.fill(0); let cnt = 0;
      this.grid.pairs((i, j) => {
        let vx = this.x[j] - this.x[i], vy = this.y[j] - this.y[i], dd = Math.hypot(vx, vy);
        if (dd >= d - 1e-12) return;
        cnt++; if (dd < 1e-12) { const a = rng.next() * 6.283; vx = Math.cos(a); vy = Math.sin(a); dd = 1; }
        const f = ((d - dd) * 0.51 + 1e-10) / dd; dx[i] -= vx * f; dy[i] -= vy * f; dx[j] += vx * f; dy[j] += vy * f;
      });
      if (cnt === 0) return true;
      for (let i = 0; i < n; i++) { this.x[i] += dx[i] * 0.9; this.y[i] += dy[i] * 0.9; }
      clamp();
    }
    this.x.set(this.px); this.y.set(this.py); for (let i = 0; i < n; i++) this.grid.move(i, this.x[i], this.y[i]);
    return false;
  }
  /** Certification indépendante : distances ≥ 1 et disques dans le conteneur (diamètre 1 exact). */
  certify(S) {
    for (let i = 0; i < this.n; i++) {
      if (this.x[i] < 0.5 - 1e-9 || this.x[i] > S - 0.5 + 1e-9 || this.y[i] < 0.5 - 1e-9 || this.y[i] > S - 0.5 + 1e-9) return false;
      for (let j = i + 1; j < this.n; j++) if (Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]) < 1 - 1e-9) return false;
    }
    return true;
  }

  startFormation() {
    // positions déjà dans this.x/this.y (générées) ; on les sépare à S0 = k
    this.target = this.S0; this.rebuild(this.S0);
    const base = Math.min(3000, 8 * (100 + 5 * this.n));
    this.attempt = { t: this.S0, kind: 'formation', sweep: 0, max: base, T0: 0.02 * this.params.tempScale / 0.3, Tend: 1e-8, lastProj: -99 };
    this.amp = 0.3; this.measure();
  }
  startAttempt() {
    if (this.iteration >= this.maxSweeps) { this.finish('budget d’itérations atteint'); return false; }
    if (this.hi - this.lo <= this.tol * this.hi) {
      if (this.iteration < 0.8 * this.maxSweeps && this.closeCount < 6) { this.closeCount++; this.lo = Math.max(this.lo0, this.hi * (1 - 0.02 * this.closeCount)); this.target = null; this.retry = 0; }
      else { this.finish('intervalle refermé'); return false; }
    }
    if (this.target === null) this.target = this.hi - Math.min(0.5 * (this.hi - this.lo), 0.05 * this.hi);
    const t = this.target, n = this.n, rng = this.rng, kinds = ['compress', 'compress', 'hex', 'compress', 'random'], kind = kinds[this.attemptCount % kinds.length];
    if (kind === 'compress') { const f = t / this.hi; for (let i = 0; i < n; i++) { this.x[i] = this.bx[i] * f; this.y[i] = this.by[i] * f; } }
    else if (kind === 'hex') {
      const rows = Math.ceil(Math.sqrt(n)), cols = Math.ceil(n / rows), sx = cols > 1 ? (t - 1) / (cols - 0.5) : 0, sy = rows > 1 ? (t - 1) / (rows - 1) : 0; let i = 0;
      for (let r = 0; r < rows && i < n; r++) for (let c = 0; c < cols && i < n; c++, i++) { this.x[i] = 0.5 + c * sx + (r % 2 ? sx / 2 : 0) + (rng.next() - 0.5) * 0.02; this.y[i] = 0.5 + r * sy + (rng.next() - 0.5) * 0.02; }
    } else for (let i = 0; i < n; i++) { this.x[i] = 0.5 + rng.next() * (t - 1); this.y[i] = 0.5 + rng.next() * (t - 1); }
    this.rebuild(t);
    const comp = kind === 'compress';
    this.amp = comp ? 0.12 : 0.4;
    this.attempt = { t, kind, sweep: 0, max: Math.round(Math.min(5000, this.params.effort * (100 + 5 * n)) * (1 + 0.5 * this.retry)), T0: (comp ? 0.003 * (1 + this.retry) : 0.03) * this.params.tempScale, Tend: 1e-8, lastProj: -99 };
    this.attemptCount++; this.measure(); return true;
  }
  endAttempt(success) {
    const a = this.attempt; this.attempt = null;
    if (a.kind === 'formation') {
      if (success) { this.bx.set(this.x); this.by.set(this.y); this.history.push({ iteration: this.iteration, S: this.S0, note: 'formation' }); }
      else { for (let i = 0; i < this.n; i++) { this.x[i] = this.bx[i]; this.y[i] = this.by[i]; } this.rebuild(this.S0); this.fallback = true; }
      this.formed = true; this.formIter = this.iteration; this.phase = 'optimisation'; this.target = null; return;
    }
    if (success) { this.successCount++; this.bx.set(this.x); this.by.set(this.y); this.hi = a.t; this.history.push({ iteration: this.iteration, S: this.hi }); this.retry = 0; this.target = null; this.closeCount = 0; }
    else { this.retry++; if (this.retry >= (this.hi - this.lo > 0.08 * this.hi ? 3 : this.params.retries)) { this.lo = Math.max(this.lo, a.t); this.retry = 0; this.target = null; } }
  }
  tryFinish(a) {
    if (this.project() && this.certify(a.t)) { this.measure(); this.endAttempt(true); return true; }
    this.measure(); return false;
  }
  sweep(T) {
    const n = this.n, rng = this.rng, S = this.S, amp = this.amp; let acc = 0;
    for (let m = 0; m < n; m++) {
      const i = Math.floor(rng.next() * n), ox = this.x[i], oy = this.y[i];
      const nx = Math.min(S, Math.max(0, ox + (rng.next() * 2 - 1) * amp)), ny = Math.min(S, Math.max(0, oy + (rng.next() * 2 - 1) * amp));
      const dE = this.localE(i, nx, ny) - this.localE(i, ox, oy);
      if (dE <= 0 || rng.next() < Math.exp(-dE / T)) { this.x[i] = nx; this.y[i] = ny; this.grid.move(i, nx, ny); acc++; }
    }
    const rate = acc / n; this.amp = Math.min(0.6, Math.max(1e-4, this.amp * (rate > 0.45 ? 1.12 : rate < 0.25 ? 0.88 : 1)));
  }
  advance() {
    if (!this.attempt && !this.startAttempt()) return;
    const a = this.attempt, T = Math.max(1e-12, a.T0 * Math.pow(a.Tend / a.T0, a.sweep / a.max));
    this.sweep(T); a.sweep++; this.iteration++;
    const last = a.sweep >= a.max;
    if (a.sweep % 4 === 0 || last) { const E = this.measure(); if (E < 1e-3 && a.sweep - a.lastProj >= 6) { a.lastProj = a.sweep; if (this.tryFinish(a)) return; } }
    if (last) { if (!this.tryFinish(a)) this.endAttempt(false); }
  }
  step() { if (this.done) return; const k = Math.max(1, Math.ceil(40 / this.n)); for (let s = 0; s < k && !this.done; s++) this.advance(); }
  finish(reason) { this.done = true; this.attempt = null; this.stopReason = reason; this.phase = 'terminé'; for (let i = 0; i < this.n; i++) { this.x[i] = this.bx[i]; this.y[i] = this.by[i]; } this.rebuild(this.hi); this.measure(); }
  stop() { if (!this.done) this.finish('arrêt demandé'); }
  setParams(p) { Object.assign(this.params, p); }

  /** Disposition valide courante : { S, x, y } (diamètre 1). */
  best() { return { S: this.hi, x: this.bx.slice(), y: this.by.slice() }; }
  get radiusFill() { return (this.n * Math.PI * 0.25) / (this.hi * this.hi); }
  view() {
    const working = !!this.attempt && !this.done, S = working ? this.S : this.hi, k = this.W / S, X = working ? this.x : this.bx, Y = working ? this.y : this.by;
    const c = new Float64Array(this.n * 4); for (let i = 0; i < this.n; i++) c.set([i, X[i] * k, Y[i] * k, 0.5 * k], i * 4);
    return { circ: c, circFlags: working ? this.flags.slice() : new Uint8Array(this.n), S, working, metrics: { iteration: this.iteration, energy: this.curE, collisions: working ? this.curColl : 0 }, extra: { S: this.hi, lo: this.lo, target: this.attempt ? this.attempt.t : null, attempt: this.attemptCount, successes: this.successCount, attemptColl: this.curColl, attemptE: this.curE, kind: this.attempt ? this.attempt.kind : null, working } };
  }
}
