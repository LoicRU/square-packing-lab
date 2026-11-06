import { describe, it, expect } from 'vitest';
import { Coordinator, validateParams } from '../src/parallel/coordinator.js';
import { InlineWorker } from '../src/parallel/inline.js';
import { MemoryStore } from '../src/parallel/memstore.js';
import { computeTarget } from '../src/parallel/governor.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await sleep(20); } };
const make = (over = {}, opts = {}) => {
  const workers = []; const c = new Coordinator({ id: 's1', params: { n: 10, sims: 4, seed: 7, cycleMs: 700, ...over }, spawn: () => { const w = new InlineWorker(); workers.push(w); return w; }, tickMs: 20, resources: () => ({ cpus: 8, load1: 0, freeMemMB: 8000, loopLagMs: 0 }), ...opts });
  return { c, workers };
};

describe('paramètres et gouverneur', () => {
  it('valide les limites côté coordinateur', () => {
    expect(validateParams({ n: 0, sims: 4 }).ok).toBe(false); expect(validateParams({ n: 17, sims: 1000 }).ok).toBe(false); expect(validateParams({ n: 1e6, sims: 2 }).ok).toBe(false);
    expect(validateParams({ n: 17, sims: 4, maxWorkers: 500 }).ok).toBe(false); expect(validateParams({ n: 17, sims: 4, cycleMs: 5 }).ok).toBe(false); expect(validateParams({ n: 17, sims: 4 }).ok).toBe(true);
    expect(validateParams({ n: 'abc', sims: 4 }).ok).toBe(false);
  });
  it('gouverneur : jamais illimité, respecte cœurs, limite manuelle, mémoire, charge', () => {
    expect(computeTarget({ requested: 1000, cpus: 8 }).target).toBeLessThanOrEqual(64);
    expect(computeTarget({ requested: 32, cpus: 8, current: 7 }).target).toBeLessThanOrEqual(8);
    expect(computeTarget({ requested: 32, cpus: 8, manualMax: 3, current: 3 }).target).toBe(3);
    expect(computeTarget({ requested: 32, cpus: 16, freeMemMB: 300, perWorkerMB: 120, current: 5 }).target).toBeLessThanOrEqual(1);
    expect(computeTarget({ requested: 8, cpus: 4, load1: 8, current: 3 }).target).toBe(2); // surcharge : on recule d'un worker
    expect(computeTarget({ requested: 8, cpus: 4, loopLagMs: 900, current: 3 }).target).toBe(2);
    expect(computeTarget({ requested: 1, cpus: 8 }).target).toBe(1);
  });
});

