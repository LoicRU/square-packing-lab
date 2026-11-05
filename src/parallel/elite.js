/**
 * ELITE POOL — population partagée des meilleures solutions VALIDES.
 *
 * Catégories : 'record' (unique, jamais supprimé), 'elite' (meilleures tailles), 'diverse' (géométries
 * différentes même si un peu moins bonnes), 'historical' (anciennes, conservées compactes).
 * Admission : uniquement si l'autorité de validation (authority.judge) l'accepte.
 * Doublons : deux solutions à dissimilarité < DUP_THRESHOLD (symétries D4 + permutations + compression)
 * sont la même découverte ; la nouvelle ne remplace l'ancienne que si elle est strictement meilleure.
 * Politique de stockage : actifs bornés (record + maxElite + maxDiverse) ; le surplus passe en 'historical'
 * (borné par maxHistorical) puis est rendu à l'appelant dans `evicted` pour archivage ; le record n'est jamais évincé.
 */
import { judge } from './authority.js';
import { dissimilarity, DUP_THRESHOLD } from './canonical.js';

export class ElitePool {
  constructor({ n, maxElite = 20, maxDiverse = 20, maxHistorical = 150, dupThreshold = DUP_THRESHOLD, eps = 1e-9 } = {}) {
    this.n = n; this.maxElite = maxElite; this.maxDiverse = maxDiverse; this.maxHistorical = maxHistorical; this.dup = dupThreshold; this.eps = eps;
    this.entries = []; this.nextId = 1; this.counters = { submitted: 0, rejectedInvalid: 0, duplicates: 0, accepted: 0, improvedRecords: 0, evicted: 0 };
  }
  get record() { return this.entries.find((e) => e.category === 'record') || null; }
  get bestS() { const r = this.record; return r ? r.S : Infinity; }
  active() { return this.entries.filter((e) => e.category !== 'historical'); }

  /** @returns {{status:'invalid'|'duplicate'|'accepted'|'record'|'improved', entry?, reasons?, evicted:object[]}} */
  submit(sol, meta = {}, claimed = null) {
    this.counters.submitted++;
    const v = judge(sol, { n: this.n });
    if (!v.ok || (claimed && ((claimed.S !== undefined && Math.abs(claimed.S - v.S) > 1e-6 * v.S)))) {
      this.counters.rejectedInvalid++; return { status: 'invalid', reasons: v.ok ? ['taille annoncée incohérente'] : v.reasons, evicted: [] };
    }
    const s = v.solution, evicted = [];
    // doublon géométrique ?
    for (const e of this.entries) {
      if (e.category === 'historical' && e.S > v.S + 0.05 * v.S) continue; // inutile de comparer aux anciennes bien moins bonnes
      if (dissimilarity(s, e.sol) < this.dup) {
        if (v.S < e.S - this.eps) { // même géométrie, strictement meilleure : amélioration de la niche
          e.sol = s; e.S = v.S; e.fill = v.fill; e.meta = { ...e.meta, ...meta, improvedAt: meta.t ?? Date.now() }; e.version = (e.version || 1) + 1;
          const st = this._rebalance(evicted); this.counters.improvedRecords += st === 'record' ? 1 : 0;
          return { status: st === 'record' ? 'record' : 'improved', entry: e, evicted };
        }
        this.counters.duplicates++; return { status: 'duplicate', entry: e, evicted: [] };
      }
    }
    const entry = { id: this.nextId++, sol: s, S: v.S, fill: v.fill, size: v.size, category: 'diverse', meta: { ...meta, t: meta.t ?? Date.now() }, version: 1, nov: 1 };
    this.entries.push(entry); this.counters.accepted++;
    const st = this._rebalance(evicted); if (st === 'record' && entry.category === 'record') this.counters.improvedRecords++;
    // nouveauté (diversité) : distance minimale aux autres actifs
    let nov = Infinity; for (const o of this.active()) if (o !== entry) nov = Math.min(nov, dissimilarity(s, o.sol)); entry.nov = Number.isFinite(nov) ? nov : 1;
    return { status: entry.category === 'record' ? 'record' : 'accepted', entry, evicted };
  }

