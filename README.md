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

## Rigueur

Une disposition est **valide** si aucune paire n'a de pénétration > 1e-9 (SAT exact, grille spatiale pour toutes les paires proches) et aucun carré ne dépasse. Statuts : *invalide* / *valide · heuristique* / *optimale prouvée* (seulement si tout est placé ou conteneur plein) ; « meilleure trouvée » = meilleur résultat de la session. Voir `docs/MATHS.md`.

## Structure

```
src/engine      maths pures (géométrie SAT, validation, config, stats, classification, export)
src/algorithms  7 solveurs + registre
src/worker      Web Worker (simulation hors thread UI)
src/render      Canvas 2D + graphiques
src/app         contrôleurs UI (simulateur, landing, learn)
tests           vitest
docs            ARCHITECTURE, MATHS, DEPLOY, RESEARCH
```

Déploiement : voir `docs/DEPLOY.md`.

## Contribuer

Les contributions sont bienvenues : ouvrez une issue pour un bug ou une idée, ou une pull request (merci de lancer `npm test` et `npm run build` avant). Voir `docs/ARCHITECTURE.md` pour s'orienter dans le code.

## Licence

[MIT](LICENSE) — libre d'utilisation, de modification et de redistribution.

## Parallel Packing Lab
Recherche parallèle et évolutive côté serveur (Elite Pool, bandits, reprise après redémarrage).

```bash
npm run build && PPL_TOKEN=secret npm run server   # http://127.0.0.1:8787/parallel.html
npm run dev                                        # front + proxy /api vers :8787
npm run bench:parallel
```
Node ≥ 22.5, aucune dépendance npm supplémentaire. Voir [docs/PARALLEL.md](docs/PARALLEL.md) et [docs/DEPLOY.md](docs/DEPLOY.md).
