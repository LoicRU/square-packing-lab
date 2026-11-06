// Banc d'essai du pipeline : node scripts/bench-pipeline.mjs [graine] — N = 17, 25, 50, 100
import { PipelineSolver } from '../src/algorithms/pipeline.js';
import { verifyIndependent } from '../src/engine/verify.js';
import { maxSizeLiterature } from '../src/engine/classify.js';
const seed = +process.argv[2] || 1, W = 20;
console.log('N | S | a=W/S | remplissage | valide (indép.) | réf. littérature | écart | temps');
for (const n of [17, 25, 50, 100]) {
  const it = Math.round(Math.min(400000, Math.max(5000, 4e6 / n))), t = Date.now(), s = new PipelineSolver({ n, W, seed, iterations: it });
  while (!s.done) s.step();
  const v = verifyIndependent(s.result().placements, W, { expectedN: n }), lit = maxSizeLiterature(n, s.bestS);
  console.log(`${n} | ${s.bestS.toFixed(4)} | ${(W / s.bestS).toFixed(4)} | ${(100 * n / s.bestS ** 2).toFixed(2)} % | ${v.valid} | ${lit ? JSON.stringify(lit.text).slice(0, 90) : 'aucune référence fiable'} | | ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
