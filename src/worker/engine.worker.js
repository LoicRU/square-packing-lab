/**
 * Web Worker : exécute les algorithmes hors du thread de l'interface.
 * Protocole (main → worker) : init, play, pause, step, speed, params, stop,
 * compare, scaling, c2sStudy, cancel.
 * Réponses : ready, snapshot, done, compareRow, compareDone, scalingRow,
 * scalingDone, studyRow, studyDone, error.
 *
 * VITESSE DE SIMULATION : « étapes de l'algorithme par seconde » (indépendante
 * de la vitesse réelle de calcul). Si le calcul est plus lent que demandé,
 * le worker tourne à plein régime ; s'il est plus rapide, il attend.
 */
import { normalizeConfig, msIterationsFor } from '../engine/config.js';
import { MaxSizeSolver } from '../algorithms/maxsize.js';
import { PipelineSolver } from '../algorithms/pipeline.js';
import { verifyIndependent } from '../engine/verify.js';
import { largestHole, freeCenters } from '../engine/nfp.js';
import { makeInstance, buildInstance, diagnose } from '../engine/instance.js';
import { createSolver, ALGORITHMS } from '../algorithms/registry.js';
import { CircleSquareSolver } from '../algorithms/circlesquare.js';
import { computeStats } from '../engine/stats.js';
import { classify, literatureNote, classifyMaxSize, maxSizeLiterature } from '../engine/classify.js';

const BASE_SPS = { constructif: 40, continu: 90, hybride: 90 };
let solver = null, instance = null, config = null, running = false, speed = 1, timer = null;
let freeRun = false, frames = [], frameN = 0, lastFlush = 0;
let computeMs = 0, lastPost = 0, lastTick = 0, stepsDue = 0, finished = false, cancel = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const yieldNow = () => new Promise((r) => setTimeout(r, 0));

function flat(placements) {
  const a = new Float64Array(placements.length * 6);
  placements.forEach((p, i) => a.set([p.id, p.x, p.y, p.side, p.theta, 0], i * 6));
  return a;
}

function init(raw) {
  clearTimeout(timer); timer = null; running = false; finished = false; computeMs = 0; stepsDue = 0; cancel = false; freeRun = false; frames = []; frameN = 0;
  const { config: c, warnings } = normalizeConfig(raw);
  config = c;
  if (c.problem === 'maxsize') {
    const k = Math.ceil(Math.sqrt(c.n)), side = c.W / k;
    instance = buildInstance({ W: c.W, H: c.W, items: Array.from({ length: c.n }, (_, i) => ({ id: i, side })), seed: c.seed, rotation: true, sizeMode: 'identical' });
    const its = msIterationsFor(c);
    if (c.msStrategy === 'pipeline') { solver = new PipelineSolver({ n: c.n, W: c.W, seed: c.seed, iterations: c.msIterations ? its : Math.round(its * 0.5) }); freeRun = true; frames = []; frameN = 0; }
    else { solver = new MaxSizeSolver({ n: c.n, W: c.W, seed: c.seed, iterations: its, strategy: c.msStrategy }); freeRun = false; }
  } else { instance = makeInstance(c); solver = createSolver(c.algorithm, instance, c); }
  post({ type: 'ready', config: c, warnings, diagnostics: diagnose(instance), instance: { W: instance.W, H: instance.H, n: instance.n, totalArea: instance.totalArea, containerArea: instance.containerArea, minSide: instance.minSide, maxSide: instance.maxSide, sizes: instance.items.map((i) => i.side), identical: instance.identical } });
  snapshot(true);
}

const kindOf = () => (config.problem === 'maxsize' ? 'continu' : ALGORITHMS[config.algorithm].kind);