describe('Parallel Coordinator', () => {
  it('plusieurs workers actifs réellement en parallèle ; demandées ≠ actifs ≠ en attente', async () => {
    const { c } = make({ sims: 6, maxWorkers: 2 }); c.start(); let maxActive = 0, sawWaiting = false;
    await until(() => { const s = c.summary(); maxActive = Math.max(maxActive, s.resources.active); sawWaiting ||= s.resources.waiting > 0; return c.counters.cycles >= 6; });
    expect(maxActive).toBe(2); expect(sawWaiting).toBe(true); await c.stop();
  }, 40000);
  it('toutes les simulations tournent (sims ≤ cœurs) et partagent un Elite Pool', async () => {
    const { c } = make({ sims: 4 }); c.start(); let maxActive = 0;
    await until(() => { maxActive = Math.max(maxActive, c.summary().resources.active); return c.counters.cycles >= 8 && c.pool.record; });
    expect(maxActive).toBeGreaterThanOrEqual(3); expect(c.pool.record.S).toBeLessThanOrEqual(Math.ceil(Math.sqrt(10)) + 1e-9); await c.stop();
  }, 40000);
  it('le record global ne régresse jamais ; stop conserve les résultats', async () => {
    const { c } = make({ sims: 3 }); c.start(); const seen = [];
    await until(() => { seen.push(c.pool.bestS); return c.counters.cycles >= 9; }); await c.stop();
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] + 1e-12);
    expect(c.status).toBe('stopped'); expect(c.pool.record).toBeTruthy(); expect(c.listSolutions().length).toBeGreaterThan(0);
  }, 40000);
  it('pause / reprise', async () => {
    const { c } = make({ sims: 2 }); c.start(); await until(() => c.counters.cycles >= 2); c.pause(); await sleep(150);
    const n1 = c.counters.cycles; await sleep(900); expect(c.counters.cycles - n1).toBeLessThanOrEqual(2); // les cycles en cours se terminent au plus
    expect(c.status).toBe('paused'); c.resume(); await until(() => c.counters.cycles >= n1 + 4); await c.stop();
  }, 40000);
  it('défaillance d\'un worker : la simulation est relancée, les autres continuent', async () => {
    const { c, workers } = make({ sims: 3 }); c.start(); await until(() => workers.length >= 2); workers[0].crash('boom');
    await until(() => c.counters.workerRestarts >= 1); const before = c.counters.cycles; await until(() => c.counters.cycles >= before + 3);
    expect(c.slots.filter((s) => s.state === 'error').length).toBe(0); expect(c.counters.errors).toBeGreaterThanOrEqual(1); await c.stop();
  }, 40000);
  it('résultat invalide (worker malveillant) : rejeté, jamais affiché comme record', async () => {
    const forged = { n: 10, S: 2, x: Array(10).fill(1), y: Array(10).fill(1), th: Array(10).fill(0) }; // S < √N et tout superposé
    const spawn = () => { const h = { m: [], e: [], x: [] }; return { on(t, f) { ({ message: h.m, error: h.e, exit: h.x })[t].push(f); return this; }, terminate() { return Promise.resolve(); },
      postMessage(msg) { if (msg.type === 'task') setTimeout(() => h.m.forEach((f) => f({ type: 'result', taskId: msg.taskId, sol: forged, stats: { iterations: 1, ms: 5 } })), 10); } }; };
    const c = new Coordinator({ id: 'x', params: { n: 10, sims: 2, seed: 1, cycleMs: 500 }, spawn, tickMs: 10, resources: () => ({ cpus: 4 }) }); c.start();
    await until(() => c.counters.invalid >= 3); expect(c.pool.record).toBeNull(); expect(c.summary().best).toBeNull(); await c.stop();
  });
  it('plans de cycles reproductibles avec une graine fixe', () => {
    const a = make({ sims: 2 }).c, b = make({ sims: 2 }).c;
    const base = { n: 10, S: 4, x: Array.from({ length: 10 }, (_, i) => (i % 4) + 0.5), y: Array.from({ length: 10 }, (_, i) => Math.floor(i / 4) + 0.5), th: new Array(10).fill(0) };
    a.pool.submit(base); b.pool.submit(base);
    const pa = [0, 1, 2, 3].map(() => { const p = a.planCycle(a.slots[0]); return [p.origin, p.strategy, p.op, p.amp, p.seed]; }), pb = [0, 1, 2, 3].map(() => { const p = b.planCycle(b.slots[0]); return [p.origin, p.strategy, p.op, p.amp, p.seed]; });
    expect(pa).toEqual(pb);
  });
  it('import : solution valide acceptée, invalide rejetée', () => {
    const { c } = make(); const ok = { n: 10, S: 4, x: Array.from({ length: 10 }, (_, i) => (i % 4) + 0.5), y: Array.from({ length: 10 }, (_, i) => Math.floor(i / 4) + 0.5), th: new Array(10).fill(0) };
    expect(c.importSolution(ok).status).toBe('record'); expect(c.importSolution({ ...ok, x: ok.x.map(() => 1) }).status).toBe('invalid'); expect(c.pool.bestS).toBe(4);
  });
  it('checkpoint → restauration : records conservés, solution falsifiée rejetée', async () => {
    const store = new MemoryStore(); const { c } = make({ sims: 2 }, { store }); c.start(); await until(() => c.counters.cycles >= 4); await c.stop();
    const best = c.pool.bestS, saved = store.load('s1'); expect(saved.checkpoint).toBeTruthy(); expect(saved.solutions.length).toBeGreaterThan(0);
    saved.solutions.push({ id: 999, S: 1.5, category: 'record', meta: {}, solution: { n: 10, S: 1.5, x: Array(10).fill(1), y: Array(10).fill(1), th: Array(10).fill(0) } }); // falsifiée en base
    const { c: d } = make({ sims: 2 }); const r = d.restore(saved);
    expect(r.rejected).toBe(1); expect(d.pool.bestS).toBeCloseTo(best, 9); expect(d.counters.cycles).toBe(c.counters.cycles); d.start(); await until(() => d.counters.cycles >= c.counters.cycles + 2); expect(d.pool.bestS).toBeLessThanOrEqual(best + 1e-12); await d.stop();
  }, 60000);
});
