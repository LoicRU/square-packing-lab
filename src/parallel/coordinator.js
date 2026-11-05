/**
 * PARALLEL COORDINATOR — gestionnaire central d'une recherche.
 * Il ne fait AUCUN calcul géométrique intensif : il crée les « simulations » (slots), distribue des cycles aux
 * workers, vérifie les résultats via l'autorité (ElitePool.submit), met à jour les bandits, redémarre les
 * workers défaillants, contrôle les ressources et expose un état léger. Les workers sont injectés (spawn) :
 * worker_threads en production, InlineWorker dans les tests.
 */
import { certifyAgainstKnown } from '../engine/certify.js';
import { ElitePool } from './elite.js';
import { Bandit, rewardOf } from './bandit.js';
import { MUTATIONS, AMPLITUDES } from './evolve.js';
import { defaultBudgetMs } from './task.js';
import { computeTarget } from './governor.js';
import { createRng } from '../engine/rng.js';
import { judge } from './authority.js';

export const SLOT_STATES = ['init', 'waiting', 'running', 'submitting', 'done', 'restarting', 'error', 'suspended'];
export const STRATEGIES = { direct: 'Square Packing direct (dichotomie + recuit)', anneal: 'Multi-départ (recuit seul)', circle: 'Circle → Square (expérimental)', pattern: 'Motifs à bande inclinée (construction + affinage)', hop: 'Expansion–secousse–compression (affinage SLP en boucle, transfert N±1)' };
export const ORIGINS = { best: 'Mutation du record', diverse: 'Mutation d\'une élite diversifiée', recomb: 'Recombinaison', random: 'Nouvelle configuration' };
export const LIMITS = { minN: 1, maxN: 400, maxSims: 128, maxCycleMs: 600000 };

export function validateParams(p) {
  const errs = [], n = Math.floor(+p.n), sims = Math.floor(+p.sims ?? 4);
  if (!(n >= LIMITS.minN && n <= LIMITS.maxN)) errs.push(`N doit être entre ${LIMITS.minN} et ${LIMITS.maxN}`);
  if (!(sims >= 1 && sims <= LIMITS.maxSims)) errs.push(`le nombre de simulations doit être entre 1 et ${LIMITS.maxSims}`);
  const seed = p.seed === undefined || p.seed === '' ? 1 : Math.floor(+p.seed); if (!Number.isFinite(seed)) errs.push('graine invalide');
  const maxWorkers = Math.floor(+(p.maxWorkers ?? 0)); if (!(maxWorkers >= 0 && maxWorkers <= 64)) errs.push('limite de workers invalide (0 = automatique, max 64)');
  const cycleMs = p.cycleMs ? Math.floor(+p.cycleMs) : 0; if (cycleMs && !(cycleMs >= 500 && cycleMs <= LIMITS.maxCycleMs)) errs.push('durée de cycle invalide (500 ms – 10 min)');
  const enabled = Array.isArray(p.strategies) && p.strategies.length ? p.strategies.filter((s) => s in STRATEGIES) : Object.keys(STRATEGIES);
  const mode = ['evolutionary', 'independent'].includes(p.mode) ? p.mode : 'evolutionary';
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, params: { n, sims, seed, maxWorkers, cycleMs, strategies: enabled.length ? enabled : Object.keys(STRATEGIES), mode, effort: Math.min(12, Math.max(2, Math.floor(+(p.effort ?? 6)))), previewMs: 1500, checkpointMs: Math.max(2000, Math.floor(+(p.checkpointMs ?? 30000))) } };
}
const mix = (a, b) => ((a ^ (b + 0x9e3779b9 + (a << 6) + (a >>> 2))) >>> 0);

