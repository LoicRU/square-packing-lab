# Formules utilisées

Conteneur : carré `[0, S]²`. Un carré est `(x, y, side, θ)`.

## Carré

- Rayon du cercle circonscrit : `R = side / √2`.
- Sommets : centre `± (side/2)` dans le repère tourné de `θ`.
- Demi-étendue de la boîte alignée sur les axes : `h = (side/2)(|cos θ| + |sin θ|)`.
- Dans le conteneur ⇔ `h ≤ x ≤ S − h` et `h ≤ y ≤ S − h` (condition exacte).

## Non-chevauchement

- **Rejet rapide (suffisant) :** si `‖cᵢ − cⱼ‖ ≥ (sideᵢ + sideⱼ)/√2`, les carrés sont disjoints, quelle que soit leur rotation.
- **Test exact (SAT) :** deux carrés sont disjoints ⇔ il existe un axe séparateur parmi les 4 axes (2 par carré). Sur l'axe `d`, le rayon de projection d'un carré de demi-côté `h` est `r = h(|d·u₁| + |d·u₂|)` avec `u₁ = (cos θ, sin θ)`, `u₂ = (−sin θ, cos θ)`. Recouvrement sur `d` = `rA + rB − |(cB − cA)·d|`. La pénétration est le minimum sur les 4 axes (0 si un axe sépare).
- **Alignés (cas particulier) :** `|dx| ≥ (aᵢ+aⱼ)/2` ou `|dy| ≥ (aᵢ+aⱼ)/2`.

## Validité (validateur)

Une disposition est **valide** si toutes les pénétrations ≤ `tol` (1e-9 par défaut) et tous les dépassements du conteneur ≤ `tol`. Toutes les paires proches sont testées (grille uniforme + SAT), aucune par échantillonnage. La tolérance est un paramètre explicite : c'est une validation en virgule flottante avec marge, pas une preuve exacte.

## Cercle → carré (implémenté : `src/algorithms/circlesquare.js`)

Pour un cercle de rayon `r` :

| Transformation | Côté | Aire | Garantie |
|---|---|---|---|
| Inscrit | `r√2` | `2r²` = `(2/π)·πr²` | non-chevauchement garanti (carré ⊂ disque) |
| Circonscrit | `2r` | `4r²` = `(4/π)·πr²` | non garanti (chevauchements possibles en diagonale) |
| Intermédiaire | `a ∈ [r√2, 2r]` | `a²` | à vérifier avec le SAT, réparation par réduction d'échelle |

Borne de densité de la route « inscrit » : `(2/π) · π/(2√3) ≈ 0,577`.

## Références

- E. Friedman, *Packing Unit Squares in Squares*, Electronic Journal of Combinatorics (survey dynamique) : valeurs de `s(n)`.
- Erdős & Graham (1975), Chung & Graham (2020) : espace perdu en `O(s^{3/5})` pour de grands conteneurs.
- Roth & Vaughan (1978) : borne inférieure de l'espace perdu.

## Conteneur rectangulaire W × H

Excès conteneur : `max(0, h − x, x + h − W, h − y, y + h − H)` avec `h` la demi-étendue ; le reste est inchangé.

## Problème « taille maximale » (`src/algorithms/maxsize.js`)

- Normalisation : carrés unité, conteneur S × S ; côté réel a = W/S ; remplissage N/S².
- Bornes : S ≥ √N (aire, prouvé) ; S ≤ ⌈√N⌉ (réseau, valide).
- Énergie de faisabilité : E = Σ_{i<j} p_ij² + Σ_i e_i², p_ij = pénétration SAT, e_i = débordement hors du conteneur.
- Acceptation d'une cible t : pénétration nulle à côté (1 + 2·10⁻⁵), puis `validateLayout` exact à côté 1.
- Une cible non atteinte n'est JAMAIS une preuve d'impossibilité. L'optimalité n'est annoncée que si N = k² (borne d'aire) ou si s(N) est démontré optimal dans la littérature (Friedman) et que S l'égale à 5·10⁻⁴ près.
- Mesures de référence (budget auto, graine 1) : N = 5 → +0,01 % vs s(5) ; N = 10 → +0,01 % ; N = 11 → +0,3 à +0,9 % ; N = 17 → +0,7 % ; N = 19 → bloqué sur 5×5 (+2,3 %). Résultats dépendants de la graine.
