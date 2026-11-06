// Benchmark du moteur parallèle à budget de calcul comparable (vrais worker_threads).
//   node scripts/bench-parallel.mjs [secondesBase=20] [N,N,…] > docs/bench-parallel.json
// Budget : 2 workers × T secondes pour toutes les configurations ; « recherche seule » = 1 worker × 2T secondes.
import { Worker } from 'node:worker_threads';
import { Coordinator } from '../src/parallel/coordinator.js';
import { MemoryStore } from '../src/parallel/memstore.js';
import { judge } from '../src/parallel/authority.js';

const T = +(process.argv[2] || 20) * 1000, NS = (process.argv[3] || '5,10,17,25,50,100').split(',').map(Number), SEED = 11;
const REF = { 5: 2.7071, 10: 3.7071, 17: 4.6756, 25: 5, 50: null, 100: 10 }; // meilleurs connus / optimum (N=25, 100 : carrés parfaits) ; 50 : pas de référence fiable utilisée
const spawn = () => new Worker(new URL('../server/threadWorker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 384 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(label, n, params, wallMs) {
  const store = new MemoryStore(), c = new Coordinator({ id: label, params: { n, seed: SEED, ...params }, spawn, store, resources: () => ({ cpus: 2, load1: 0, freeMemMB: 4000 }), tickMs: 100 });
  const t0 = Date.now(); c.start(); while (Date.now() - t0 < wallMs) await sleep(200); await c.stop();
  const rec = c.pool.record, v = rec ? judge(rec.sol, { n }) : { ok: false };
  const first = c.history.find((h) => rec && h.S <= rec.S + 1e-9);
  return { label, n, S: rec ? rec.S : null, fill: rec ? rec.fill : null, valid: v.ok, cycles: c.counters.cycles, records: c.counters.improvements, poolSize: c.pool.entries.length, msToBest: first ? Math.round(first.t) : null, strategies: c.summary().bandits.origins };
}
const out = [];
for (const n of NS) {
  const t = [25, 100, 5, 10].includes(n) ? Math.min(T, 8000) : T, cyc = Math.round(t / 2);
  const cfg = [
    ['recherche seule (1 worker, 2T)', { sims: 1, maxWorkers: 1, mode: 'independent', strategies: ['direct'], cycleMs: 2 * t }, 2 * t],
    ['indépendantes (2 workers, sans partage)', { sims: 2, maxWorkers: 2, mode: 'independent', strategies: ['direct', 'anneal'], cycleMs: cyc }, t],
    ['évolutif (Elite Pool partagé)', { sims: 4, maxWorkers: 2, mode: 'evolutionary', cycleMs: Math.round(t / 4) }, t],
    ['Circle → Square seul', { sims: 2, maxWorkers: 2, mode: 'independent', strategies: ['circle'], cycleMs: cyc }, t],
    ['Square Packing direct seul', { sims: 2, maxWorkers: 2, mode: 'independent', strategies: ['direct'], cycleMs: cyc }, t],
  ];
  for (const [label, params, wall] of cfg) { const r = await run(label, n, params, wall); r.ref = REF[n]; r.gapPct = r.S && REF[n] ? ((r.S / REF[n] - 1) * 100) : null; out.push(r); console.error(`N=${n} ${label}: S=${r.S?.toFixed(4)} (${r.valid ? 'valide' : 'INVALIDE'}) cycles=${r.cycles}`); }
}
console.log(JSON.stringify({ T: T / 1000, seed: SEED, cpus: 2, results: out }, null, 1));
process.exit(0);