export class Coordinator {
  constructor({ id, params, spawn, store = null, now = () => Date.now(), resources = () => ({}), onEvent = () => {}, tickMs = 250, serverMax = 64 }) {
    const v = validateParams(params); if (!v.ok) throw new Error(v.errors.join(' ; '));
    this.id = id; this.params = v.params; this.spawn = spawn; this.store = store; this.now = now; this.resources = resources; this.onEvent = onEvent; this.tickMs = tickMs; this.serverMax = serverMax;
    this.rng = createRng(this.params.seed ^ 0x5bd1e995);
    this.status = 'created'; this.createdAt = now(); this.searchMs = 0; this.lastTickAt = null; this.timer = null; this.lastCheckpoint = now();
    this.pool = new ElitePool({ n: this.params.n });
    this.origins = new Bandit({ best: 0.3, diverse: 0.3, recomb: 0.2, random: 0.2 }, { floor: 0.08 });
    this.strategyBandit = new Bandit({ direct: 0.35, anneal: 0.2, circle: 0.15, pattern: 0.3, hop: 0.3 }, { floor: 0.07 });
    this.evoKind = new Bandit({ evo: 0.5, hop: 0.5 }, { floor: 0.15 }); // mutation « classique » ou secousse + SLP, selon ce qui rapporte
    this.lastImproveMs = 0;
    this.amps = new Bandit({ small: 0.4, medium: 0.4, large: 0.2 }, { floor: 0.1 });
    this.counters = { cycles: 0, improvements: 0, invalid: 0, duplicates: 0, workerRestarts: 0, errors: 0, validSolutions: 0 };
    this.history = []; this.events = []; this.seq = 0; this.workers = []; this.nextWid = 1; this.nextTask = 1; this.previews = new Map(); this.watched = null; this.avgCycleMs = 0; this.gov = { target: 1, reasons: [] };
    this.slots = Array.from({ length: this.params.sims }, (_, i) => this.newSlot(i));
    this.emit('created', {});
  }
  newSlot(i) { return { id: i, seed: mix(this.params.seed, i + 1), state: 'init', strategy: null, origin: null, cycles: 0, iterations: 0, best: null, bestS: null, history: [], errors: 0, consecutiveErrors: 0, progress: 0, lastRunAt: 0, taskId: null, wid: null, elapsed: 0, budget: 0, parents: [], invalid: 0 }; }
  emit(type, data) { const e = { seq: ++this.seq, t: this.now(), type, ...data }; this.events.push(e); if (this.events.length > 500) this.events.shift(); try { this.onEvent(e); } catch { /* l'observateur ne doit jamais casser le coordinateur */ } }

  /* ---------------------------------------------------------- cycle de vie */
  saveState() { if (this.store) { try { this.accountTime(); this.store.saveSearchState(this.id, { status: this.status, searchMs: this.searchMs }); } catch { /* non bloquant */ } } }
  start() { if (this.status === 'running') return; this.status = 'running'; this.lastTickAt = this.now(); for (const s of this.slots) if (s.state === 'init' || s.state === 'suspended') s.state = 'waiting'; this.emit('status', { status: this.status }); this.saveState(); this.schedule(); this.tick(); }
  pause() { if (this.status !== 'running') return; this.status = 'paused'; for (const w of this.workers) { if (w.slotId !== null) { w.handle.postMessage({ type: 'suspend' }); this.slots[w.slotId].state = 'suspended'; } } this.emit('status', { status: this.status }); this.persist(true); }
  resume() { if (this.status !== 'paused') return; this.status = 'running'; this.lastTickAt = this.now(); for (const w of this.workers) if (w.slotId !== null) { w.handle.postMessage({ type: 'resume' }); this.slots[w.slotId].state = 'running'; } for (const s of this.slots) if (s.state === 'suspended') s.state = 'waiting'; this.emit('status', { status: this.status }); this.saveState(); this.schedule(); }
  /** Arrêt : les résultats sont TOUJOURS conservés. */
  async stop() {
    if (this.status === 'stopped') return; this.accountTime(); this.status = 'stopped'; clearTimeout(this.timer); this.timer = null;
    for (const w of this.workers) { try { w.handle.postMessage({ type: 'stop' }); } catch { /* ignoré */ } }
    await new Promise((r) => setTimeout(r, 30)); this.drain();
    for (const w of this.workers) { try { await w.handle.terminate(); } catch { /* ignoré */ } } this.workers = [];
    for (const s of this.slots) if (s.state !== 'error') s.state = 'done';
    this.emit('status', { status: this.status }); this.persist(true);
  }
  drain() { /* les messages 'result' déjà postés par stop sont traités via onMessage */ }
  schedule() { if (this.timer || this.status !== 'running') return; this.timer = setTimeout(() => { this.timer = null; this.tick(); this.schedule(); }, this.tickMs); }
  accountTime() { const t = this.now(); if (this.lastTickAt !== null && this.status === 'running') this.searchMs += t - this.lastTickAt; this.lastTickAt = t; }

