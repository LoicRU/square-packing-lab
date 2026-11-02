/**
 * DÉTECTEUR DE RECORD : compare une solution aux meilleures valeurs connues (known.js) et la certifie plus strictement.
 * Certification = dilatation de 2e-9 (relative) puis revalidation par l'autorité avec une tolérance de 1e-12 : la
 * disposition dilatée est valide avec marge ; c'est CE côté dilaté qui est comparé au record connu.
 * Les références de known.js sont à 14 chiffres : « bat le record » si S certifié < référence − 1e-9 ; « égale » si l'écart est < 1e-7. Un record n'est jamais une preuve d'optimalité.
 */
import { judge } from '../parallel/authority.js';
import { knownSide } from './known.js';

export function certifyAgainstKnown(sol, n = sol.n ?? sol.x.length) {
  const ref = knownSide(n);
  const f = 1 + 2e-9, c = sol.S / 2, S2 = sol.S * f, c2 = S2 / 2;
  const D = { n, S: S2, x: Array.from(sol.x, (v) => c2 + (v - c) * f), y: Array.from(sol.y, (v) => c2 + (v - c) * f), th: Array.from(sol.th) };
  const certified = !!judge(D, { n, tol: 1e-12 }).ok;
  if (ref === null) return { n, ref: null, S: S2, certified, beats: false, ties: false };
  // Références à 14 chiffres (known.js) : tolérance de comparaison 1e-9 ; « égale » si l'écart reste < 1e-7 (dilatation 2e-9 comprise).
  const slack = 1e-9, near = 1e-7;
  return { n, ref, S: S2, certified, beats: certified && S2 < ref - slack, ties: certified && S2 >= ref - slack && S2 <= ref + near };
}
