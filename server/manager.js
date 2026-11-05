/**
 * SearchManager : possède les recherches (Coordinator) côté serveur, le sampler de ressources, la reprise au démarrage.
 * Les workers sont de vrais worker_threads (limites mémoire par worker) ; la base SQLite est la source de vérité.
 */
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Coordinator, validateParams } from '../src/parallel/coordinator.js';

export class SearchManager {
  constructor({ store, spawn = null, maxWorkers = Math.min(os.cpus().length, 16), maxRunning = 3, workerMemMB = 384, autoResume = true, tickMs = 250, log = console } = {}) {
    this.store = store; this.maxWorkers = maxWorkers; this.maxRunning = maxRunning; this.workerMemMB = workerMemMB; this.autoResume = autoResume; this.tickMs = tickMs; this.log = log;
    this.searches = new Map(); this.listeners = new Map(); this.lag = 0; this.lastLag = performance.now();
    this.spawn = spawn || (() => new Worker(new URL('./threadWorker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: workerMemMB, maxYoungGenerationSizeMb: 32 } }));
    this.lagTimer = setInterval(() => { const t = performance.now(); this.lag = Math.max(0, t - this.lastLag - 100); this.lastLag = t; }, 100); this.lagTimer.unref();
  }
  resources() { const cpus = os.cpus().length; return { cpus, load1: os.loadavg()[0], freeMemMB: Math.round(os.freemem() / 1048576), totalMemMB: Math.round(os.totalmem() / 1048576), loopLagMs: Math.round(this.lag), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), serverMaxWorkers: this.maxWorkers, maxRunning: this.maxRunning, uptimeS: Math.round(process.uptime()) }; }
  running() { return [...this.searches.values()].filter((c) => c.status === 'running'); }
  build(id, params) {
    const c = new Coordinator({ id, params, spawn: this.spawn, store: this.store, resources: () => { const r = this.resources(); return { ...r, freeMemMB: r.freeMemMB / Math.max(1, this.running().length) }; }, serverMax: this.maxWorkers, tickMs: this.tickMs, onEvent: (e) => this.dispatch(id, e) });
    this.searches.set(id, c); return c;
  }
  create(rawParams) {
    const v = validateParams(rawParams); if (!v.ok) return { ok: false, errors: v.errors };
    if (this.running().length >= this.maxRunning) return { ok: false, errors: [`limite de ${this.maxRunning} recherches simultanées atteinte`], code: 429 };
    const id = randomBytes(5).toString('hex'); this.store.createSearch(id, v.params);
    const c = this.build(id, v.params); c.start(); return { ok: true, id, coordinator: c };
  }
  get(id) { return this.searches.get(id) || null; }
  /** Charge une recherche arrêtée depuis la base (lecture / reprise manuelle). */
  load(id) {
    if (this.searches.has(id)) return this.searches.get(id);
    const row = this.store.getSearch(id); if (!row) return null;
    const c = this.build(id, row.params); c.restore(this.store.load(id)); c.status = row.status === 'running' || row.status === 'paused' ? 'paused' : 'stopped'; return c;
  }
  /** Reprise après redémarrage : les workers sont morts, on relance depuis les checkpoints (approximatif, cf. checkpoint.note). */
  recover() {
    const out = [];
    for (const row of this.store.listSearches()) {
      if (this.searches.has(row.id)) continue;
      try {
        const c = this.build(row.id, row.params); const r = c.restore(this.store.load(row.id));
        if (row.status === 'running' && this.autoResume && this.running().length < this.maxRunning) { c.status = 'created'; c.start(); c.emit('recovered', { fromCheckpoint: true, rejected: r.rejected }); out.push({ id: row.id, resumed: true }); }
        else { c.status = row.status === 'running' || row.status === 'paused' ? 'paused' : 'stopped'; out.push({ id: row.id, resumed: false }); }
      } catch (e) { this.log.error?.(`reprise de ${row.id} impossible : ${e.message}`); }
    }
    return out;
  }
  list() { const rows = new Map(this.store.listSearches().map((r) => [r.id, r])); return [...rows.values()].map((r) => { const c = this.searches.get(r.id); const s = c ? c.summary() : null; return { id: r.id, status: c ? c.status : r.status, params: r.params, createdAt: r.createdAt, searchMs: c ? s.searchMs : r.searchMs, best: s ? s.best : null, counters: s ? s.counters : null, resources: s ? s.resources : null }; }); }
  subscribe(id, fn) { if (!this.listeners.has(id)) this.listeners.set(id, new Set()); this.listeners.get(id).add(fn); return () => this.listeners.get(id)?.delete(fn); }
  dispatch(id, e) { const l = this.listeners.get(id); if (l) for (const f of l) { try { f(e); } catch { /* client déconnecté */ } } }
  async stopAll() { const act = [...this.searches.values()].filter((c) => c.status !== 'stopped'); await Promise.all(act.map((c) => c.stop())); return act.length; }
  async removeAll() { await this.stopAll(); const ids = this.store.listSearches().map((r) => r.id); for (const id of ids) { this.searches.delete(id); this.store.deleteSearch(id); } this.searches.clear(); return ids.length; }
  async remove(id) { const c = this.searches.get(id); if (c) { await c.stop(); this.searches.delete(id); } this.store.deleteSearch(id); }
  async shutdown() { clearInterval(this.lagTimer); for (const c of this.searches.values()) { try { c.persist(true); if (c.status === 'running') { const st = c.status; await c.stop(); this.store.saveSearchState(c.id, { status: st, searchMs: c.searchMs }); } } catch { /* ignoré */ } } }
}
