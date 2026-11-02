/**
 * MISE À JOUR (nov. 2026) d'après la page « Squares in Squares » (Erich Friedman's Packing Center, miroir
 * https://kingbird.myphotos.cc/packing/squares_in_squares.html), valeurs à 14 chiffres : N=28 (D. Ellsworth, déc. 2025),
 * N=29 (T. Schadt, déc. 2025, optimisé par D. Ellsworth), N=39 (T. Schadt, janv. 2026), N=11, 17, 37 (valeurs exactes des
 * packings de Trump 1979, Bidwell 1998, Cantrell 2002). Anciennes valeurs (survey 2005, 4 décimales) : 11→3,8771, 17→4,6756,
 * 28→3+2√2, 29→5,9344, 37→6,5987, 39→6,8189. Valeurs non re-vérifiées par calcul indépendant : elles viennent de cette page.
 *
 * Meilleures valeurs connues s(n) du côté du plus petit carré contenant n carrés
 * unité (Friedman, « Packing Unit Squares in Squares », Electronic J. Combin.,
 * Dynamic Survey DS7). Valeurs optimales PROUVÉES uniquement pour n listés dans
 * PROVEN ; les autres sont des meilleures solutions connues, pas des optimums.
 */
const R2 = Math.SQRT2;
export const BEST = {
  1: 1, 2: 2, 3: 2, 4: 2, 5: 2 + 1 / R2, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3 + 1 / R2, 11: 3.87708359002281, 12: 4, 13: 4,
  14: 4, 15: 4, 16: 4, 17: 4.67553009360455, 18: (7 + Math.sqrt(7)) / 2, 19: 3 + (4 * R2) / 3, 20: 5, 21: 5, 22: 5,
  23: 5, 24: 5, 25: 5, 26: 3.5 + 1.5 * R2, 27: 5 + 1 / R2, 28: 5.82444461667405, 29: 5.93383346267692, 30: 6, 31: 6, 32: 6,
  33: 6, 34: 6, 35: 6, 36: 6, 37: 6.59861960924436, 38: 6 + 1 / R2, 39: 6.81072208306864, 40: 4 + 2 * R2,
};
/** Au-delà de 40 (même page) : 41 (T. Schadt, déc. 2025), 46–48 (prouvés : Bentz 2009, Nagamochi 2005), 50 = 7 + 4/7 (T. Schadt, déc. 2025). */
export const BEST_EXTRA = { 41: 6.9266930944688, 46: 7, 47: 7, 48: 7, 50: 7 + 4 / 7 };
export const PROVEN = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 16, 23, 24, 25, 34, 35, 36, 46, 47, 48]);
export const isProven = (n) => PROVEN.has(n);
export const knownSide = (n) => BEST[n] ?? BEST_EXTRA[n] ?? null;

/**
 * Plus grand N (≤ 40) tel que la meilleure valeur connue s(N) ≤ x.
 * C'est une borne INFÉRIEURE de ce qui est réalisable (pas un maximum prouvé).
 */
export function maxKnownCount(x) {
  let best = Math.floor(x + 1e-9) ** 2;
  for (const k of Object.keys(BEST)) if (BEST[k] <= x + 1e-9 && +k > best) best = +k;
  return best;
}
