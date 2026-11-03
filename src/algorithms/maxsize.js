/**
 * PROBLÈME « TAILLE MAXIMALE » : N carrés IDENTIQUES, rotation libre, tous placés,
 * on cherche le plus grand côté commun a dans un conteneur de côté W.
 *
 * Formulation équivalente normalisée : carrés unité, conteneur S × S, on
 * minimise S  (a = W / S ; remplissage = N / S²).
 *
 * Méthode (heuristique — aucune garantie d'optimalité globale) :
 *  1. Borne haute valide : le réseau k × k, k = ⌈√N⌉  (S = k).
 *  2. Borne basse prouvée : S ≥ √N (aire).
 *  3. RECHERCHE DICHOTOMIQUE sur S : on teste une cible t ∈ ]lo, hi[ ; si une
 *     disposition SANS aucune pénétration est trouvée (certifiée par le SAT
 *     exact), hi ← t ; sinon, après plusieurs tentatives, lo ← t
 *     (« limite explorée », PAS une preuve d'impossibilité).
 *  4. Pour une cible t : plusieurs configurations initiales (compression de la
 *     meilleure solution, réseaux décalés ou tournés, hexagonal, aléatoire,
 *     issue de cercles) puis RECUIT SIMULÉ sur positions ET angles (énergie =
 *     Σ pénétration² SAT + débordements²), avec mouvements de « téléportation »
 *     du carré le plus contraint vers le meilleur trou, puis PROJECTION locale
 *     (répulsion le long de la normale SAT) pour atteindre une pénétration nulle.
 *
 * Les carrés sont gonflés de GAP pendant la relaxation : une disposition sans
 * pénétration à (1+GAP) est valide avec marge à 1. Elle est de toute façon
 * re-vérifiée par validateLayout avant d'être acceptée.
 */
import { createRng } from '../engine/rng.js';
import { satPenCS, halfExtent } from '../engine/geometry.js';
import { Grid } from '../engine/grid.js';
import { validateLayout } from '../engine/validate.js';
import { freeCenters } from '../engine/nfp.js';

export const GAP = 2e-5;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const KINDS = {
  full: ['compress', 'grid', 'compress', 'rotgrid', 'compress', 'hex', 'compress', 'random', 'circle'],
  anneal: ['random', 'grid', 'rotgrid', 'hex', 'random'],
  circle: ['circle'],
  final: ['compress', 'pert', 'compress', 'pert', 'grid', 'compress', 'rotgrid', 'pert'],
};
export const STRATEGIES = {
  full: 'Dichotomie + recuit + compression (complet)',
  anneal: 'Recuit multi-départs seul',
  circle: 'Circle → Square (expérimental)',
  final: 'Optimisation finale (perturbations + pool)',
};

