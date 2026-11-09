# Square Packing Lab

> Interactive square packing simulator — 7 algorithms, Circle → Square transformation, exact SAT verification, reproducible benchmarks. 100% client-side, no backend, no tracking.

Plateforme web interactive (statique, sans backend) pour simuler le **Square Packing Problem** : placer le maximum de petits carrés dans un conteneur, avec 7 algorithmes, la transformation **Circle → Square**, une vérification exacte (SAT) et des comparaisons reproductibles.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 156 tests (moteur, algorithmes, performance)
npm run build      # site statique dans dist/
npm run preview    # sert dist/ sur :4173
npm run e2e        # test de fumée Playwright (nécessite preview + playwright)
npm run bench      # banc de perf headless n = 10 / 100 / 500 / 1000
```

## Problème principal : taille maximale
N carrés **identiques**, rotation libre 0–90°, tous placés : le simulateur cherche le plus grand côté commun (dichotomie sur la taille + recuit sur positions et angles + compression + projection exacte). Statuts : *invalide* / *valide · meilleure solution heuristique* / *optimale prouvée* (uniquement si N = k², ou valeur s(n) démontrée dans la littérature). L'ancien packing général reste disponible via « Packing général ».

## Pipeline Circle → Square (5 phases observables)
Stratégie par défaut : génération, Circle Packing, transformation, Square Packing, optimisation finale — lecteur avec timeline, retour arrière, trajectoires, zones libres (No-Fit Polygon), statistiques par phase, vérification indépendante. Détails et mesures : [docs/PIPELINE.md](docs/PIPELINE.md). Banc d'essai : `node scripts/bench-pipeline.mjs`.

## Pages

| Page | Rôle |
|---|---|
| `/` | Présentation, animation du moteur |
| `/simulator.html` | Simulateur complet |
| `/algorithms.html` | Principe, complexité, limites des 7 algorithmes |
| `/learn.html` | Le problème, valeurs connues s(n), limites de Circle → Square |
| `/about.html` | Rigueur, architecture, confidentialité, licence |

## Algorithmes

Circle → Square · MaxRects · Guillotine · Skyline · Recuit simulé · Répulsion/forces · Étagères (référence).
