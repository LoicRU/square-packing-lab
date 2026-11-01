import { createRng } from './rng.js';
import { TOL } from './geometry.js';

/**
 * Génère l'instance (liste d'objets à placer) à partir d'une config normalisée.
 * Déterministe : (config, seed) → même instance.
 */
export function makeInstance(cfg) {
  const rng = createRng(cfg.seed);
  const items = [];
  for (let i = 0; i < cfg.n; i++) {
    let side;
    if (cfg.sizeMode === 'identical') side = cfg.sMax;
    else if (cfg.sizeMode === 'preset') side = cfg.presetSizes[i % cfg.presetSizes.length];
    else side = cfg.sMin + (cfg.sMax - cfg.sMin) * rng.next();
    items.push({ id: i, side: Math.round(side * 1e6) / 1e6 });
  }
  return buildInstance({ W: cfg.W, H: cfg.H, items, seed: cfg.seed, rotation: !!cfg.rotation, sizeMode: cfg.sizeMode });
}

/** Construit une instance à partir de données explicites (tests, import). */
export function buildInstance({ W, H, items, seed = 1, rotation = false, sizeMode = 'random' }) {
  const totalArea = items.reduce((a, it) => a + it.side * it.side, 0);
  const containerArea = W * H;
  const minDim = Math.min(W, H);
  const impossible = items.filter((it) => it.side > minDim + TOL).map((it) => it.id);
  const sizes = items.map((i) => i.side);
  return {
    W, H, items, n: items.length, seed, rotation, sizeMode, totalArea, containerArea, impossible,
    minSide: sizes.length ? Math.min(...sizes) : 0, maxSide: sizes.length ? Math.max(...sizes) : 0,
    areaExceeds: totalArea > containerArea + TOL,
    identical: sizes.length > 0 && sizes.every((s) => s === sizes[0]),
  };
}

/** Diagnostic de faisabilité lisible (configurations impossibles ou limites). */
export function diagnose(instance) {
  const notes = [];
  if (instance.n === 0) notes.push({ level: 'error', text: 'Aucun objet à placer.' });
  if (instance.impossible.length) notes.push({ level: 'error', text: `${instance.impossible.length} objet(s) plus grand(s) que le conteneur : placement impossible.` });
  if (instance.areaExceeds) notes.push({ level: 'info', text: `Surface totale des objets (${instance.totalArea.toFixed(2)}) > surface du conteneur (${instance.containerArea.toFixed(2)}) : tous les placer est impossible, l'objectif devient de maximiser la surface placée.` });
  if (instance.totalArea > 0.9 * instance.containerArea && !instance.areaExceeds) notes.push({ level: 'info', text: 'Densité requise > 90 % : très difficile en pratique.' });
  return notes;
}