function snapshot(force) {
  const now = performance.now();
  if (!force && now - lastPost < 33) return;
  lastPost = now;
  const v = solver.view(), m = v.metrics, kind = kindOf();
  let placed, placedArea;
  if (m.certArea !== undefined) { placed = m.certCount; placedArea = m.certArea; }
  else { placed = v.sq.length / 6; placedArea = 0; for (let i = 0; i < v.sq.length; i += 6) placedArea += v.sq[i + 3] ** 2; }
  const transfer = []; if (v.sq) transfer.push(v.sq.buffer); if (v.circ) transfer.push(v.circ.buffer);
  post({
    type: 'snapshot', sq: v.sq, circ: v.circ, morph: v.morph, phase: v.phase, label: v.label, kind,
    extra: v.extra || null, stats: { placed, unplaced: instance.n - placed, placedArea, fill: placedArea / instance.containerArea, wasted: 1 - placedArea / instance.containerArea, collisions: m.collisions, energy: m.energy, iteration: m.iteration, progress: m.progress, stage: m.stage, computeMs },
  }, transfer);
}

/** Calcul LIBRE (pipeline) : tourne à pleine vitesse, enregistre des images clés réelles ; la lecture est gérée par l'interface. */
function pushFrame() {
  const v = solver.view(), m = v.metrics, x = v.extra;
  frames.push({
    i: frameN++, sq: v.sq, circ: v.circ, circFlags: v.circFlags || null, morph: v.morph || 0, phaseIdx: x.phaseIdx, phaseName: x.phaseName, stage: m.stage,
    extra: { S: x.S, target: x.target ?? null, attempt: x.attempt ?? 0, successes: x.successes ?? 0, attemptColl: x.attemptColl ?? 0, attemptE: x.attemptE ?? 0, working: !!x.working, lo: x.lo ?? null, phases: x.phases, best: x.best, kind: x.kind ?? null, factor: x.factor ?? null },
    stats: { iteration: m.iteration, progress: m.progress, energy: m.energy, collisions: m.collisions, certArea: m.certArea, certCount: m.certCount, computeMs },
  });
  if (frameN > 700 && solver.frameEvery < 1e9) solver.frameEvery = Math.round(solver.frameEvery * 1.5);
}
function flushFrames(force) {
  const now = performance.now(); if (!frames.length || (!force && now - lastFlush < 60)) return; lastFlush = now;
  const tr = []; for (const f of frames) { if (f.sq) tr.push(f.sq.buffer); if (f.circ) tr.push(f.circ.buffer); if (f.circFlags) tr.push(f.circFlags.buffer); }
  post({ type: 'frames', frames, computeMs, done: !!solver.done }, tr); frames = [];
}
function freeTick() {
  timer = null; if (!freeRun || !solver || finished || cancel) return;
  const t0 = performance.now();
  while (!solver.done && performance.now() - t0 < 24) { const s = performance.now(); solver.step(); computeMs += performance.now() - s; if (solver.takeFrame()) pushFrame(); }
  if (solver.done) { pushFrame(); flushFrames(true); finish(); return; }
  flushFrames(false); timer = setTimeout(freeTick, 0);
}
/** Zones libres exactes (NFP) d'une disposition fournie : plus grand trou + points d'insertion. */
function freeQuery(m) {
  const { sq, W, S } = m, k = W / S, units = [];
  for (let i = 0; i < sq.length; i += 6) units.push({ x: sq[i + 1] / k, y: sq[i + 2] / k, side: 1, theta: sq[i + 4] });
  const hole = largestHole(units, S, { iters: 12 });
  const probe = Math.max(0.2, Math.min(0.5, hole ? hole.side * 0.98 : 0.3)), spots = freeCenters(units, S, { side: probe, theta: 0 }, { maxPoints: 400 }).points;
  post({ type: 'free', id: m.id, k, hole: hole ? { x: hole.x * k, y: hole.y * k, side: hole.side * k, theta: hole.theta } : null, spots: spots.map((p) => [p[0] * k, p[1] * k]), probe: probe * k, unit: k });
}