  /* ----------------------------------------------------------- ordonnancement */
  tick() {
    if (this.status !== 'running') return;
    this.accountTime();
    const r = this.resources() || {}, activeNow = this.workers.filter((w) => w.slotId !== null).length;
    this.gov = computeTarget({ requested: this.params.sims, manualMax: this.params.maxWorkers, serverMax: this.serverMax, cpus: r.cpus || 1, load1: r.load1 || 0, freeMemMB: r.freeMemMB ?? 2048, loopLagMs: r.loopLagMs || 0, avgCycleMs: this.avgCycleMs, cycleMs: this.params.cycleMs || defaultBudgetMs(this.params.n), current: activeNow });
    // watchdog
    const t = this.now(), limit = Math.max(30000, 3 * (this.params.cycleMs || defaultBudgetMs(this.params.n)));
    for (const w of this.workers.slice()) if (w.slotId !== null && t - w.lastBeat > limit) this.failWorker(w, 'worker sans signe de vie (watchdog)');
    // trop de workers actifs : on réduit en laissant finir les cycles en cours (aucun résultat perdu)
    const waiting = this.slots.filter((s) => s.state === 'waiting').sort((a, b) => a.lastRunAt - b.lastRunAt || a.id - b.id);
    let active = this.workers.filter((w) => w.slotId !== null).length;
    for (const s of waiting) {
      if (active >= this.gov.target) break;
      const w = this.freeWorker(); if (!w) break;
      this.assign(w, s); active++;
    }
    for (const w of this.workers.slice()) if (w.slotId === null && this.workers.length > Math.max(this.gov.target, 1)) { this.workers.splice(this.workers.indexOf(w), 1); try { w.handle.terminate(); } catch { /* ignoré */ } }
    if (t - this.lastCheckpoint > this.params.checkpointMs) this.persist(false);
  }
  freeWorker() {
    let w = this.workers.find((x) => x.slotId === null && x.ready);
    if (w) return w;
    if (this.workers.length >= Math.max(this.gov.target, 1) + 1) return null;
    return this.spawnWorker();
  }
  spawnWorker() {
    const wid = this.nextWid++, handle = this.spawn(wid), w = { wid, handle, slotId: null, taskId: null, ready: false, lastBeat: this.now() };
    handle.on('message', (m) => this.onMessage(w, m));
    handle.on('error', (e) => this.failWorker(w, String((e && e.message) || e)));
    handle.on('exit', (code) => { if (this.workers.includes(w) && code !== 0) this.failWorker(w, `worker terminé (code ${code})`); });
    this.workers.push(w); w.ready = true; return w; // les messages sont mis en file par le worker lui-même
  }

