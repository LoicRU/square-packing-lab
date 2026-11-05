/**
 * UN CYCLE DE RECHERCHE = une tâche bornée en temps exécutée par un worker.
 * Isomorphe (navigateur / Node / worker_threads) : le même code tourne dans les tests, en thread et en production.
 *
 * spec = { n, seed, origin:'best'|'diverse'|'recomb'|'random', strategy:'direct'|'anneal'|'circle'|'evo',
 *          parents:[solution,…], op:{name,amp}, budgetMs }
 * Les solutions sont en unités « côté du petit carré = 1 » : { n, S, x[], y[], th[] }.
 */
import { MaxSizeSolver } from '../algorithms/maxsize.js';
import { PipelineSolver } from '../algorithms/pipeline.js';
import { createRng } from '../engine/rng.js';
import { mutate, recombine } from './evolve.js';
import { stripSearch, stripLayout } from '../algorithms/strips.js';
import { validateLayout } from '../engine/validate.js';
import { polishSLP } from '../algorithms/slp.js';
import { HopSolver, transferFrom, isValid as hopValid } from '../algorithms/hop.js';

/** Candidats « bande inclinée » par N (balayage déterministe, ~0,2 s, calculé une fois par worker). */
const STRIP_CACHE = new Map();
const stripCandidates = (n) => { if (!STRIP_CACHE.has(n)) STRIP_CACHE.set(n, stripSearch(n, { maxMs: 3000, keep: 12 })); return STRIP_CACHE.get(n); };
const layoutValid = (L) => validateLayout(L.x.map((x, i) => ({ x, y: L.y[i], side: 1, theta: L.th[i] })), L.S, L.S).valid;

const toPlain = (b, n) => ({ n, S: b.S, x: Array.from(b.x), y: Array.from(b.y), th: Array.from(b.th) });