function finish() {
  if (finished) return;
  finished = true; running = false; clearTimeout(timer); timer = null;
  const res = solver.result(), iter = solver.iteration ?? solver.iter ?? 0;
  const stats = computeStats(instance, res.placements, computeMs, iter);
  if (config.problem === 'maxsize') {
    const a = solver.analysis;
    const ver = verifyIndependent(res.placements.map((p) => ({ x: p.x, y: p.y, side: p.side, theta: p.theta })), config.W, { expectedN: config.n });
    post({ type: 'done', problem: 'maxsize', verify: { valid: ver.valid, overlaps: ver.overlaps, maxOverlapArea: ver.maxOverlapArea, outOfBounds: ver.outOfBounds, sidesEqual: ver.sidesEqual, anglesInRange: ver.anglesInRange, problems: ver.problems }, sq: flat(res.placements), rejected: [], stats, classification: classifyMaxSize({ n: config.n, S: a.S, valid: stats.valid }), literature: maxSizeLiterature(config.n, a.S), analysis: a, algorithm: 'maxsize', strategy: config.msStrategy });
    return;
  }
  post({ type: 'done', sq: flat(res.placements), rejected: res.rejected, stats, classification: classify(instance, stats), literature: literatureNote(instance, stats), analysis: solver.analysis || null, algorithm: config.algorithm });
}

function tick() {
  timer = null;
  if (!running || !solver) return;
  const now = performance.now(), dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
  const kind = kindOf();
  stepsDue += speed === Infinity ? 1e9 : BASE_SPS[kind] * speed * dt;
  const t0 = performance.now();
  while (stepsDue >= 1 && !solver.done && performance.now() - t0 < 14) { const s = performance.now(); solver.step(); computeMs += performance.now() - s; stepsDue -= 1; }
  if (solver.done) { snapshot(true); finish(); return; }
  if (stepsDue > 1e6) stepsDue = 0;
  snapshot(false);
  timer = setTimeout(tick, 0);
}

function stepOnce(k) {
  if (!solver || finished) return;
  running = false; clearTimeout(timer); timer = null;
  for (let i = 0; i < k && !solver.done; i++) { const s = performance.now(); solver.step(); computeMs += performance.now() - s; }
  snapshot(true);
  if (solver.done) finish();
}

/** Exécute un solveur de façon coopérative (annulable). */
async function runSolver(s, maxMs) {
  const t0 = performance.now(); let compute = 0, sliceStart = performance.now();
  while (!s.done && !cancel) {
    const a = performance.now(); s.step(); compute += performance.now() - a;
    if (performance.now() - sliceStart > 25) { await yieldNow(); sliceStart = performance.now(); }
    if (performance.now() - t0 > maxMs) break;
  }
  return compute;
}

async function compare(m) {
  cancel = false;
  const { config: c } = normalizeConfig(m.config), inst = makeInstance(c);
  for (const id of m.algorithms) {
    if (cancel) break;
    const cc = { ...c, algorithm: id }, s = createSolver(id, inst, cc);
    post({ type: 'compareStart', id });
    const compute = await runSolver(s, m.maxMs || 30000);
    const res = s.result(), stats = computeStats(inst, res.placements, compute, s.iteration ?? s.iter ?? 0);
    post({ type: 'compareRow', id, stats, classification: classify(inst, stats), literature: literatureNote(inst, stats), sq: flat(res.placements), W: inst.W, H: inst.H, iterations: s.iteration ?? s.iter ?? 0 });
    await yieldNow();
  }
  post({ type: 'compareDone', cancelled: cancel });
}

/** Tentatives multiples (problème « taille maximale ») : mêmes N et W, stratégies / graines différentes. */
async function attempts(m) {
  cancel = false;
  const { config: c } = normalizeConfig(m.config);
  for (const run of m.runs) {
    if (cancel) break;
    const its = msIterationsFor(c), s = run.strategy === 'pipeline' ? new PipelineSolver({ n: c.n, W: c.W, seed: run.seed, iterations: Math.round(its * 0.5) }) : new MaxSizeSolver({ n: c.n, W: c.W, seed: run.seed, iterations: its, strategy: run.strategy });
    post({ type: 'attemptStart', run });
    const compute = await runSolver(s, m.maxMs || 60000);
    if (!s.done) s.stop();
    const res = s.result(), inst = buildInstance({ W: c.W, H: c.W, items: res.placements.map((p) => ({ id: p.id, side: p.side })) });
    const stats = computeStats(inst, res.placements, compute, s.iteration), a = s.analysis;
    post({ type: 'attemptRow', run, stats, analysis: a, classification: classifyMaxSize({ n: c.n, S: a.S, valid: stats.valid }), sq: flat(res.placements), W: c.W });
    await yieldNow();
  }
  post({ type: 'attemptsDone', cancelled: cancel });
}