  /** Choisit origine, stratégie et parents du prochain cycle d'une simulation. */
  planCycle(slot) {
    const p = this.params, n = p.n, rng = this.rng, enabled = p.strategies, record = this.pool.record;
    let origin = 'random', parents = [], parentIds = [];
    // pool « trivial » (seulement la grille ⌈√n⌉) : muter la grille retombe sur la grille → 100 % de départs indépendants ;
    // pool maigre (< 4 solutions) ou stagnation prolongée : une part des cycles repart de zéro
    const grid = Math.ceil(Math.sqrt(n)), trivial = !record || record.S >= grid - 1e-9;
    const stagMs = Math.max(600000, 40 * (p.cycleMs || defaultBudgetMs(n))), stagnant = !!record && this.searchMs - this.lastImproveMs > stagMs;
    const forceNew = !trivial && ((this.pool.active().length < 4 && rng.next() < 0.5) || (stagnant && rng.next() < 0.35));
    if (p.mode === 'evolutionary' && record && !trivial) {
      let o = this.origins.choose(rng); if (forceNew) o = 'random';
      if (o === 'recomb') { const ps = this.pool.selectParents(rng, 2); if (ps.length >= 2) { parents = ps; } else o = 'best'; }
      if (o === 'best') parents = [record];
      if (o === 'diverse') { const ps = this.pool.selectParents(rng, 1, { includeRecord: false }); parents = ps.length ? ps : [record]; }
      origin = o === 'random' ? 'random' : o; if (origin === 'random') parents = [];
    }
    let strategy = 'evo';
    if (origin !== 'random' && enabled.includes('hop') && this.evoKind.choose(rng) === 'hop') strategy = 'hop'; // même parent, mais compression SLP dans la boucle
    if (origin === 'random') { const open = this.strategyBandit.keys().filter((k) => enabled.includes(k)); strategy = open.length === 1 ? open[0] : this.chooseAmong(open); }
    const amp = this.amps.choose(rng), op = MUTATIONS[Math.floor(rng.next() * MUTATIONS.length)];
    parentIds = parents.map((e) => e.id);
    return { origin, strategy, parents, parentIds, amp, op, seed: mix(slot.seed, slot.cycles + 1) };
  }
  chooseAmong(keys) { const p = this.strategyBandit.probabilities(); let tot = keys.reduce((a, k) => a + p[k], 0), r = this.rng.next() * tot; for (const k of keys) { r -= p[k]; if (r <= 0) return k; } return keys[0]; }

  assign(w, slot) {
    const plan = this.planCycle(slot), taskId = this.nextTask++, budgetMs = this.params.cycleMs || defaultBudgetMs(this.params.n);
    slot.state = 'running'; slot.strategy = plan.strategy === 'evo' ? `evo:${plan.origin}` : plan.strategy; slot.origin = plan.origin; slot.taskId = taskId; slot.wid = w.wid; slot.parents = plan.parentIds; slot.progress = 0; slot.budget = budgetMs; slot.lastRunAt = this.now(); slot.plan = { origin: plan.origin, strategy: plan.strategy, amp: plan.amp, op: plan.op, bestAtStart: this.pool.bestS };
    w.slotId = slot.id; w.taskId = taskId; w.lastBeat = this.now();
    const neighbors = plan.strategy === 'hop' && this.store && this.store.bestSolutionForN ? [this.params.n + 1, this.params.n - 1].map((m) => { try { return m >= 1 ? this.store.bestSolutionForN(m, this.id) : null; } catch { return null; } }).filter(Boolean) : undefined;
    const spec = { neighbors, n: this.params.n, seed: plan.seed, origin: plan.origin, strategy: plan.strategy, parents: plan.parents.map((e) => e.sol), op: { name: plan.op, amp: AMPLITUDES[plan.amp] }, budgetMs, effort: this.params.effort };
    w.handle.postMessage({ type: 'task', taskId, spec, knownS: this.pool.bestS });
    if (this.watched === slot.id) w.handle.postMessage({ type: 'watch', on: true });
    this.emit('slot', { slot: this.slotView(slot) });
  }

  /* ------------------------------------------------------------- messages */
  onMessage(w, m) {
    w.lastBeat = this.now(); const slot = w.slotId !== null ? this.slots[w.slotId] : null;
    if (m.type === 'ready' || m.type === 'started' || m.type === 'pong') return;
    if (!slot || m.taskId !== w.taskId) return; // message d'une tâche périmée : ignoré
    switch (m.type) {
      case 'progress': slot.progress = Math.min(1, m.elapsed / Math.max(1, m.budget)); slot.curIt = m.it; slot.curS = m.S; slot.elapsed = m.elapsed; break;
      case 'preview': case 'snapshot': this.previews.set(slot.id, { frame: m.frame, t: this.now(), detail: m.type === 'snapshot' }); if (m.type === 'snapshot') this.emit('snapshot', { slotId: slot.id, frame: this.packFrame(m.frame) }); break;
      case 'improve': { const r = this.submit(slot, m.sol, 'improvement'); if (r.status === 'record') this.broadcastKnown(); break; }
      case 'result': this.finishCycle(w, slot, m); break;
      case 'error': this.slotError(w, slot, m.message); break;
      default: break;
    }
  }
  packFrame(f) { return { S: f.S, container: f.container, working: f.working, target: f.target ?? null, phase: f.phase ?? null, kind: f.kind ?? null, best: f.best, it: f.it, xyt: Array.from(f.xyt, (v) => Math.round(v * 1e4) / 1e4), flags: Array.from(f.flags), free: f.free || null }; }
  broadcastKnown() { const S = this.pool.bestS; for (const w of this.workers) if (w.slotId !== null) w.handle.postMessage({ type: 'known', S }); }

