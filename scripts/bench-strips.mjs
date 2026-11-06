// Benchmark « sans / avec motifs à bande inclinée » (vrais worker_threads, même budget : 2 workers × T s).
//   node scripts/bench-strips.mjs [secondes=12] [N,N,…] > docs/bench-strips.json
import { Worker } from 'node:worker_threads';
import { Coordinator } from '../src/parallel/coordinator.js';
import { MemoryStore } from '../src/parallel/memstore.js';
import { judge } from '../src/parallel/authority.js';
import { BEST } from '../src/engine/known.js';
const T = +(process.argv[2] || 12) * 1000, NS = (process.argv[3] || '17,26,27,29,37,39,50').split(',').map(Number), SEEDS = (process.env.SEEDS || '11').split(',').map(Number);
const spawn = () => new Worker(new URL('../server/threadWorker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 384 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(n, strategies, seed) {
  const c = new Coordinator({ id: 'b', params: { n, seed, sims: 2, maxWorkers: 2, mode: 'independent', strategies, cycleMs: Math.round(T / 2) }, spawn, store: new MemoryStore(), resources: () => ({ cpus: 2, load1: 0, freeMemMB: 4000 }), tickMs: 100 });
  const t0 = Date.now(); c.start(); while (Date.now() - t0 < T) await sleep(200); await c.stop();
  const r = c.pool.record; return r && judge(r.sol, { n }).ok ? r.S : null;
}
const CFG = process.env.CMP === 'hop' ? { 'sans hop': ['direct', 'anneal', 'circle', 'pattern'], 'avec hop': ['direct', 'anneal', 'circle', 'pattern', 'hop'] } : { 'sans motifs': ['direct', 'anneal', 'circle'], 'avec motifs': ['direct', 'anneal', 'circle', 'pattern'] };
const out = [];
for (const n of NS) for (const [label, st] of Object.entries(CFG)) {
  const Ss = []; for (const seed of SEEDS) Ss.push(await run(n, st, seed));
  const best = Math.min(...Ss.filter((x) => x !== null)); out.push({ n, label, S: best, all: Ss, grille: Math.ceil(Math.sqrt(n)), connu: BEST[n] ?? null });
  console.error(`N=${n} ${label}: S=${best.toFixed(4)} (grille ${Math.ceil(Math.sqrt(n))}, connu ${BEST[n]?.toFixed(4) ?? '—'})`);
}
console.log(JSON.stringify({ T: T / 1000, seeds: SEEDS, cpus: 2, results: out }, null, 1)); process.exit(0);
