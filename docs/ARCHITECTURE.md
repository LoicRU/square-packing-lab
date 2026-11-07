# Architecture

## Couches (dépendances dans un seul sens)
`engine` ← `algorithms` ← `worker` ← `app/client` ← `app/simulator` → `render`.

- **engine** : fonctions pures, sans DOM. `geometry.js` (SAT, demi-étendue, excès conteneur), `validate.js` (validateur de référence), `config.js` (normalisation, jamais d'exception), `instance.js`, `stats.js`, `classify.js`, `known.js` (s(n) de la littérature), `export.js`.
- **algorithms** : interface commune `step() / done / view() / result()`. `ConstructiveSolver` (MaxRects, Guillotine, Skyline, Shelf), `ContinuousSolver` (recuit, forces), `CircleSquareSolver` (pipeline). Ajouter un algorithme = une entrée dans `registry.js`.
- **worker** : protocole `init, play, pause, step, speed, params, stop, compare, scaling, c2sStudy, cancel` → `ready, snapshot, done, compareRow, scalingRow, studyRow, error`. Les snapshots (≤ 30 Hz) transfèrent des `Float64Array` (stride 6 pour les carrés, 4 pour les cercles).
- **render** : `SceneRenderer` (Canvas 2D, rendu à la demande, zoom/pan/pinch, grille adaptative) et `LineChart`.
- **app** : `client.js` (API du worker), `simulator.js` (formulaire, contrôles, stats, comparaison, expériences, export).

## Vitesse de simulation
Exprimée en *étapes d'algorithme par seconde* (base : 40 constructif, 90 continu, × multiplicateur, ∞ = instantané), donc indépendante de la vitesse réelle de calcul : si le CPU est trop lent, le worker travaille à pleine charge ; sinon il attend.

## Fiabilité
- Le worker calcule ; l'interface **re-valide** la disposition finale (SAT) avant d'afficher « valide ».
- Les résultats continus sont toujours le dernier état sans chevauchement.
- Erreurs worker/fenêtre → bandeau d'erreur, état remis à « prêt ».
- Reproductibilité : PRNG mulberry32 + graine ; configuration partageable par URL (`#c=`).

## Problème « taille maximale »
`MaxSizeSolver` (`src/algorithms/maxsize.js`) suit l'interface commune (`step/done/view/result/stop`). Le worker le choisit quand `config.problem === 'maxsize'` (défaut) ; commande supplémentaire `attempts` (tentatives multiples : stratégies × graines) → `attemptRow`. Classification : `classifyMaxSize` (engine/classify.js). `view().extra` transporte cible, énergie, collisions de la tentative en cours ; la meilleure solution a toujours 0 collision.


## Parallel Packing Lab
Section indépendante (`parallel.html`, `src/parallel/`, `server/`) réutilisant `src/algorithms` et `src/geometry`. Détails : [PARALLEL.md](PARALLEL.md).
