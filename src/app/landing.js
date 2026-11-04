/** Animation du héros : le moteur place réellement des carrés (MaxRects), en boucle, graine différente à chaque cycle. */
import { normalizeConfig } from '../engine/config.js';
import { makeInstance } from '../engine/instance.js';
import { createSolver } from '../algorithms/registry.js';
import { sizeColor } from '../render/renderer.js';

const canvas = document.getElementById('hero');
if (canvas) {
  const g = canvas.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let solver, inst, seed = 7, hold = 0;
  const start = () => {
    const { config } = normalizeConfig({ n: 90, sizeMode: 'random', sMin: 1, sMax: 3, W: 24, algorithm: 'maxrects', seed: seed++ });
    inst = makeInstance(config); solver = createSolver('maxrects', inst, config); hold = 0;
  };
  const draw = () => {
    const v = solver.view(), s = canvas.width / inst.W;
    g.clearRect(0, 0, canvas.width, canvas.height); g.fillStyle = '#0d0f14'; g.fillRect(0, 0, canvas.width, canvas.height);
    const span = Math.max(1e-9, inst.maxSide - inst.minSide);
    for (let i = 0; i < v.sq.length; i += 6) {
      const x = (v.sq[i + 1] - v.sq[i + 3] / 2) * s, y = (v.sq[i + 2] - v.sq[i + 3] / 2) * s, w = v.sq[i + 3] * s;
      g.fillStyle = sizeColor((v.sq[i + 3] - inst.minSide) / span, 0.85); g.fillRect(x, y, w, w);
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, w);
    }
  };
  start();
  const frame = () => {
    if (!solver.done) { for (let i = 0; i < 2 && !solver.done; i++) solver.step(); } else if (++hold > 120) start();
    draw(); if (!reduce) requestAnimationFrame(frame);
  };
  if (reduce) { while (!solver.done) solver.step(); draw(); } else requestAnimationFrame(frame);
}
