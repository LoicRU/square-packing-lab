// Banc d'essai à temps fixe : S obtenu après T secondes (2 workers) et temps jusqu'à la première solution hors grille.
//   node scripts/bench-fixed.mjs [secondes=45] [N,N,…]      ROOT=/autre/arbre (comparaison avant/après), SEEDS=11,12
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(process.env.ROOT || path.join(import.meta.dirname, '..'));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { Coordinator } = await imp('src/parallel/coordinator.js'), { MemoryStore } = await imp('src/parallel/memstore.js'), { judge } = await imp('src/parallel/authority.js');
const T = +(process.argv[2] || 45) * 1000, NS = (process.argv[3] || '29,39').split(',').map(Number), SEEDS = (process.env.SEEDS || '11,12').split(',').map(Number);
const spawn = () => new Worker(pathToFileURL(path.join(ROOT, 'server/threadWorker.js')), { resourceLimits: { maxOldGenerationSizeMb: 384 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const n of NS) {
  const Ss = [], firsts = [];
  for (const seed of SEEDS) {
    const c = new Coordinator({ id: 'b', params: { n, seed, sims: 4, maxWorkers: 2, mode: 'evolutionary', cycleMs: 6000 }, spawn, store: new MemoryStore(), resources: () => ({ cpus: 2, load1: 0, freeMemMB: 4000 }), tickMs: 100 });
    const t0 = Date.now(); let first = null; c.start();
    while (Date.now() - t0 < T) { await sleep(250); const r = c.pool.record; if (first === null && r && r.S < Math.ceil(Math.sqrt(n)) - 1e-6) first = (Date.now() - t0) / 1000; }
    await c.stop(); const r = c.pool.record; Ss.push(r && judge(r.sol, { n }).ok ? r.S : null); firsts.push(first);
  }
  console.log(`N=${n} ${path.basename(ROOT)}: S après ${T / 1000}s = ${Ss.map((s) => s?.toFixed(4)).join(' / ')} ; 1re solution hors grille à ${firsts.map((f) => (f === null ? 'jamais' : f.toFixed(0) + 's')).join(' / ')}`);
}
process.exit(0);
