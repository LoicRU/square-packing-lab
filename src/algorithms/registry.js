import { ShelfSolver } from './shelf.js';
import { MaxRectsSolver } from './maxrects.js';
import { GuillotineSolver } from './guillotine.js';
import { SkylineSolver } from './skyline.js';
import { ContinuousSolver } from './continuous.js';
import { CircleSquareSolver } from './circlesquare.js';
import { makeInstance } from '../engine/instance.js';
import { computeStats } from '../engine/stats.js';
import { classify, literatureNote } from '../engine/classify.js';

/** Initialisation optionnelle d'un solveur continu par une disposition MaxRects (puis insertion des objets restants). */
function continuousInit(inst, cfg, relaxer, key) {
  const opt = cfg.options[key] || {};
  let initial;
  if (opt.init === 'maxrects') {
    const m = new MaxRectsSolver(inst, { heuristic: 'bssf' });
    while (!m.done) m.step();
    initial = m.result().placements.map((p) => ({ id: p.id, x: p.x, y: p.y, theta: 0 }));
  }
  return new ContinuousSolver(inst, { relaxer, iterations: cfg.iterations, params: opt, rotation: cfg.rotation, initial, label: relaxer === 'anneal' ? 'Recuit simulé' : 'Répulsion / forces' });
}

/** Catalogue des algorithmes (métadonnées + fabrique). Ajouter une méthode = une entrée ici. */
export const ALGORITHMS = {
  circle2square: {
    name: 'Circle → Square', family: 'Expérimental', kind: 'hybride', rotation: 'libre', complexity: 'O(it · n · k)',
    summary: 'Pack des disques, les transforme en carrés, vérifie exactement les collisions et ré-optimise.',
    create: (inst, cfg) => new CircleSquareSolver(inst, { ...cfg.c2s, iterations: cfg.iterations }),
  },
  maxrects: {
    name: 'MaxRects', family: 'Constructif', kind: 'constructif', rotation: 'aucune (axes)', complexity: 'O(n · F)',
    summary: 'Rectangles libres maximaux ; meilleure heuristique de la bibliothèque de Jylänki.',
    create: (inst, cfg) => new MaxRectsSolver(inst, cfg.options.maxrects),
  },
  guillotine: {
    name: 'Guillotine', family: 'Constructif', kind: 'constructif', rotation: 'aucune (axes)', complexity: 'O(n · F)',
    summary: 'Découpes bord à bord : chaque placement partage un rectangle libre en deux.',
    create: (inst, cfg) => new GuillotineSolver(inst, cfg.options.guillotine),
  },
  skyline: {
    name: 'Skyline', family: 'Constructif', kind: 'constructif', rotation: 'aucune (axes)', complexity: 'O(n · s)',
    summary: 'Ligne d\'horizon en escalier ; pose au point le plus bas.',
    create: (inst, cfg) => new SkylineSolver(inst, cfg.options.skyline),
  },
  anneal: {
    name: 'Recuit simulé', family: 'Continu', kind: 'continu', rotation: 'libre (option)', complexity: 'O(it · n · k)',
    summary: 'Déplacements aléatoires acceptés selon Metropolis ; insertion progressive des objets.',
    create: (inst, cfg) => continuousInit(inst, cfg, 'anneal', 'anneal'),
  },
  forces: {
    name: 'Répulsion / forces', family: 'Continu', kind: 'continu', rotation: 'libre (option)', complexity: 'O(it · n · k)',
    summary: 'Les carrés en chevauchement se repoussent (forces SAT) ; bruit décroissant ; insertion progressive.',
    create: (inst, cfg) => continuousInit(inst, cfg, 'forces', 'forces'),
  },
  shelf: {
    name: 'Référence : étagères', family: 'Référence', kind: 'constructif', rotation: 'aucune (axes)', complexity: 'O(n · e)',
    summary: 'First-Fit Decreasing Shelf : rangées de gauche à droite. Point de comparaison simple.',
    create: (inst, cfg) => new ShelfSolver(inst, cfg.options.shelf),
  },
};

export const createSolver = (id, instance, cfg) => ALGORITHMS[id].create(instance, cfg);

/** Exécute un solveur jusqu'au bout (ou jusqu'à maxMs). */
export function runToEnd(solver, { maxMs = Infinity, onStep } = {}) {
  const t0 = performance.now(); let compute = 0;
  while (!solver.done) {
    const s = performance.now();
    solver.step(); compute += performance.now() - s;
    if (onStep) onStep(solver);
    if (performance.now() - t0 > maxMs) break;
  }
  return compute;
}

/** Résolution complète et vérifiée (sans interface) : utilisée par les tests, le banc d'essai et la comparaison. */
export function solveHeadless(config, { algorithm = config.algorithm, maxMs = Infinity, instance } = {}) {
  const inst = instance || makeInstance(config);
  const solver = createSolver(algorithm, inst, config);
  const compute = runToEnd(solver, { maxMs });
  const res = solver.result();
  const t1 = performance.now();
  const stats = computeStats(inst, res.placements, compute, solver.iteration ?? solver.iter ?? 0);
  const classification = classify(inst, stats);
  return { instance: inst, solver, result: res, stats, classification, literature: literatureNote(inst, stats), verifyMs: performance.now() - t1, algorithm };
}
