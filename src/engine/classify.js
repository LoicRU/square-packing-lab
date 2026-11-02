import { TOL } from './geometry.js';
import { maxKnownCount, isProven, BEST } from './known.js';

/**
 * Classe un résultat. On ne prétend JAMAIS à l'optimalité sans preuve :
 *  - 'invalid'   : au moins une collision / sortie (jamais présenté comme solution)
 *  - 'optimal'   : optimalité PROUVÉE par une borne triviale (tout est placé,
 *                  ou le conteneur est entièrement rempli)
 *  - 'valid'     : valide, produit par une heuristique, optimalité non prouvée
 * `bestFound` est géré par l'appelant (meilleure solution de la session).
 */
export function classify(instance, stats) {
  if (!stats.valid) return { status: 'invalid', label: 'Invalide', detail: `${stats.collisions} collision(s), ${stats.outOfBounds} sortie(s) du conteneur.` };
  if (stats.unplaced === 0 && instance.n > 0) return { status: 'optimal', label: 'Optimale prouvée', detail: 'Tous les objets sont placés : aucune solution ne peut faire mieux.' };
  if (stats.placedArea >= instance.containerArea - TOL) return { status: 'optimal', label: 'Optimale prouvée', detail: 'Conteneur rempli à 100 % : borne de surface atteinte.' };
  return { status: 'valid', label: 'Valide · heuristique', detail: 'Disposition exacte vérifiée ; optimalité non prouvée (approximation).' };
}

/**
 * Comparaison avec la littérature pour n carrés identiques dans un carré :
 * renvoie ce que l'on sait de s(n), en distinguant prouvé / meilleur connu.
 */
export function literatureNote(instance, stats) {
  if (!instance.identical || instance.W !== instance.H || instance.n === 0) return null;
  const x = instance.W / instance.items[0].side;
  const known = maxKnownCount(x);
  const n = stats.placed;
  const sBest = BEST[n];
  return {
    ratio: x, knownCount: known, obtained: n,
    text: `Côté normalisé s/a = ${x.toFixed(4)} : meilleure disposition connue = ${known} carrés${known > 40 ? ' (borne de grille)' : ''}. ` +
      (sBest ? `Pour n=${n}, s(n) ${isProven(n) ? 'optimal prouvé' : 'meilleur connu'} = ${sBest.toFixed(4)}.` : ''),
  };
}

/**
 * Classement pour le problème « taille maximale » (N carrés identiques, tous placés).
 * Ici « tout est placé » est une CONTRAINTE, pas une preuve d'optimalité.
 *  - 'invalid' : collision / sortie.
 *  - 'optimal' : uniquement si S atteint une borne démontrée : N = k² (borne de surface S ≥ √N)
 *                ou valeur s(n) PROUVÉE dans la littérature (à la tolérance numérique près).
 *  - 'valid'   : disposition exacte vérifiée, meilleure solution heuristique trouvée, optimalité non prouvée.
 */
export function classifyMaxSize({ n, S, valid, tol = 5e-4 }) {
  if (!valid) return { status: 'invalid', label: 'Invalide', detail: 'Collision ou sortie du conteneur : jamais présentée comme une solution.' };
  const r = Math.sqrt(n);
  if (Number.isInteger(r) && Math.abs(S - r) < 1e-9) return { status: 'optimal', label: 'Optimale prouvée', detail: `N = ${r}² : borne de surface S ≥ √N atteinte par le réseau ${r} × ${r}.` };
  const known = BEST[n];
  if (known && isProven(n) && S <= known * (1 + tol)) return { status: 'optimal', label: 'Optimale (prouvée dans la littérature)', detail: `S = ${S.toFixed(4)} coïncide, à la tolérance numérique près, avec la valeur s(${n}) = ${known.toFixed(4)} démontrée optimale (Friedman). La preuve vient de la littérature, pas de ce programme.` };
  return { status: 'valid', label: 'Valide · meilleure solution heuristique', detail: 'Disposition exacte vérifiée (aucune collision). Optimalité globale non prouvée : une meilleure disposition peut exister.' };
}

/** Comparaison au meilleur connu s(n) (n ≤ 40) : informatif, jamais utilisé pour prétendre à l'optimalité. */
export function maxSizeLiterature(n, S) {
  const known = BEST[n];
  if (!known) return null;
  const gap = (S / known - 1) * 100, proven = isProven(n);
  return { known, proven, gapPct: gap, text: `Référence : s(${n}) ${proven ? '= ' + known.toFixed(4) + ' (optimum démontré)' : '≈ ' + known.toFixed(4) + ' (meilleur connu, non prouvé optimal)'} ; votre S = ${S.toFixed(4)} (${gap >= 0 ? '+' : ''}${gap.toFixed(2)} %).${gap < -0.01 ? ' Valeur inférieure à la référence : à vérifier (tolérance numérique).' : ''}` };
}