  /** Soumission à l'Elite Pool (autorité de validation) + journalisation. */
  submit(slot, sol, kind) {
    const prevBest = this.pool.bestS, meta = { slot: slot.id, seed: slot.seed, strategy: slot.strategy, origin: slot.origin, parents: slot.parents, cycle: slot.cycles + 1, kind, t: this.now() };
    const r = this.pool.submit(sol, meta);
    if (r.status === 'invalid') { this.counters.invalid++; slot.invalid++; this.emit('rejected', { slot: slot.id, reasons: r.reasons }); return r; }
    if (r.status === 'duplicate') { this.counters.duplicates++; return r; }
    this.counters.validSolutions++;
    const e = r.entry;
    if (slot.bestS === null || e.S < slot.bestS - 1e-9) { slot.bestS = e.S; slot.best = sol; }
    slot.history.push({ t: this.now(), S: e.S, status: r.status }); if (slot.history.length > 40) slot.history.shift();
    if (this.store) { try { this.store.saveSolution(this.id, e); for (const ev of r.evicted) this.store.archiveSolution(this.id, ev); } catch (err) { this.emit('error', { message: `stockage : ${err.message}` }); } }
    if (r.status === 'record' && e.S < prevBest - 1e-12) {
      this.counters.improvements++; this.lastImproveMs = this.searchMs; const pt = { t: this.searchMs, wall: this.now(), S: e.S, fill: e.fill, slot: slot.id, strategy: slot.strategy, id: e.id }; this.history.push(pt);
      if (this.store) { try { this.store.saveHistory(this.id, pt); } catch { /* non bloquant */ } }
      this.emit('record', { S: e.S, fill: e.fill, id: e.id, slot: slot.id, strategy: slot.strategy });
      try { const c = certifyAgainstKnown(e.sol, this.params.n); if (c.beats) this.emit('beat', { n: c.n, S: c.S, ref: c.ref, id: e.id, slot: slot.id }); } catch { /* non bloquant */ }
    } else this.emit('solution', { id: e.id, S: e.S, status: r.status, slot: slot.id });
    return r;
  }

  finishCycle(w, slot, m) {
    slot.state = 'submitting'; const stats = m.stats || {}, plan = slot.plan || {}, bestBefore = plan.bestAtStart ?? Infinity;
    this.counters.cycles++; slot.cycles++; slot.iterations += stats.iterations || 0; slot.consecutiveErrors = 0;
    this.avgCycleMs = this.avgCycleMs ? 0.8 * this.avgCycleMs + 0.2 * (stats.ms || 0) : (stats.ms || 0);
    const r = this.submit(slot, m.sol, 'cycle'), S = m.sol && m.sol.S;
    const outcome = r.status === 'record' ? 'record' : r.status === 'improved' ? 'improved' : r.status === 'accepted' ? 'accepted' : r.status === 'duplicate' ? 'duplicate' : 'none';
    // un cycle dont l'amélioration a déjà été publiée en cours de route (improve) compte comme record
    const gotRecord = outcome === 'record' || (Number.isFinite(S) && S < bestBefore - 1e-9);
    const eff = gotRecord ? 'record' : outcome, reward = rewardOf(eff, S ?? Infinity, this.pool.bestS);
    if (plan.origin && plan.origin !== 'random' && this.params.strategies.includes('hop')) this.evoKind.update(plan.strategy === 'hop' ? 'hop' : 'evo', reward, { outcome: eff, ms: stats.ms });
    if (plan.origin) { this.origins.update(plan.origin, reward, { outcome: eff, ms: stats.ms }); if (plan.origin !== 'random') this.amps.update(plan.amp, reward, { outcome: eff, ms: stats.ms }); else this.strategyBandit.update(plan.strategy, reward, { outcome: eff, ms: stats.ms }); }
    this.emit('cycle', { slot: slot.id, S: S ?? null, outcome: eff, origin: plan.origin, strategy: slot.strategy, ms: stats.ms });
    w.slotId = null; w.taskId = null; slot.taskId = null; slot.wid = null; slot.progress = 1;
    slot.state = this.status === 'running' ? 'waiting' : this.status === 'paused' ? 'suspended' : 'done';
    if (this.status === 'running') this.tick();
  }

