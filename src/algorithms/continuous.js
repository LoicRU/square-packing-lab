import { createRng } from '../engine/rng.js';
import { TOL, SQRT2, satPenCS, halfExtent } from '../engine/geometry.js';
import { Grid } from '../engine/grid.js';

const TAU = Math.PI * 2;
const wrapQuarter = (a) => { let r = (a + Math.PI / 4) % (Math.PI / 2); if (r < 0) r += Math.PI / 2; return r - Math.PI / 4; };

/**
 * Solveur CONTINU par insertion progressive (base des méthodes « recuit simulé »
 * et « répulsion/forces », et brique de Circle→Square).
 *
 * Principe : un sous-ensemble d'objets est placé ; un minimiseur d'énergie
 * E = Σ pénétration² (paires) supprime les chevauchements ; dès que la disposition
 * est valide, un lot d'objets est inséré et la minimisation reprend. En cas d'échec
 * (budget d'étape épuisé) on restaure la dernière disposition valide, on réduit la
 * taille du lot, puis on abandonne l'objet. Le résultat est donc TOUJOURS la
 * dernière disposition valide trouvée (meilleure solution heuristique).
 *
 * Marge de sécurité : les objets sont gonflés de `gap` dans l'énergie ; viser
 * pénétration_gonflée ≤ gap/2 garantit une séparation stricte réelle.
 * Modèles de forme : 'square' (carrés orientés, SAT) ou 'circle' (disques).
 * Relaxeurs : 'forces' (répulsion de paires, Jacobi + bruit décroissant)
 *             'anneal' (recuit simulé, déplacements aléatoires, ΔE local).
 */
export class ContinuousSolver {
  constructor(instance, o = {}) {
    this.instance = instance;
    const { W, H, items } = instance, n = items.length;
    this.model = o.model || 'square';
    this.relaxer = o.relaxer || 'forces';
    this.rotation = this.model === 'square' && !!(o.rotation ?? instance.rotation);
    this.label = o.label || (this.relaxer === 'anneal' ? 'Recuit simulé' : 'Répulsion / forces');
    this.params = {
      iterations: 3000, stageIters: this.relaxer === 'anneal' ? 60 : 120, firstStageIters: 400,
      initDensity: 0.5, batchFrac: 0.05, stiffness: 0.75, noise: 0.05, tScale: 0.02, gapRel: 0.0005, maxFail: 6,
      ...(o.params || {}),
    };
    if (o.iterations) this.params.iterations = o.iterations;
    this.rng = createRng(o.seed ?? instance.seed);
    this.n = n;
    // Dimensions de base : côté (carré) ou rayon (disque).
    this.base = new Float64Array(n);
    this.trueSide = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.base[i] = o.dims ? o.dims[i] : items[i].side; this.trueSide[i] = items[i].side; }
    const pos = [...this.base].filter((v) => v > 0);
    this.minDim = pos.length ? Math.min(...pos) : 1;
    this.gap = this.params.gapRel * this.minDim;
    this.d = new Float64Array(n);
    for (let i = 0; i < n; i++) this.d[i] = this.model === 'square' ? this.base[i] + this.gap : this.base[i] + this.gap / 2;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.th = new Float64Array(n);
    this.cs = new Float64Array(n).fill(1); this.sn = new Float64Array(n);
    this.active = new Uint8Array(n); this.flag = new Uint8Array(n);
    this.dx = new Float64Array(n); this.dy = new Float64Array(n); this.dth = new Float64Array(n);
    this.tmp = new Float64Array(2);
    this.W = W; this.H = H;
    let rmax = 0;
    for (let i = 0; i < n; i++) rmax = Math.max(rmax, this.circumR(i));
    this.grid = new Grid(W, H, 2 * rmax, n);
    this.iter = 0; this.stageIter = 0; this.fails = 0; this.done = false; this.batchCap = Infinity;
    this.lastBatch = []; this.lastValid = null; this.rejected = [];
    this.E = 0; this.maxPen = 0; this.overlaps = 0; this.certArea = 0; this.certCount = 0; this.valid = false;
    this.phase = 'placement';

    // File d'insertion : objets triés par taille décroissante qui tiennent dans le conteneur.
    const fits = (i) => (this.model === 'square' ? this.d[i] <= Math.min(W, H) : 2 * this.d[i] <= Math.min(W, H));
    const initialIds = new Set((o.initial || []).map((p) => p.id));
    this.queue = [];
    for (let i = 0; i < n; i++) {
      if (initialIds.has(i)) continue;
      if (fits(i)) this.queue.push(i); else this.rejected.push(i);
    }
    this.queue.sort((a, b) => this.base[b] - this.base[a] || a - b);

