# Square Packing Lab

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)](package.json)
[![Tests](https://img.shields.io/badge/tests-156%20passing-brightgreen)](tests)

> Interactive square packing simulator — 7 algorithms, Circle → Square transformation, exact SAT verification, reproducible benchmarks. 100% client-side, no backend, no tracking.

Plateforme web interactive (statique, sans backend) pour simuler le **Square Packing Problem** : placer le maximum de petits carrés dans un conteneur, avec 7 algorithmes, la transformation **Circle → Square**, une vérification exacte (SAT) et des comparaisons reproductibles.

## Fonctionnalités

- 7 algorithmes de packing réellement implémentés (MaxRects, Guillotine, Skyline, recuit simulé, répulsion/forces, étagères, Circle → Square), exécutés dans un Web Worker
- Pipeline Circle → Square en 5 phases observables, avec lecteur, retour arrière et trajectoires
- Vérification géométrique exacte (SAT) de chaque disposition : aucun résultat affiché n'est pris pour argent comptant sans contrôle indépendant
- Mode comparaison reproductible entre algorithmes, à graine fixée
- Export PNG / SVG / JSON du résultat courant
- Parallel Packing Lab : recherche parallèle persistante côté serveur (Elite Pool, bandits, reprise après redémarrage)
- 100 % statique côté simulateur : aucun backend requis, aucun tracking

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Aperçu](#aperçu)
- [Démarrage](#démarrage)
- [Problème principal : taille maximale](#problème-principal--taille-maximale)
- [Pipeline Circle → Square](#pipeline-circle--square-5-phases-observables)
- [Pages](#pages)
- [Algorithmes](#algorithmes)
- [Rigueur](#rigueur)
- [Structure](#structure)
- [FAQ](#faq)
- [Statut et limites connues](#statut-et-limites-connues)
- [Contribuer](#contribuer)
- [Licence](#licence)
- [Parallel Packing Lab](#parallel-packing-lab)

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

Sept méthodes, toutes vérifiées par le même validateur exact (SAT) ; aucune ne garantit l'optimalité sauf mention contraire.

| Algorithme | Rôle | Complexité | Points forts | Limites |
|---|---|---|---|---|
| **Circle → Square** | Pipeline par défaut : cercles → Circle Packing → transformation → Square Packing → optimisation | `O(it · n · k)` | Pédagogique, transformation observable, résultat final toujours valide | Souvent moins dense que les méthodes constructives sur instances denses |
| **MaxRects** | Suivi des rectangles libres maximaux | `O(n · F)` | Dispositions denses, déterministe, rapide jusqu'à 1000 carrés | Ne trouve pas les dispositions inclinées (ex. n = 5, 11, 17…) |
| **Guillotine** | Découpe récursive façon scie | `O(n · F)` | Structure simple, très rapide | Rectangles libres disjoints, moins flexible que MaxRects |
| **Skyline** | Profil de hauteur | `O(n · s)` (s = segments du profil) | Mémoire minimale, excellent sur conteneurs allongés | Ne réutilise pas les trous sous le profil |
| **Recuit simulé** | Optimisation stochastique des positions et angles | `O(it · n · k)` | Trouve des dispositions inclinées, paramètres réglables en direct | Stochastique, moins dense que les constructifs à grand n |
| **Répulsion / forces** | Relaxation physique entre carrés | `O(it · n · k)` | Convergence plus régulière que le recuit, sert de relaxeur au pipeline | Peut rester bloqué dans un minimum local |
| **Étagères** *(référence)* | First-fit decreasing : tri puis rangées | `O(n log n)` | Très simple, sert de borne de comparaison | Densité limitée, ne réoptimise jamais |

Notations : `n` = nombre de carrés, `F` = nombre de rectangles libres, `it` = itérations, `k` = voisins par objet (grille spatiale). Détails complets : [`/algorithms.html`](algorithms.html).

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

## FAQ

**Le résultat affiché est-il optimal ?**
Non, sauf mention explicite « optimale prouvée » (N = k², ou valeur s(n) démontrée dans la littérature). Sinon c'est la meilleure solution heuristique trouvée dans la session.

**Mes données sont-elles envoyées quelque part ?**
Non pour le simulateur : tout tourne côté client, sans backend ni tracking. Le Parallel Packing Lab est une brique serveur optionnelle et séparée.

**Pourquoi deux exécutions donnent-elles des résultats différents ?**
Les méthodes stochastiques (recuit, forces) dépendent de la graine aléatoire. Le mode « Comparaison » fixe la graine pour des résultats reproductibles.

**Combien de carrés le simulateur supporte-t-il ?**
Testé jusqu'à 1000 carrés (voir `npm run bench`) ; l'interface peut ralentir au-delà de quelques milliers selon l'appareil.

## Statut et limites connues

Les méthodes constructives n'explorent pas les inclinaisons libres ; les méthodes continues sont heuristiques et limitées en densité ; au-delà de quelques milliers de carrés, l'interface peut ralentir selon l'appareil. Les temps de calcul affichés dépendent de votre machine. Détails : [`/about.html`](about.html).

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