  /* ---------------------------------------------------------------- pannes */
  slotError(w, slot, message) {
    this.counters.errors++; slot.errors++; slot.consecutiveErrors++; w.slotId = null; w.taskId = null; slot.taskId = null; slot.wid = null;
    this.emit('slot-error', { slot: slot.id, message: String(message).split('\n')[0] });
    slot.state = slot.consecutiveErrors >= 5 ? 'error' : 'restarting'; // une simulation défaillante n'arrête jamais les autres
    if (slot.state === 'restarting') setTimeout(() => { if (slot.state === 'restarting') slot.state = this.status === 'paused' ? 'suspended' : 'waiting'; }, Math.min(5000, 200 * 2 ** slot.consecutiveErrors));
  }
  failWorker(w, message) {
    if (!this.workers.includes(w)) return; this.workers.splice(this.workers.indexOf(w), 1); try { w.handle.terminate(); } catch { /* ignoré */ }
    this.counters.workerRestarts++;
    if (w.slotId !== null) this.slotError(w, this.slots[w.slotId], message); else this.emit('worker-restart', { wid: w.wid, message });
  }

  /* ------------------------------------------------------------ import/état */
  /** Import d'une solution externe : traitée comme n'importe quelle soumission (validation indépendante). Aucune exécution de code. */
  importSolution(sol, meta = {}) {
    const r = this.pool.submit(sol, { slot: -1, strategy: 'import', origin: 'import', parents: [], cycle: 0, kind: 'import', t: this.now(), ...meta });
    if (r.status === 'invalid') return r;
    if (this.store) { try { this.store.saveSolution(this.id, r.entry); } catch { /* ignoré */ } }
    if (r.status === 'record') { this.counters.improvements++; this.history.push({ t: this.searchMs, wall: this.now(), S: r.entry.S, fill: r.entry.fill, slot: -1, strategy: 'import', id: r.entry.id }); this.broadcastKnown(); this.emit('record', { S: r.entry.S, fill: r.entry.fill, id: r.entry.id, slot: -1, strategy: 'import' }); }
    return r;
  }
  watch(slotId, on = true) { this.watched = on ? slotId : null; for (const w of this.workers) w.handle.postMessage({ type: 'watch', on: on && w.slotId === slotId }); }
  slotView(s, withPreview = false) {
    const pv = this.previews.get(s.id);
    return { id: s.id, state: s.state, strategy: s.strategy, origin: s.origin, cycles: s.cycles, iterations: s.iterations + (s.curIt || 0) * (s.state === 'running' ? 1 : 0), bestS: s.bestS, progress: s.state === 'running' ? s.progress : 0, errors: s.errors, invalid: s.invalid, seed: s.seed, parents: s.parents, history: s.history.slice(-10), curS: s.state === 'running' ? s.curS ?? null : null, preview: withPreview && pv ? this.packFrame(pv.frame) : null };
  }
  summary({ previews = false } = {}) {
    const rec = this.pool.record, active = this.workers.filter((w) => w.slotId !== null).length, waiting = this.slots.filter((s) => s.state === 'waiting').length;
    this.accountTime();
    return {
      id: this.id, status: this.status, params: this.params, createdAt: this.createdAt, searchMs: this.searchMs, seq: this.seq,
      resources: { requested: this.params.sims, active, waiting, target: this.gov.target, workersSpawned: this.workers.length, reasons: this.gov.reasons, caps: this.gov.caps || null, avgCycleMs: Math.round(this.avgCycleMs) },
      best: rec ? { id: rec.id, S: rec.S, size: rec.size, fill: rec.fill, meta: rec.meta } : null,
      counters: { ...this.counters, pool: this.pool.stats() },
      slots: this.slots.map((s) => this.slotView(s, previews)),
      bandits: { origins: this.origins.snapshot(), strategies: this.strategyBandit.snapshot(), amplitudes: this.amps.snapshot() },
      historyTail: this.history.slice(-200),
    };
  }
  listSolutions() { return this.pool.entries.map((e) => ({ id: e.id, S: e.S, size: e.size, fill: e.fill, category: e.category, nov: e.nov, version: e.version, meta: e.meta })).sort((a, b) => a.S - b.S); }
  getSolution(id) { const e = this.pool.entries.find((x) => x.id === +id); return e ? { id: e.id, S: e.S, size: e.size, fill: e.fill, category: e.category, meta: e.meta, solution: e.sol } : null; }

