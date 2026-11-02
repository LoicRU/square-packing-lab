import { validateLayout } from './validate.js';

/**
 * Statistiques calculées UNIQUEMENT à partir des données réelles du moteur
 * (validation exacte de la disposition). Rien n'est estimé.
 */
export function computeStats(instance, placements, elapsedMs = 0, iterations = 0) {
  const v = validateLayout(placements, instance.W, instance.H);
  const placedValid = v.n - v.nBad;
  const cArea = instance.containerArea;
  return {
    requested: instance.n,
    placed: placedValid,
    unplaced: instance.n - placedValid,
    itemsArea: instance.totalArea,
    placedArea: v.validArea,
    containerArea: cArea,
    fill: cArea > 0 ? v.validArea / cArea : 0,
    wasted: cArea > 0 ? 1 - v.validArea / cArea : 1,
    collisions: v.pairs.length,
    outOfBounds: v.oob.length,
    valid: v.valid,
    maxPenetration: v.maxPenetration,
    elapsedMs, iterations,
  };
}
