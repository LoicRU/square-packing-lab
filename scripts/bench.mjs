// Banc de performance headless : node scripts/bench.mjs
import { normalizeConfig } from '../src/engine/config.js';
import { makeInstance } from '../src/engine/instance.js';
import { solveHeadless } from '../src/algorithms/registry.js';
const ns = [10, 100, 500, 1000], algos = ['maxrects', 'guillotine', 'skyline', 'shelf', 'anneal', 'forces', 'circle2square'];
console.log('algo'.padEnd(15) + ns.map((n) => `n=${n}`.padStart(22)).join(''));
for (const a of algos) {
  let line = a.padEnd(15);
  for (const n of ns) {
    const side = Math.sqrt((n * 7 / 3) / 0.6);
    const { config } = normalizeConfig({ n, W: side, sMin: 1, sMax: 2, algorithm: a, iterations: 600, limits: { maxN: 5000 } });
    const t = performance.now(), r = solveHeadless(config), ms = performance.now() - t;
    line += `${(r.stats.fill * 100).toFixed(1)}% ${ms.toFixed(0)}ms${r.stats.valid ? '' : ' !'}`.padStart(22);
  }
  console.log(line);
}