  /** Recalcule les catégories ; retourne 'record' si le record a changé. */
  _rebalance(evicted) {
    const oldRec = this.record, sorted = this.entries.slice().sort((a, b) => a.S - b.S || a.id - b.id), top = sorted[0];
    for (const e of this.entries) if (e.category === 'record' && e !== top) e.category = 'elite';
    top.category = 'record'; // le record est la meilleure taille ; il n'est jamais évincé
    const changed = !oldRec || top !== oldRec || top.S < (this._lastRecordS ?? Infinity) - this.eps; this._lastRecordS = top.S;
    // élites : les maxElite meilleurs (hors record) ; diversifiées : les plus « nouvelles » parmi le reste
    const rest = sorted.filter((e) => e !== top && e.category !== 'historical');
    rest.forEach((e, i) => { e.category = i < this.maxElite ? 'elite' : 'diverse'; });
    const diverse = rest.slice(this.maxElite);
    if (diverse.length > this.maxDiverse) { // éviction par encombrement : la moins nouvelle puis la moins bonne devient historique
      diverse.sort((a, b) => (b.nov - a.nov) || (a.S - b.S));
      for (const e of diverse.slice(this.maxDiverse)) e.category = 'historical';
    }
    const hist = this.entries.filter((e) => e.category === 'historical').sort((a, b) => a.S - b.S);
    if (hist.length > this.maxHistorical) for (const e of hist.slice(this.maxHistorical)) { this.entries.splice(this.entries.indexOf(e), 1); evicted.push(e); this.counters.evicted++; }
    return changed ? 'record' : 'other';
  }

  /** Sélection de k parents DIFFÉRENTS : le premier par tournoi (qualité), les suivants par nouveauté × qualité. */
  selectParents(rng, k = 1, { includeRecord = true } = {}) {
    const pool = this.entries.filter((e) => e.category !== 'historical' && (includeRecord || e.category !== 'record'));
    if (!pool.length) return [];
    const bestS = this.bestS, q = (e) => Math.exp(-(e.S - bestS) / (0.02 * bestS)); // qualité ∈ ]0,1]
    const out = []; const left = pool.slice();
    for (let c = 0; c < Math.min(k, pool.length); c++) {
      let pick;
      if (c === 0) { const a = left[Math.floor(rng.next() * left.length)], b = left[Math.floor(rng.next() * left.length)]; pick = q(a) >= q(b) ? a : b; }
      else {
        const w = left.map((e) => { let d = Infinity; for (const o of out) d = Math.min(d, dissimilarity(e.sol, o.sol)); return (0.2 + Math.min(1, d)) * (0.3 + q(e)); });
        const tot = w.reduce((a, b) => a + b, 0); let r = rng.next() * tot; pick = left[left.length - 1]; for (let i = 0; i < left.length; i++) { r -= w[i]; if (r <= 0) { pick = left[i]; break; } }
      }
      out.push(pick); left.splice(left.indexOf(pick), 1);
    }
    return out;
  }
  stats() {
    const cat = { record: 0, elite: 0, diverse: 0, historical: 0 }; for (const e of this.entries) cat[e.category]++;
    return { n: this.n, size: this.entries.length, categories: cat, bestS: this.bestS, ...this.counters };
  }
  toJSON() { return { n: this.n, nextId: this.nextId, counters: this.counters, entries: this.entries }; }
  static fromJSON(j, opts = {}) {
    const p = new ElitePool({ n: j.n, ...opts }); p.nextId = j.nextId; p.counters = { ...p.counters, ...j.counters }; p.entries = j.entries; p._lastRecordS = p.bestS; return p;
  }
}