export class MaxSizeSolver {
  constructor(o = {}) {
    const n = this.n = Math.max(1, Math.floor(o.n || 1));
    this.W = o.W || 1;
    this.seed = o.seed ?? 1;
    this.maxSweeps = Math.max(10, o.iterations ?? 8000);
    this.strategy = KINDS[o.strategy] ? o.strategy : 'full';
    this.params = { retries: 8, tempScale: 0.3, ampScale: 1, effort: 8, ...(o.params || {}) };
    this.rng = createRng(this.seed);
    this.d = 1 + GAP;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.th = new Float64Array(n);
    this.bx = new Float64Array(n); this.by = new Float64Array(n); this.bth = new Float64Array(n);
    this.cs = new Float64Array(n).fill(1); this.sn = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n); this.pth = new Float64Array(n);
    this.dx = new Float64Array(n); this.dy = new Float64Array(n);
    this.flags = new Uint8Array(n);
    this.tmp = new Float64Array(2);
    this.iteration = 0; this.done = false; this.attemptCount = 0; this.successCount = 0;
    this.attempt = null; this.retry = 0; this.target = null; this.S = 1; this.closeCount = 0; this.elite = null;
    this.curE = 0; this.curColl = 0; this.curMaxPen = 0;
    this.history = []; this.phase = 'init'; this.label = 'Taille maximale';
    this.lo = Math.sqrt(n);
    const k = Math.ceil(Math.sqrt(n) - 1e-12);
    this.hi = k; this.hi0 = k; this.lo0 = this.lo;
    for (let i = 0; i < n; i++) { this.bx[i] = (i % k) + 0.5; this.by[i] = Math.floor(i / k) + 0.5; this.bth[i] = 0; }
    if (o.init && o.init.x && o.init.S > 0) { // départ imposé : disposition VALIDE fournie par une phase précédente
      for (let i = 0; i < n; i++) { this.bx[i] = o.init.x[i]; this.by[i] = o.init.y[i]; this.bth[i] = o.init.th ? o.init.th[i] : 0; }
      this.hi = this.hi0 = o.init.S;
    }
    this.seedLayout = o.seedLayout || null; this.seedDone = false; this.lastKind = null;
    this.event = null; this.freeSpots = null; this.relocs = 0; this.clusterAcc = 0;
    this.history.push({ iteration: 0, S: this.hi });
    this.tol = 1e-4;
    this.grid = null;
    this.loadBest(this.hi);
    // Trivial : conteneur k × k avec k² = N, ou borne de surface atteinte.
    if (this.hi - this.lo <= 1e-9) this.finish('borne de surface atteinte');
  }

  /* ------------------------------------------------------------------ état */
  setPose(i, x, y, th) { this.x[i] = x; this.y[i] = y; this.th[i] = th; this.cs[i] = Math.cos(th); this.sn[i] = Math.sin(th); }
  rebuildGrid(S) {
    this.S = S;
    this.grid = new Grid(S, S, this.d * Math.SQRT2 + 1e-9, this.n);
    for (let i = 0; i < this.n; i++) this.grid.insert(i, this.x[i], this.y[i]);
  }
  loadBest(S) {
    for (let i = 0; i < this.n; i++) this.setPose(i, this.bx[i], this.by[i], this.bth[i]);
    this.rebuildGrid(S);
  }

  /** Énergie locale du carré i à la pose (x,y,c,s) : pénétrations² + débordement². */
  localE(i, x, y, c, s) {
    const d = this.d, S = this.S, h = (d / 2) * (Math.abs(c) + Math.abs(s));
    let e = 0;
    const ex = Math.max(0, h - x, x + h - S, h - y, y + h - S);
    e += ex * ex;
    const X = this.x, Y = this.y, C = this.cs, N = this.sn;
    this.grid.near(x, y, (j) => {
      if (j === i) return;
      const p = satPenCS(x, y, d, c, s, X[j], Y[j], d, C[j], N[j], null);
      if (p > 0) e += p * p;
    });
    return e;
  }

  /** Énergie totale + collisions courantes (met à jour les drapeaux d'affichage). */
  measure() {
    const n = this.n, d = this.d, S = this.S;
    let E = 0, coll = 0, maxPen = 0; this.flags.fill(0);
    for (let i = 0; i < n; i++) {
      const h = halfExtent(d, this.th[i]);
      const ex = Math.max(0, h - this.x[i], this.x[i] + h - S, h - this.y[i], this.y[i] + h - S);
      if (ex > 1e-9) { E += ex * ex; coll++; this.flags[i] = 1; if (ex > maxPen) maxPen = ex; }
    }
    this.grid.pairs((i, j) => {
      const p = satPenCS(this.x[i], this.y[i], d, this.cs[i], this.sn[i], this.x[j], this.y[j], d, this.cs[j], this.sn[j], null);
      if (p > 1e-9) { E += p * p; coll++; this.flags[i] = 1; this.flags[j] = 1; if (p > maxPen) maxPen = p; }
    });
    this.curE = E; this.curColl = coll; this.curMaxPen = maxPen;
    return E;
  }

  /* ------------------------------------------------------ configurations initiales */
  startLayout(kind, t) {
    const n = this.n, rng = this.rng, k = Math.ceil(Math.sqrt(n));
    const jit = (a) => (rng.next() * 2 - 1) * a;
    if (kind === 'compress') {
      const f = t / this.hi;
      for (let i = 0; i < n; i++) this.setPose(i, this.bx[i] * f, this.by[i] * f, this.bth[i]);
    } else if (kind === 'grid' || kind === 'rotgrid') {
      const cells = []; for (let c = 0; c < k * k; c++) cells.push(c);
      for (let c = cells.length - 1; c > 0; c--) { const r = Math.floor(rng.next() * (c + 1)); [cells[c], cells[r]] = [cells[r], cells[c]]; }
      const alpha = kind === 'rotgrid' ? rng.next() * HALF_PI : 0, ca = Math.cos(alpha), sa = Math.sin(alpha), sp = t / k;
      for (let i = 0; i < n; i++) {
        const c = cells[i], u = ((c % k) + 0.5) * sp - t / 2, v = (Math.floor(c / k) + 0.5) * sp - t / 2;
        this.setPose(i, t / 2 + u * ca - v * sa + jit(0.02), t / 2 + u * sa + v * ca + jit(0.02), alpha + jit(0.03));
      }
    } else if (kind === 'hex' || kind === 'circle') {
      // réseau hexagonal de n centres remplissant le conteneur
      const rows = Math.max(1, Math.ceil(Math.sqrt(n))), cols = Math.ceil(n / rows);
      const sx = cols > 1 ? (t - 1) / (cols - 0.5) : 0, sy = rows > 1 ? (t - 1) / (rows - 1) : 0;
      let i = 0;
      for (let r = 0; r < rows && i < n; r++) for (let c = 0; c < cols && i < n; c++, i++) {
        const x = 0.5 + c * sx + (r % 2 ? sx / 2 : 0), y = 0.5 + r * sy;
        // 'circle' : carrés inscrits dans des disques → orientations quelconques
        const th = kind === 'circle' ? rng.next() * HALF_PI : jit(0.15);
        this.setPose(i, Math.min(t - 0.5, x + jit(0.02)), y + jit(0.02), th);
      }
    } else if (kind === 'pert') { // meilleure solution compressée puis ~12 % des carrés relancés + angles perturbés
      const f = t / this.hi;
      for (let i = 0; i < n; i++) this.setPose(i, this.bx[i] * f, this.by[i] * f, this.bth[i] + (rng.next() < 0.3 ? jit(0.25) : 0));
      const m = Math.max(1, Math.round(0.12 * n));
      for (let q = 0; q < m; q++) { const i = Math.floor(rng.next() * n); this.setPose(i, 0.5 + rng.next() * (t - 1), 0.5 + rng.next() * (t - 1), rng.next() * HALF_PI); }
    } else { // random
      for (let i = 0; i < n; i++) this.setPose(i, 0.5 + rng.next() * (t - 1), 0.5 + rng.next() * (t - 1), rng.next() * HALF_PI);
    }
    this.rebuildGrid(t);
  }

  /* ------------------------------------------------------------ tentatives */
  startAttempt() {
    if (this.iteration >= this.maxSweeps) { this.finish('budget d’itérations atteint'); return false; }
    if (this.hi - this.lo <= this.tol * this.hi) {
      // intervalle refermé : si du budget reste, on « secoue » la recherche (nouvelle fenêtre sous la meilleure solution)
      if (this.iteration < 0.85 * this.maxSweeps && this.closeCount < 8) {
        this.closeCount++; this.lo = Math.max(this.lo0, this.hi * (1 - 0.02 * this.closeCount)); this.target = null; this.retry = 0;
      } else { this.finish(this.iteration >= 0.85 * this.maxSweeps ? 'budget d’itérations atteint' : 'intervalle de recherche refermé'); return false; }
    }
    if (this.seedLayout && !this.seedDone) { // départ imposé (mutation / recombinaison) : première tentative = réparation à S ≤ hi
      this.seedDone = true; const sl = this.seedLayout, t = Math.min(sl.S, this.hi), f = t / sl.S, base0 = Math.min(6000, (this.params.effort || 1) * (100 + 5 * this.n));
      for (let i = 0; i < this.n; i++) this.setPose(i, sl.x[i] * f, sl.y[i] * f, sl.th[i]);
      this.rebuildGrid(t); this.amp = 0.1 * this.params.ampScale;
      this.attempt = { t, kind: 'seed', sweep: 0, max: Math.round(base0 * 2), T0: 0.004 * this.params.tempScale, Tend: 1e-8, lastProj: -99 };
      this.attemptCount++; this.phase = 'tentative seed'; this.measure(); return true;
    }
    // dichotomie biaisée vers la meilleure solution : la cible est au plus 4 % sous hi
    if (this.target === null) this.target = this.hi - Math.min(0.5 * (this.hi - this.lo), 0.04 * this.hi);
    const kinds = KINDS[this.strategy], t = this.target, n = this.n;
    let kind = kinds[this.attemptCount % kinds.length];
    // reprise du meilleur échec (énergie minimale) pour la même cible : intensification
    const useElite = this.elite && Math.abs(this.elite.t - t) < 1e-12 && this.strategy === 'full' && this.retry > 0 && this.attemptCount % 2 === 0;
    if (useElite) {
      kind = 'elite';
      for (let i = 0; i < n; i++) this.setPose(i, this.elite.x[i], this.elite.y[i], this.elite.th[i]);
      this.rebuildGrid(t);
    } else this.startLayout(kind, t);
    const compress = kind === 'compress' || kind === 'elite' || kind === 'pert';
    const base = Math.min(6000, (this.params.effort || 1) * (100 + 5 * n)), tScale = this.params.tempScale;
    this.amp = (compress ? 0.12 : 0.4) * this.params.ampScale;
    this.attempt = {
      t, kind, sweep: 0, max: Math.round(base * (1 + 0.5 * this.retry)),
      T0: (compress ? 0.003 * (1 + this.retry) : 0.03) * tScale, Tend: 1e-8, lastProj: -99,
    };
    this.attemptCount++; this.phase = `tentative ${kind}`; this.measure();
    return true;
  }

  /** Adopte une disposition valide meilleure (pool de solutions : baseline, autre phase…). */
  adopt(sol) {
    if (!sol || !(sol.S < this.hi - 1e-12)) return false;
    for (let i = 0; i < this.n; i++) { this.bx[i] = sol.x[i]; this.by[i] = sol.y[i]; this.bth[i] = sol.th ? sol.th[i] : 0; }
    this.hi = sol.S; this.history.push({ iteration: this.iteration, S: this.hi, adopted: true });
    this.attempt = null; this.target = null; this.retry = 0; this.elite = null; this.event = { type: 'adopt', S: this.hi };
    this.loadBest(this.hi); return true;
  }
  best() { return { S: this.hi, x: this.bx.slice(), y: this.by.slice(), th: this.bth.slice() }; }

  retriesAllowed() { return (this.hi - this.lo > 0.08 * this.hi ? 3 : this.params.retries) + 2 * this.closeCount; }

  endAttempt(success) {
    const a = this.attempt; this.attempt = null;
    if (success) {
      this.successCount++;
      this.bx.set(this.x); this.by.set(this.y); this.bth.set(this.th);
      this.hi = a.t; this.history.push({ iteration: this.iteration, S: this.hi });
      this.retry = 0; this.target = null; this.closeCount = 0; this.elite = null; this.event = { type: 'success', S: this.hi };
    } else {
      if (a.kind === 'seed') return; // échec d'une réparation : la meilleure solution reste celle de départ
      const E = this.measure();
      if (!this.elite || Math.abs(this.elite.t - a.t) > 1e-12 || E < this.elite.E) this.elite = { t: a.t, E, x: this.x.slice(), y: this.y.slice(), th: this.th.slice() };
      this.retry++;
      if (this.retry >= this.retriesAllowed()) { this.lo = Math.max(this.lo, a.t); this.retry = 0; this.target = null; }
    }
  }

  /** Projection locale : répulsion le long de la normale SAT jusqu'à pénétration nulle. */
  project(maxIter = 300) {
    const n = this.n, d = this.d, S = this.S, out = this.tmp, dx = this.dx, dy = this.dy;
    this.px.set(this.x); this.py.set(this.y); this.pth.set(this.th);
    const clamp = () => { for (let i = 0; i < n; i++) { const h = halfExtent(d, this.th[i]); this.x[i] = Math.min(Math.max(this.x[i], h), S - h); this.y[i] = Math.min(Math.max(this.y[i], h), S - h); } };
    clamp();
    for (let it = 0; it < maxIter; it++) {
      for (let i = 0; i < n; i++) this.grid.move(i, this.x[i], this.y[i]);
      dx.fill(0); dy.fill(0); let cnt = 0;
      this.grid.pairs((i, j) => {
        const p = satPenCS(this.x[i], this.y[i], d, this.cs[i], this.sn[i], this.x[j], this.y[j], d, this.cs[j], this.sn[j], out);
        if (p > 1e-12) { cnt++; const f = p * 0.51 + 1e-10; dx[i] -= out[0] * f; dy[i] -= out[1] * f; dx[j] += out[0] * f; dy[j] += out[1] * f; }
      });
      if (cnt === 0) return true;
      for (let i = 0; i < n; i++) { this.x[i] += dx[i] * 0.9; this.y[i] += dy[i] * 0.9; }
      clamp();
    }
    // échec : restauration de la pose d'avant projection
    this.x.set(this.px); this.y.set(this.py);
    for (let i = 0; i < n; i++) { this.setPose(i, this.px[i], this.py[i], this.pth[i]); this.grid.move(i, this.x[i], this.y[i]); }
    return false;
  }

  /** Vérification EXACTE indépendante (taille unité) avant d'accepter une solution. */
  certify(t) {
    const pl = []; for (let i = 0; i < this.n; i++) pl.push({ id: i, x: this.x[i], y: this.y[i], side: 1, theta: this.th[i] });
    return validateLayout(pl, t, t).valid;
  }

  tryFinish(a) {
    if (this.project() && this.certify(a.t)) { this.measure(); this.endAttempt(true); return true; }
    this.measure(); return false;
  }

  /* ------------------------------------------------------------ recuit */
  sweep(T) {
    const n = this.n, rng = this.rng, S = this.S, amp = this.amp, ampR = Math.min(1.2, amp * 1.6);
    let acc = 0;
    for (let m = 0; m < n; m++) {
      const r = rng.next(), i = Math.floor(rng.next() * n);
      const ox = this.x[i], oy = this.y[i], oth = this.th[i], oc = this.cs[i], os = this.sn[i];
      let nx, ny, nth, nc, ns, eOld, eNew, j = i;
      if (r < 0.05) {
        // téléportation : le carré le plus contraint (parmi 3) va vers le meilleur trou (parmi 10 candidats)
        let worst = i, ew = this.localE(i, ox, oy, oc, os);
        for (let q = 0; q < 2; q++) { const k = Math.floor(rng.next() * n), ek = this.localE(k, this.x[k], this.y[k], this.cs[k], this.sn[k]); if (ek > ew) { ew = ek; worst = k; } }
        if (ew < 1e-12) continue;
        j = worst;
        let bestE = Infinity, bx = 0, by = 0, bt = 0;
        for (let q = 0; q < 10; q++) {
          const cx = 0.5 + rng.next() * (S - 1), cy = 0.5 + rng.next() * (S - 1), ct = q % 2 ? rng.next() * HALF_PI : this.th[j];
          const e = this.localE(j, cx, cy, Math.cos(ct), Math.sin(ct));
          if (e < bestE) { bestE = e; bx = cx; by = cy; bt = ct; }
        }
        nx = bx; ny = by; nth = bt; nc = Math.cos(nth); ns = Math.sin(nth); eOld = ew; eNew = bestE;
        const dE = eNew - eOld;
        if (dE <= 0 || rng.next() < Math.exp(-dE / T)) {
          const px = this.x[j], py = this.y[j];
          void px; void py; this.th[j] = nth; this.x[j] = nx; this.y[j] = ny; this.cs[j] = nc; this.sn[j] = ns; this.grid.move(j, nx, ny); acc++;
        }
        continue;
      }
      if (r >= 0.05 && r < 0.12 && n > 3) { // mouvement COORDONNÉ : un groupe de voisins translate / tourne ensemble
        if (this.cluster(i, T, amp)) acc++;
        continue;
      }
      nx = ox; ny = oy; nth = oth;
      if (r < 0.55 || r >= 0.8) { nx = Math.min(S, Math.max(0, ox + (rng.next() * 2 - 1) * amp)); ny = Math.min(S, Math.max(0, oy + (rng.next() * 2 - 1) * amp)); }
      if (r >= 0.55) nth = oth + (rng.next() * 2 - 1) * ampR;
      nc = Math.cos(nth); ns = Math.sin(nth);
      eOld = this.localE(i, ox, oy, oc, os); eNew = this.localE(i, nx, ny, nc, ns);
      const dE = eNew - eOld;
      if (dE <= 0 || rng.next() < Math.exp(-dE / T)) { this.x[i] = nx; this.y[i] = ny; this.th[i] = nth; this.cs[i] = nc; this.sn[i] = ns; this.grid.move(i, nx, ny); acc++; }
    }
    const rate = acc / n;
    this.amp = Math.min(0.6, Math.max(1e-4, this.amp * (rate > 0.45 ? 1.12 : rate < 0.25 ? 0.88 : 1)));
  }

  /** Déplacement rigide d'un groupe (i + voisins proches) ; accepté selon Metropolis sur l'énergie du groupe. */
  cluster(i, T, amp) {
    const rng = this.rng, S = this.S, mem = [i], cx = this.x[i], cy = this.y[i];
    this.grid.near(cx, cy, (j) => { if (j !== i && mem.length < 7 && Math.hypot(this.x[j] - cx, this.y[j] - cy) < 1.7) mem.push(j); });
    if (mem.length < 2) return false;
    const m = mem.length, ox = new Float64Array(m), oy = new Float64Array(m), ot = new Float64Array(m);
    let eOld = 0; for (let q = 0; q < m; q++) { const j = mem[q]; ox[q] = this.x[j]; oy[q] = this.y[j]; ot[q] = this.th[j]; eOld += this.localE(j, ox[q], oy[q], this.cs[j], this.sn[j]); }
    const rot = rng.next() < 0.4, dth = rot ? (rng.next() * 2 - 1) * Math.min(0.5, amp * 1.2) : 0, tx = (rng.next() * 2 - 1) * amp, ty = (rng.next() * 2 - 1) * amp, c = Math.cos(dth), s = Math.sin(dth);
    for (let q = 0; q < m; q++) {
      const j = mem[q], u = ox[q] - cx, v = oy[q] - cy;
      this.x[j] = Math.min(S, Math.max(0, cx + u * c - v * s + tx)); this.y[j] = Math.min(S, Math.max(0, cy + u * s + v * c + ty));
      this.th[j] = ot[q] + dth; this.cs[j] = Math.cos(this.th[j]); this.sn[j] = Math.sin(this.th[j]); this.grid.move(j, this.x[j], this.y[j]);
    }
    let eNew = 0; for (let q = 0; q < m; q++) { const j = mem[q]; eNew += this.localE(j, this.x[j], this.y[j], this.cs[j], this.sn[j]); }
    const dE = eNew - eOld;
    if (dE <= 0 || rng.next() < Math.exp(-dE / T)) { this.clusterAcc++; return true; }
    for (let q = 0; q < m; q++) { const j = mem[q]; this.x[j] = ox[q]; this.y[j] = oy[q]; this.th[j] = ot[q]; this.cs[j] = Math.cos(ot[q]); this.sn[j] = Math.sin(ot[q]); this.grid.move(j, ox[q], oy[q]); }
    return false;
  }

  /** Relocalisation EXACTE (No-Fit Polygon) du carré le plus contraint vers une place libre, si elle existe. */
  relocate() {
    const n = this.n, d = this.d; let worst = -1, ew = 1e-9;
    for (let i = 0; i < n; i++) { if (!this.flags[i]) continue; const e = this.localE(i, this.x[i], this.y[i], this.cs[i], this.sn[i]); if (e > ew) { ew = e; worst = i; } }
    if (worst < 0) return false;
    const sq = []; for (let i = 0; i < n; i++) sq.push({ x: this.x[i], y: this.y[i], side: d, theta: this.th[i] });
    let best = null, spots = [];
    for (const th of [this.th[worst], 0, Math.PI / 4, this.rng.next() * HALF_PI]) {
      const r = freeCenters(sq, this.S, { side: d, theta: th }, { exclude: worst, maxPoints: 40 });
      for (const p of r.points) spots.push([p[0], p[1]]);
      if (r.points.length) { const p = r.points[Math.floor(this.rng.next() * r.points.length)]; if (!best) best = { x: p[0], y: p[1], th }; }
    }
    this.freeSpots = spots.slice(0, 60);
    if (!best) return false;
    this.setPose(worst, best.x, best.y, best.th); this.grid.move(worst, best.x, best.y); this.relocs++; return true;
  }

  /** Une itération = un balayage de N propositions de mouvement. */
  advance() {
    if (!this.attempt && !this.startAttempt()) return;
    const a = this.attempt, T = Math.max(1e-12, a.T0 * Math.pow(a.Tend / a.T0, a.sweep / a.max));
    this.sweep(T); a.sweep++; this.iteration++;
    if (a.sweep % 20 === 0 && this.n <= 120) { this.measure(); if (this.curColl) this.relocate(); }
    const last = a.sweep >= a.max;
    if (a.sweep % 4 === 0 || last) {
      const E = this.measure();
      if (E < 1e-3 && a.sweep - a.lastProj >= 6) { a.lastProj = a.sweep; if (this.tryFinish(a)) return; }
    }
    if (last) { if (!this.tryFinish(a)) this.endAttempt(false); }
  }

  step() {
    if (this.done) return;
    const k = Math.max(1, Math.ceil(40 / this.n));
    for (let s = 0; s < k && !this.done; s++) this.advance();
  }

  finish(reason) {
    this.done = true; this.attempt = null; this.phase = 'terminé'; this.stopReason = reason;
    this.loadBest(this.hi); this.measure();
  }
  /** Arrêt demandé par l'utilisateur : on garde la meilleure solution valide. */
  stop() { if (!this.done) this.finish('arrêt demandé'); }

  setParams(p) { Object.assign(this.params, p); if (p.ampScale && this.attempt) this.amp = 0.3 * p.ampScale; }

  /* ---------------------------------------------------------------- sorties */
  get analysis() {
    return { S: this.hi, a: 1 / this.hi, aAbs: this.W / this.hi, lo: this.lo, hi: this.hi, history: this.history.slice(), attempts: this.attemptCount, successes: this.successCount, strategy: this.strategy, stopReason: this.stopReason || null, tolerance: this.tol * this.hi };
  }
  view() {
    const working = !!this.attempt && !this.done, S = working ? this.S : this.hi, k = this.W / S;
    const X = working ? this.x : this.bx, Y = working ? this.y : this.by, T = working ? this.th : this.bth;
    const a = new Float64Array(this.n * 6);
    for (let i = 0; i < this.n; i++) a.set([i, X[i] * k, Y[i] * k, k, T[i], working ? this.flags[i] : 0], i * 6);
    const prog = Math.max(Math.min(1, this.iteration / this.maxSweeps), Math.min(1, 1 - (this.hi - this.lo) / Math.max(1e-9, this.hi0 - this.lo0)) * (this.done ? 1 : 0.98));
    return {
      sq: a, circ: null, morph: 0, phase: this.phase, label: 'Taille maximale',
      metrics: {
        iteration: this.iteration, energy: this.curE, collisions: 0, progress: this.done ? 1 : prog,
        certArea: this.n * k0(this.W, this.hi) ** 2, certCount: this.n,
        stage: this.attempt ? `cible S=${this.attempt.t.toFixed(4)} · ${this.attempt.kind}` : `S=${this.hi.toFixed(4)}`,
      },
      extra: { S: this.hi, a: 1 / this.hi, lo: this.lo, target: this.attempt ? this.attempt.t : null, attempt: this.attemptCount, kind: this.attempt ? this.attempt.kind : null, attemptColl: this.curColl, attemptE: this.curE, attemptMaxPen: this.curMaxPen, successes: this.successCount, working },
    };
  }
  result() {
    const k = this.W / this.hi, placements = [];
    for (let i = 0; i < this.n; i++) placements.push({ id: i, x: this.bx[i] * k, y: this.by[i] * k, side: k, theta: this.bth[i] });
    return { placements, rejected: [] };
  }
}
const k0 = (W, S) => W / S;

/** Exécution complète sans interface (tests, banc d'essai, tentatives multiples). */
export function solveMaxSize(opts = {}, { maxMs = Infinity } = {}) {
  const s = new MaxSizeSolver(opts), t0 = performance.now();
  while (!s.done) { s.step(); if (performance.now() - t0 > maxMs) { s.stop(); break; } }
  return { solver: s, ms: performance.now() - t0, ...s.analysis, result: s.result() };
}
