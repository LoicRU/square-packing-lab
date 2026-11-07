# Pipeline Circle Packing → Square Packing (5 phases)

Le pipeline (`src/algorithms/pipeline.js`) est la stratégie par défaut du simulateur. Chaque image affichée est un **état réel** du calcul : aucune animation n'est rejouée artificiellement.

| # | Phase | Ce qui est réellement calculé | Module |
|---|-------|-------------------------------|--------|
| 1 | Génération | N cercles de diamètre 1 tirés au hasard dans ⌈√N⌉² (ils se chevauchent), révélés progressivement | `pipeline.js` |
| 2 | Circle Packing | *formation* (recuit + projection : plus aucun chevauchement) puis *optimisation* (dichotomie sur le côté S, recuit sur les positions, projection exacte, certification par distances) | `circlepack.js` |
| 3 | Transformation | chaque cercle → carré inscrit (même centre, orientation alignée sur le plus proche voisin, modulo 90°), puis agrandissement ×√2 pour obtenir des carrés de côté commun 1. Validé par `validateLayout`. | `pipeline.js` |
| 4 | Square Packing | `MaxSizeSolver` depuis la disposition transformée : dichotomie biaisée, recuit sur positions **et** angles, mouvements de groupe (translation/rotation rigide de ≤ 7 voisins), relocalisation du carré le plus contraint par No-Fit Polygon | `maxsize.js`, `nfp.js` |
| 5 | Optimisation finale | pool de solutions valides : meilleure solution de la phase 4, réseau k×k (adopté s'il est meilleur), perturbations contrôlées (≈12 % des carrés relancés), second départ indépendant | `maxsize.js` |

## Honnêteté sur la transformation
Un carré inscrit dans un cercle de diamètre 1 a pour côté 1/√2. Après agrandissement, S = √2·S_cercles, soit un remplissage ≤ ≈ 0,907/2 ≈ 45 % : **la transformation seule est moins bonne que le réseau k×k**. C'est un résultat de la méthode, affiché tel quel dans le tableau « Statistiques par phase » ; l'amélioration vient des phases 4 et 5.

## Calcul libre / lecture
Le worker calcule à pleine vitesse (pas de ralentissement artificiel) et enregistre des **images clés** déclenchées par l'avancement algorithmique (apparition de cercles, étapes de transformation, tous les ≈ total/260 balayages, nouvelle meilleure solution, adoption du pool). La vitesse du curseur ne règle que la **lecture** (×0,25 … ∞). L'interface propose : timeline 5 phases cliquable, défilement, image précédente/suivante (← →), mode « Direct », rejeu sans recalcul.

## Zones libres (No-Fit Polygon)
Pour un carré fixe B et un carré mobile A d'angle θ, les positions de centre de A qui le font chevaucher B forment l'intérieur de la somme de Minkowski B ⊕ A (≤ 8 sommets). La région libre = rectangle des centres admissibles privé de l'union de ces intérieurs ; elle contient un sommet candidat (coins, sommets de NFP, intersections arête/arête et arête/bord), ce qui rend la décision *exacte* (`src/engine/nfp.js`, test contre le SAT sur 20 000 points). « Zones libres » affiche les points d'insertion (θ = 0) et le plus grand carré insérable parmi les angles testés (0, π/8, π/4, 3π/8 — « plus grand » est relatif à ces angles).

## Validation
Deux méthodes indépendantes : `validateLayout` (SAT + grille) et `verifyIndependent` (`src/engine/verify.js` : aire d'intersection de polygones par découpage de Sutherland–Hodgman, sommets dans le conteneur, côtés égaux, angles ∈ [0°, 90°)). Toute solution acceptée est certifiée ; le résultat final est revérifié dans le worker puis dans l'interface.

## Mesures (graine 1, conteneur 20, `node scripts/bench-pipeline.mjs`)
| N | S | a = W/S | remplissage | référence | 
|---|---|---------|-------------|-----------|
| 17 | ≈ 4,708 | ≈ 4,248 | ≈ 76,7 % | s(17) ≈ 4,6756 (meilleur connu, non prouvé) → écart ≈ +0,7 % |
| 25 | 5,000 | 4,000 | 100 % | optimum démontré (carré parfait) |
| 50 | ≈ 7,84 | ≈ 2,55 | ≈ 81,3 % | aucune référence fiable utilisée |
| 100 | 10,000 | 2,000 | 100 % | optimum démontré (carré parfait) |

Convention : N carrés de côté 1 dans un carré de côté S, donc s(N) de la littérature = S ici et a = W/S. Le cas 17 ne descend pas sous ≈ 4,708 : la meilleure disposition connue (4,6756) a une structure très particulière que la recherche n'a pas retrouvée ; **aucun optimum n'est affirmé**. Même au meilleur connu, 17 carrés laissent ≈ 22 % d'espace inutilisé.
Remarque : à budget égal, la stratégie « Complet » (sans phases 1-3) atteint environ 7,72 pour N = 50 ; le pipeline est conçu pour l'observation, pas pour la performance pure.