export class Cycle {
  constructor(spec, now = () => performance.now()) {
    this.spec = spec; this.now = now; this.n = spec.n; this.t0 = now(); this.done = false; this.iterations = 0; this.stopReason = null;
    const rng = createRng((spec.seed >>> 0) ^ 0x2545f491), parents = spec.parents || [];
    this.startS = Infinity; this.kind = spec.strategy;
    if (spec.strategy === 'circle') {
      this.solver = new PipelineSolver({ n: spec.n, W: 1, seed: spec.seed, iterations: Math.round(Math.min(200000, Math.max(5000, 2e6 / spec.n))) });
      this.kind = 'circle';
    } else if (spec.strategy === 'pattern' && (this.init = this.patternInit(spec, rng))) {
      this.startS = this.init.S; this.kind = 'pattern';
      this.solver = new MaxSizeSolver({ n: spec.n, W: 1, seed: spec.seed, iterations: 1e9, strategy: 'final', init: this.init, params: { effort: spec.effort || 6 } });
    } else if (spec.strategy === 'hop') {
      const init = this.hopInit(spec, rng); this.startS = init ? init.S : Infinity; this.kind = 'hop';
      this.solver = new HopSolver({ n: spec.n, seed: spec.seed, init, budgetMs: spec.budgetMs || 8000, now });
    } else if (spec.strategy === 'evo' && parents.length) {
      const A = parents[0], init = { S: A.S, x: A.x, y: A.y, th: A.th };
      let seedLayout;
      if (spec.origin === 'recomb' && parents.length > 1) {
        const B = parents[1]; seedLayout = recombine(A, B, rng);
        const better = A.S <= B.S ? A : B; init.S = better.S; init.x = better.x; init.y = better.y; init.th = better.th;
      } else seedLayout = mutate(A, rng, spec.op || {});
      this.startS = init.S;
      this.solver = new MaxSizeSolver({ n: spec.n, W: 1, seed: spec.seed, iterations: 1e9, strategy: 'final', init, seedLayout, params: { effort: spec.effort || 6 } });
    } else {
      this.solver = new MaxSizeSolver({ n: spec.n, W: 1, seed: spec.seed, iterations: 1e9, strategy: spec.strategy === 'anneal' ? 'anneal' : 'full', params: { effort: spec.effort || 6 } });
    }
    this.pipeline = this.solver instanceof PipelineSolver;
  }
  /** Départ du basin hopping : parent élite, sinon transfert depuis un packing de N±1, sinon motif à bande, sinon grille (null). */
  hopInit(spec, rng) {
    const par = (spec.parents || [])[0]; if (par && hopValid(par)) return par;
    for (const nb of (spec.neighbors || [])) { if (!nb) continue; const T = transferFrom(nb, spec.n, rng); if (T && hopValid(T)) { this.transferred = true; return polishSLP(T, { maxMs: Math.min(1500, 0.15 * (spec.budgetMs || 8000)), now: this.now }); } }
    return this.patternInit(spec, rng);
  }
  /** Disposition de départ issue d'un motif (valide par construction, revérifiée) ; null si aucun motif ne bat la grille. */
  patternInit(spec, rng) {
    const c = stripCandidates(spec.n); if (!c.length) return null;
    const top = c.slice(0, Math.min(6, c.length)), cand = top[Math.floor(rng.next() * top.length)];
    const L = stripLayout(spec.n, cand, rng); if (!L || !layoutValid(L)) return null;
    const P = polishSLP(L, { maxMs: Math.min(2000, 0.25 * (spec.budgetMs || 8000)), now: this.now }); // affinage continu (toujours valide)
    return layoutValid(P) ? P : L;
  }
  get S() { return this.pipeline ? this.solver.bestS : this.solver.hi; }
  elapsed() { return this.now() - this.t0; }
  /** Avance d'au plus maxMs millisecondes ; passe `done` à la fin du budget / du solveur. */
  step(maxMs = 8) {
    if (this.done) return;
    const t = this.now(), s = this.solver;
    do { s.step(); } while (!s.done && this.now() - t < maxMs);
    this.iterations = s.iteration || 0;
    if (s.done) { this.done = true; this.stopReason = s.stopReason || 'terminé'; }
    else if (this.elapsed() > this.spec.budgetMs) { s.stop(); this.done = true; this.stopReason = 'budget de temps'; }
  }
  /** Meilleure solution VALIDE du cycle (le solveur ne publie que des solutions certifiées). */
  best() {
    const s = this.solver;
    if (!this.pipeline) return toPlain(s.best(), this.n);
    const f = s.finalSol || (s.sub ? s.sub.best() : s.start3 || s.grid);
    return toPlain(f, this.n);
  }
  /** Image légère de l'état RÉEL du moteur : positions courantes (avec collisions temporaires) ou meilleure solution. */
  frame(full = false) {
    const s = this.solver, n = this.n;
    if (this.pipeline) {
      const v = s.view(), a = v.sq, c = v.circ, out = new Float32Array(n * 3), fl = new Uint8Array(n);
      if (a && a.length) for (let i = 0; i < n && i * 6 + 5 < a.length; i++) { out[i * 3] = a[i * 6 + 1] / a[i * 6 + 3]; out[i * 3 + 1] = a[i * 6 + 2] / a[i * 6 + 3]; out[i * 3 + 2] = a[i * 6 + 4]; fl[i] = a[i * 6 + 5]; }
      else if (c && c.length) for (let i = 0; i < n && i * 4 + 3 < c.length; i++) { out[i * 3] = c[i * 4 + 1] / (2 * c[i * 4 + 3]); out[i * 3 + 1] = c[i * 4 + 2] / (2 * c[i * 4 + 3]); }
      return { S: v.extra.S, container: a && a.length ? 1 / a[3] : v.extra.S, xyt: out, flags: fl, working: !!v.extra.working, phase: v.extra.phaseName, it: this.iterations, best: this.S };
    }
    const working = !!s.attempt && !s.done, S = working ? s.S : s.hi, X = working ? s.x : s.bx, Y = working ? s.y : s.by, T = working ? s.th : s.bth, out = new Float32Array(n * 3), fl = new Uint8Array(n);
    for (let i = 0; i < n; i++) { out[i * 3] = X[i]; out[i * 3 + 1] = Y[i]; out[i * 3 + 2] = T[i]; fl[i] = working ? s.flags[i] : 0; }
    return { S, container: S, xyt: out, flags: fl, working, target: s.attempt ? s.attempt.t : null, kind: s.attempt ? s.attempt.kind : null, free: full ? s.freeSpots : null, it: this.iterations, best: s.hi };
  }
  /** Affinage final (SLP) de la meilleure solution du cycle : strictement monotone, toujours revalidé ; renvoie { sol, gain }. */
  finalize() {
    const sol = this.best();
    if (this.pipeline || this.spec.polish === false || this.stopReason === 'arrêt demandé') return { sol, gain: 0 };
    const P = polishSLP(sol, { maxMs: Math.min(1500, 0.12 * (this.spec.budgetMs || 8000)), now: this.now });
    if (P.S < sol.S - 1e-12 && layoutValid(P)) return { sol: { n: this.n, S: P.S, x: P.x, y: P.y, th: P.th }, gain: sol.S - P.S };
    return { sol, gain: 0 };
  }
  stop() { if (!this.done) { this.solver.stop(); this.done = true; this.stopReason = 'arrêt demandé'; } }
}

/** Budget de temps par défaut d'un cycle selon N (ms). */
export const defaultBudgetMs = (n) => Math.min(60000, 4000 + 160 * n);