async function scaling(m) {
  cancel = false;
  const { config: base } = normalizeConfig({ ...m.config, limits: { maxN: 5000 } });
  const meanArea = base.sizeMode === 'identical' ? base.sMax ** 2 : base.sizeMode === 'preset' ? base.presetSizes.reduce((a, s) => a + s * s, 0) / base.presetSizes.length : (base.sMin ** 2 + base.sMin * base.sMax + base.sMax ** 2) / 3;
  for (const n of m.ns) for (const id of m.algorithms) {
    if (cancel) break;
    const side = Math.sqrt((n * meanArea) / m.density);
    const { config: c } = normalizeConfig({ ...base, n, containerMode: 'square', W: side, algorithm: id, limits: { maxN: 5000 } });
    const inst = makeInstance(c), s = createSolver(id, inst, c);
    const compute = await runSolver(s, m.maxMs || 15000);
    const res = s.result(), stats = computeStats(inst, res.placements, compute, s.iteration ?? s.iter ?? 0);
    post({ type: 'scalingRow', n, id, stats, density: inst.totalArea / inst.containerArea });
    await yieldNow();
  }
  post({ type: 'scalingDone', cancelled: cancel });
}

/** Étude Circle→Square : compare les transformations sur LA MÊME instance. */
async function c2sStudy(m) {
  cancel = false;
  const { config: c } = normalizeConfig(m.config), inst = makeInstance(c);
  const variants = [
    { key: 'inscribed', label: 'Carré inscrit (λ=1)', c2s: { transform: 'inscribed' } },
    { key: 'circumscribed', label: 'Carré circonscrit (λ=0)', c2s: { transform: 'circumscribed' } },
    { key: 'optimized', label: `Intermédiaire + orientation (λ=${c.c2s.lambda.toFixed(2)})`, c2s: { transform: 'optimized' } },
    { key: 'search', label: 'Optimisé + recherche de λ', c2s: { transform: 'optimized', radiusSearch: true } },
  ];
  for (const v of variants) {
    if (cancel) break;
    const s = new CircleSquareSolver(inst, { ...c.c2s, ...v.c2s, iterations: c.iterations });
    post({ type: 'studyStart', key: v.key });
    const compute = await runSolver(s, m.maxMs || 30000);
    const res = s.result(), stats = computeStats(inst, res.placements, compute, s.iteration);
    const a = s.analysis;
    post({ type: 'studyRow', key: v.key, label: v.label, stats, classification: classify(inst, stats), analysis: a, sq: flat(res.placements), W: inst.W, H: inst.H });
    await yieldNow();
  }
  post({ type: 'studyDone', cancelled: cancel });
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.cmd) {
      case 'init': init(m.config); break;
      case 'play': if (!solver || finished) break; if (freeRun) { if (!running) { running = true; if (!timer) timer = setTimeout(freeTick, 0); } break; } running = true; if (m.speed !== undefined) speed = m.speed; lastTick = performance.now(); if (!timer) timer = setTimeout(tick, 0); break;
      case 'free': freeQuery(m); break;
      case 'pause': if (freeRun) break; running = false; clearTimeout(timer); timer = null; if (solver) snapshot(true); break;
      case 'step': if (freeRun) break; stepOnce(m.count || 1); break;
      case 'speed': speed = m.value; break;
      case 'params': if (solver) solver.setParams(m.params); break;
      case 'stop': if (solver && !finished) { if (solver.stop) solver.stop(); if (freeRun) { pushFrame(); flushFrames(true); } finish(); } break;
      case 'compare': compare(m); break;
      case 'attempts': attempts(m); break;
      case 'scaling': scaling(m); break;
      case 'c2sStudy': c2sStudy(m); break;
      case 'cancel': cancel = true; break;
      default: break;
    }
  } catch (err) { post({ type: 'error', message: String((err && err.stack) || err) }); }
};