    if (o.initial) {
      for (const p of o.initial) { this.active[p.id] = 1; this.x[p.id] = p.x; this.y[p.id] = p.y; this.setTheta(p.id, p.theta || 0); }
      this.stageLimit = this.params.firstStageIters;
    } else {
      // Sous-ensemble initial : on ajoute des objets (décroissants) jusqu'à initDensity.
      let acc = 0; const cap = this.params.initDensity * W * H;
      while (this.queue.length) {
        const i = this.queue[0], a = this.trueSide[i] ** 2;
        if (acc > 0 && acc + a > cap) break;
        this.queue.shift(); this.addRandom(i); acc += a;
      }
      this.stageLimit = this.params.firstStageIters;
    }
    this.rebuildActiveList();
    this.measure();
    if (this.valid) this.recordValid();
  }

  /* ---------- géométrie du modèle ---------- */
  circumR(i) { return this.model === 'square' ? this.d[i] / SQRT2 : this.d[i]; }
  he(i) { return this.model === 'square' ? (this.d[i] / 2) * (Math.abs(this.cs[i]) + Math.abs(this.sn[i])) : this.d[i]; }
  setTheta(i, t) { this.th[i] = t; this.cs[i] = Math.cos(t); this.sn[i] = Math.sin(t); }
  /** Pénétration (gonflée) entre i et j ; écrit la normale i→j dans this.tmp. */
  pen(i, j) {
    const { x, y, d, tmp } = this;
    if (this.model === 'square') return satPenCS(x[i], y[i], d[i], this.cs[i], this.sn[i], x[j], y[j], d[j], this.cs[j], this.sn[j], tmp);
    const ex = x[j] - x[i], ey = y[j] - y[i], rr = d[i] + d[j], d2 = ex * ex + ey * ey;
    if (d2 >= rr * rr) return 0;
    const dist = Math.sqrt(d2);
    if (dist < 1e-12) { const a = this.rng.next() * TAU; tmp[0] = Math.cos(a); tmp[1] = Math.sin(a); } else { tmp[0] = ex / dist; tmp[1] = ey / dist; }
    return rr - dist;
  }
  /** Ramène le centre dans le conteneur ; si la rotation ne tient pas, snap à 0. */
  clampItem(i) {
    let h = this.he(i);
    if (this.rotation && (2 * h > this.W || 2 * h > this.H)) { this.setTheta(i, 0); h = this.he(i); }
    const lx = h, hx = this.W - h, ly = h, hy = this.H - h;
    this.x[i] = hx < lx ? this.W / 2 : this.x[i] < lx ? lx : this.x[i] > hx ? hx : this.x[i];
    this.y[i] = hy < ly ? this.H / 2 : this.y[i] < ly ? ly : this.y[i] > hy ? hy : this.y[i];
  }
  addRandom(i) {
    this.active[i] = 1;
    this.setTheta(i, this.rotation ? this.rng.next() * Math.PI / 2 : 0);
    const h = this.he(i);
    this.x[i] = this.rng.range(h, Math.max(h, this.W - h)); this.y[i] = this.rng.range(h, Math.max(h, this.H - h));
    this.clampItem(i);
  }
  rebuildActiveList() { this.list = []; for (let i = 0; i < this.n; i++) if (this.active[i]) this.list.push(i); }
  rebuildGrid() { this.grid.clear(); for (const i of this.list) this.grid.insert(i, this.x[i], this.y[i]); }

  /* ---------- mesure exacte de l'état courant ---------- */
  measure() {
    this.rebuildGrid(); this.flag.fill(0);
    let E = 0, mx = 0, ov = 0;
    this.grid.pairs((i, j) => {
      const p = this.pen(i, j);
      if (p <= 0) return;
      E += p * p; if (p > mx) mx = p;
      if (p - this.gap > TOL) { ov++; this.flag[i] = 1; this.flag[j] = 1; }
    });
    let area = 0, cnt = 0;
    for (const i of this.list) if (!this.flag[i]) { area += this.trueSide[i] ** 2; cnt++; }
    this.E = E; this.maxPen = mx; this.overlaps = ov; this.certArea = area; this.certCount = cnt;
    this.valid = ov === 0; // pénétration réelle ≤ TOL partout (la marge gap garantit pen_réelle ≤ pen_gonflée − gap)
    return this.valid;
  }
  recordValid() {
    this.lastValid = { x: this.x.slice(), y: this.y.slice(), th: this.th.slice(), active: this.active.slice() };
  }
  restoreValid() {
    const s = this.lastValid;
    if (!s) return false;
    this.x.set(s.x); this.y.set(s.y); this.active.set(s.active);
    for (let i = 0; i < this.n; i++) this.setTheta(i, s.th[i]);
    this.rebuildActiveList(); return true;
  }
  /** Sans disposition valide connue : retire les objets les plus conflictuels. */
  fallbackValid() {
    this.measure();
    const deg = new Int32Array(this.n), adj = new Map();
    this.grid.pairs((i, j) => { if (this.pen(i, j) - this.gap > TOL) { (adj.get(i) || adj.set(i, []).get(i)).push(j); (adj.get(j) || adj.set(j, []).get(j)).push(i); deg[i]++; deg[j]++; } });
    for (;;) {
      let best = -1, bd = 0;
      for (const k of adj.keys()) if (this.active[k] && deg[k] > bd) { bd = deg[k]; best = k; }
      if (best < 0) break;
      this.active[best] = 0; this.queue.unshift(best);
      for (const j of adj.get(best)) if (this.active[j]) deg[j]--;
      deg[best] = 0;
    }
    this.rebuildActiveList();
    for (let k = 0; k < 4 && !this.measure(); k++) this.relaxForces(1); // dernière relaxation douce
    if (this.measure()) { this.recordValid(); return true; }
    return false;
  }

  /* ---------- minimiseurs ---------- */
  relaxForces(progress) {
    const { x, y, dx, dy, dth, list } = this, w = this.params.stiffness;
    this.rebuildGrid();
    for (const i of list) { dx[i] = 0; dy[i] = 0; dth[i] = 0; }
    let any = false;
    this.grid.pairs((i, j) => {
      const p = this.pen(i, j);
      if (p <= 0) return;
      any = true;
      const nx = this.tmp[0], ny = this.tmp[1], q = p * 0.5;
      dx[i] -= nx * q; dy[i] -= ny * q; dx[j] += nx * q; dy[j] += ny * q;
      if (this.rotation) { // alignement des faces en contact (favorise les contacts plans)
        const phi = Math.atan2(ny, nx);
        dth[i] += wrapQuarter(phi - this.th[i]) * 0.15; dth[j] += wrapQuarter(phi - this.th[j]) * 0.15;
      }
    });
    const sig = this.params.noise * this.minDim * Math.pow(Math.max(0, 1 - progress), 2) * (any ? 1 : 0);
    for (const i of list) {
      x[i] += w * dx[i] + sig * this.rng.gauss(); y[i] += w * dy[i] + sig * this.rng.gauss();
      if (this.rotation && (dth[i] || sig)) this.setTheta(i, this.th[i] + dth[i] + sig * 0.5 * this.rng.gauss());
      this.clampItem(i);
    }
  }
  localE(i, px, py) {
    const save = this.x[i], savey = this.y[i];
    this.x[i] = px; this.y[i] = py;
    let e = 0;
    this.grid.near(px, py, (j) => { if (j !== i) { const p = this.pen(i, j); if (p > 0) e += p * p; } });
    this.x[i] = save; this.y[i] = savey;
    return e;
  }
  relaxAnneal(progress) {
    const k = this.list.length, T0 = this.params.tScale * this.minDim * this.minDim;
    const T = T0 * Math.pow(Math.max(0, 1 - progress), 3) + 1e-10 * this.minDim * this.minDim;
    const sig = 0.4 * this.minDim * Math.sqrt(T / T0) + 1e-3 * this.minDim;
    this.rebuildGrid();
    for (let m = 0; m < k; m++) {
      const i = this.list[(this.rng.next() * k) | 0];
      const ox = this.x[i], oy = this.y[i], ot = this.th[i];
      const nx0 = ox + this.rng.gauss() * sig, ny0 = oy + this.rng.gauss() * sig;
      // E avant (position/angle courants) et après (candidat)
      const e0 = this.localE(i, ox, oy);
      if (this.rotation && this.rng.next() < 0.5) this.setTheta(i, ot + this.rng.gauss() * sig / this.minDim * 0.6);
      this.x[i] = nx0; this.y[i] = ny0; this.clampItem(i);
      const nx = this.x[i], ny = this.y[i], nt = this.th[i];
      this.x[i] = ox; this.y[i] = oy;
      const e1 = this.localE(i, nx, ny);
      const dE = e1 - e0;
      if (dE <= 0 || this.rng.next() < Math.exp(-dE / T)) { this.x[i] = nx; this.y[i] = ny; this.grid.move(i, nx, ny); }
      else { this.setTheta(i, ot); }
    }
  }

  /* ---------- boucle ---------- */
  step() {
    if (this.done) return;
    const limit = this.stageLimit, progress = Math.min(1, this.stageIter / limit);
    if (this.relaxer === 'anneal') this.relaxAnneal(progress); else this.relaxForces(progress);
    this.iter++; this.stageIter++;
    this.measure();
    if (this.valid) { this.recordValid(); if (!this.advance()) this.finish(); }
    else if (this.stageIter >= limit) this.handleFailure();
    if (!this.done && this.iter >= this.params.iterations) this.finish();
  }
  /** Insère le prochain lot. Retourne false s'il n'y a plus rien à insérer. */
  advance() {
    if (!this.queue.length) return false;
    const k = this.list.length;
    let b = Math.max(1, Math.floor(this.params.batchFrac * k));
    b = Math.min(b, this.batchCap, this.queue.length);
    this.lastBatch = this.queue.splice(0, b);
    this.rebuildGrid();
    for (const i of this.lastBatch) this.insertBest(i);
    this.rebuildActiveList();
    this.stageIter = 0; this.stageLimit = this.params.stageIters;
    this.measure();
    if (this.valid) { this.recordValid(); return this.advance(); }
    return true;
  }
  /** Position d'insertion : parmi 24 candidats, celle qui maximise le dégagement. */
  insertBest(i) {
    this.active[i] = 1;
    this.setTheta(i, this.rotation ? this.rng.next() * Math.PI / 2 : 0);
    const h = this.he(i);
    let bx = this.W / 2, by = this.H / 2, bc = -Infinity;
    for (let c = 0; c < 24; c++) {
      const px = this.rng.range(h, Math.max(h, this.W - h)), py = this.rng.range(h, Math.max(h, this.H - h));
      let clr = Infinity;
      this.grid.near(px, py, (j) => { const dd = Math.hypot(this.x[j] - px, this.y[j] - py) - this.circumR(i) - this.circumR(j); if (dd < clr) clr = dd; });
      if (clr > bc) { bc = clr; bx = px; by = py; }
    }
    this.x[i] = bx; this.y[i] = by; this.clampItem(i);
    this.grid.insert(i, this.x[i], this.y[i]);
  }
  handleFailure() {
    if (!this.lastValid && !this.fallbackValid()) { this.finish(); return; }
    this.restoreValid();
    const batch = this.lastBatch; this.lastBatch = [];
    if (batch.length > 1) { this.batchCap = Math.ceil(batch.length / 2); this.queue.unshift(...batch); }
    else if (batch.length === 1) { this.rejected.push(batch[0]); this.fails++; if (this.fails >= this.params.maxFail) { this.finish(); return; } }
    this.measure();
    if (!this.advance()) this.finish();
  }
  finish() {
    if (!this.lastValid) this.fallbackValid();
    if (this.lastValid) this.restoreValid();
    this.measure(); this.done = true; this.phase = 'done';
  }
  setParams(p) { Object.assign(this.params, p); if (p.gapRel !== undefined) { /* gap fixé à la construction */ } }

  /* ---------- sorties ---------- */
  /** Disposition valide finale (carrés) : { placements, rejected }. */
  result() {
    if (!this.lastValid && !this.done) this.fallbackValid();
    const s = this.lastValid, placements = [], rej = [];
    for (let i = 0; i < this.n; i++) {
      if (s && s.active[i]) placements.push({ id: i, x: s.x[i], y: s.y[i], side: this.trueSide[i], theta: this.model === 'square' ? s.th[i] : 0 });
      else rej.push(i);
    }
    return { placements, rejected: rej };
  }
  /** Disposition de cercles valide : [{id,x,y,r}] (modèle 'circle'). */
  circleLayout() {
    const s = this.lastValid, out = [];
    if (!s) return out;
    for (let i = 0; i < this.n; i++) if (s.active[i]) out.push({ id: i, x: s.x[i], y: s.y[i], r: this.base[i] });
    return out;
  }
  view() {
    const k = this.list.length;
    const a = new Float64Array(k * (this.model === 'square' ? 6 : 4));
    let m = 0;
    for (const i of this.list) {
      if (this.model === 'square') { a.set([i, this.x[i], this.y[i], this.trueSide[i], this.th[i], this.flag[i]], m); m += 6; }
      else { a.set([i, this.x[i], this.y[i], this.base[i]], m); m += 4; }
    }
    return {
      sq: this.model === 'square' ? a : null, circ: this.model === 'circle' ? a : null, circFlags: null, morph: 0, phase: this.phase, label: this.label,
      metrics: { iteration: this.iter, energy: this.E, collisions: this.overlaps, certArea: this.certArea, certCount: this.certCount, progress: Math.min(1, this.iter / this.params.iterations), stage: `lot ${this.lastBatch.length || 0} · actifs ${k}` },
    };
  }
  /** Nombre d'objets actifs sans conflit et surface certifiée (utilisés par le worker pour les graphiques). */
  get placedNow() { return this.certCount; }
}

/** Plus petite taille de lot utile, exportée pour les tests. */
export const _halfExtent = halfExtent;