  /* ----------------------------------------------------------- persistance */
  checkpointData() {
    return { v: 1, savedAt: this.now(), searchMs: this.searchMs, counters: this.counters, avgCycleMs: this.avgCycleMs, bandits: { origins: this.origins.toJSON(), strategies: this.strategyBandit.toJSON(), amps: this.amps.toJSON(), evoKind: this.evoKind.toJSON() }, rng: null, nextTask: this.nextTask,
      slots: this.slots.map((s) => ({ id: s.id, seed: s.seed, cycles: s.cycles, iterations: s.iterations, bestS: s.bestS, best: s.best, strategy: s.strategy, errors: s.errors, history: s.history })),
      note: 'Reprise approximative : seules les meilleures solutions et les compteurs sont restaurés ; l\'état interne des recuits en cours (température, PRNG) n\'est pas sauvegardé.' };
  }
  persist(force) { this.lastCheckpoint = this.now(); if (!this.store) return; try { this.accountTime(); this.store.saveCheckpoint(this.id, this.checkpointData()); this.store.saveSearchState(this.id, { status: this.status, searchMs: this.searchMs }); } catch (e) { this.emit('error', { message: `checkpoint : ${e.message}` }); } void force; }
  /** Restauration depuis la base : chaque solution est RE-VALIDÉE avant d'entrer dans le pool. */
  restore({ checkpoint, solutions = [], history = [] }) {
    let rejected = 0;
    for (const s of solutions) { const r = this.pool.submit(s.solution, s.meta || {}); if (r.status === 'invalid') rejected++; else if (r.entry) { r.entry.meta = s.meta || r.entry.meta; if (s.id) r.entry.id = s.id; if (s.category === 'historical') r.entry.category = 'historical'; } }
    this.pool.nextId = Math.max(this.pool.nextId, ...this.pool.entries.map((e) => e.id + 1), 1);
    this.history = history.slice(-5000);
    if (checkpoint) {
      this.searchMs = checkpoint.searchMs || 0; Object.assign(this.counters, checkpoint.counters || {}); this.avgCycleMs = checkpoint.avgCycleMs || 0; this.nextTask = checkpoint.nextTask || 1;
      this.origins.restore(checkpoint.bandits?.origins); this.strategyBandit.restore(checkpoint.bandits?.strategies); this.amps.restore(checkpoint.bandits?.amps); if (checkpoint.bandits?.evoKind) this.evoKind.restore(checkpoint.bandits.evoKind);
      for (const c of checkpoint.slots || []) { const s = this.slots[c.id]; if (!s) continue; s.cycles = c.cycles || 0; s.iterations = c.iterations || 0; s.errors = c.errors || 0; s.history = c.history || []; if (c.best && judge(c.best, { n: this.params.n }).ok) { s.best = c.best; s.bestS = c.best.S; } }
    }
    this.emit('restored', { solutions: solutions.length, rejected }); return { rejected };
  }
}
