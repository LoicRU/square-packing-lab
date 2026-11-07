# Parallel Packing Lab

Moteur d'optimisation parallèle, évolutif et adaptatif pour le packing de N carrés unité dans un carré. Section indépendante (`parallel.html`) ; le simulateur classique reste inchangé et partage le moteur géométrique (`src/algorithms`, `src/geometry`).

## Architecture

```
Navigateur (parallel.html, src/app/parallel.js)        pas de calcul géométrique : affichage seul
      │  HTTP JSON + SSE (token)
Serveur Node (server/index.js)  ── SearchManager ── SqliteStore (WAL)
      │                              │
      │                       Coordinator (1 par recherche)
      │                         ├ ElitePool (autorité de validation = seul accès)
      │                         ├ Bandits (origines, stratégies, amplitudes)
      │                         ├ Governor (nombre de workers adaptatif)
      │                         └ slots (simulations)  ⇄  worker_threads (task.js / workerCore.js)
```

- **Authority** (`src/parallel/authority.js`) : `judge()` normalise, vérifie N, finitude, S ≥ √N, `validateLayout` (SAT + grille) **et** `verifyIndependent` (aires de polygones, Sutherland–Hodgman). Aucune solution n'entre dans l'Elite Pool, ni n'est affichée ou persistée comme valide, sans passer par elle. Une S annoncée incohérente (> 1e-6 relatif) est rejetée.
- **Elite Pool** (`elite.js`) : catégories record / elite (20) / diverse (20) / historical (150). Le record n'est jamais évincé. Dédoublonnage par symétries D4 (`canonical.js`, seuil 0,06) ; même géométrie → remplacement seulement si S strictement meilleure.
- **Évolution** (`evolve.js`) : mutations move-one, rotate-one, move-several, rotate-coordinated, local-reorg, region, partial-reset, multi ; recombinaison (parent B aligné D4, coupe aléatoire, correction du compte). Tout enfant est réparé puis compressé par `MaxSizeSolver` (`seedLayout`), puis jugé.
- **Allocation adaptative** (`bandit.js`) : origines best/diverse/recomb/random avec priors 30/30/20/20 estompés par l'expérience (EMA + UCB + softmax, plancher d'exploration 8 %) ; stratégies direct / anneal / circle (plancher 7 %) ; amplitudes small/medium/large. Circle→Square n'est qu'une stratégie expérimentale parmi les autres, allouée par le bandit.
- **Governor** (`governor.js`) : cible = min(cœurs − 1 si ≥ 4 cœurs, mémoire libre×0,6/120 Mo, plafond manuel, plafond serveur, 64). Hystérésis ±1/tick ; réduction si charge/cœur > 1,15, retard de boucle > 200 ms ou cycle moyen > 2,5× son budget.
- **Coordinator** (`coordinator.js`) : états de slot init/waiting/running/submitting/done/restarting/error/suspended ; watchdog max(30 s, 3× cycle) ; échec worker → redémarrage avec backoff, ≥ 5 erreurs consécutives → slot en erreur sans toucher les autres.

## Protocole worker
coordinateur → worker : `task{taskId,spec,knownS}`, `known`, `stop`, `suspend`, `resume`, `watch`, `ping`.
worker → coordinateur : `ready, started, progress (≤2/s), improve (≤1/400 ms, seulement si meilleur que le record connu), preview (~1/1,5 s), snapshot (4 Hz si observé), result, error, pong`.

## Modèle de données (SQLite, `server/store.js`)
```sql
searches(id PK, params JSON, status, created_at, updated_at, search_ms)
solutions(search_id, id, s, category, meta JSON, data BLOB(gzip), archived, found_at, PK(search_id,id))
history(search_id, t, wall, s, fill, slot, strategy, sid)      -- courbes du record
checkpoints(search_id PK, data BLOB(gzip), saved_at)           -- pool, bandits, slots, compteurs
```
Solution : `{n, S, x[], y[], th[]}` (carrés unité, conteneur S×S, angles dans [0, π/2)). Taille réelle s = L/S ; remplissage = N/S².

## API (préfixe `/api`, token Bearer ou `?token=`)
`GET /health` · `GET/POST /searches` · `GET/DELETE /searches/:id` · `POST …/start|pause|resume|stop` · `PATCH …/params` (maxWorkers, cycleMs, effort, strategies, mode ; sims ne peut qu'augmenter) · `POST …/watch` · `GET/POST …/solutions` (POST = import, 422 si invalide) · `GET …/solutions/:sid` · `GET …/history` · `GET …/events` (SSE : `state` complet à la (re)connexion, rattrapage `Last-Event-ID`, `summary` toutes les secondes).

## Configuration (variables d'environnement)
| Variable | Défaut | Rôle |
|---|---|---|
| `PPL_HOST` / `PPL_PORT` | 127.0.0.1 / 8787 | écoute |
| `PPL_TOKEN` | — | obligatoire hors localhost |
| `PPL_DB` | data/ppl.sqlite | base |
| `PPL_MAX_WORKERS` / `PPL_MAX_RUNNING` / `PPL_WORKER_MB` | auto | plafonds serveur |
| `PPL_ORIGIN` | — | CORS si front séparé |
| `PPL_STATIC` | dist | front servi |
| `PPL_AUTORESUME` | 1 | reprise au démarrage |
| `PPL_TRUST_PROXY` | 0 | 1 derrière un proxy de confiance (limite de débit par `X-Forwarded-For`) |
| `PPL_HOSTS` | — | noms d'hôte acceptés en plus de localhost (anti DNS-rebinding) |
| `PPL_HSTS` | 0 | 1 pour émettre `Strict-Transport-Security` |

Côté navigateur : `localStorage['ppl.api']` pour pointer vers un back distant ; le token est gardé en `sessionStorage`.

## Persistance et reprise
Checkpoints toutes les 30 s (+ pause/stop). Au redémarrage, `recover()` recharge chaque checkpoint et **re-valide toutes les solutions** par l'autorité (une ligne falsifiée est rejetée). **La reprise est approximative** : le pool, les bandits, les compteurs et le record sont restaurés ; la température du recuit, l'état du PRNG et les cycles en cours ne le sont pas (les cycles interrompus sont relancés).

## Sécurité
Audit global (novembre 2026) : un site tiers visité dans le navigateur pouvait, sans jeton (mode localhost), envoyer des POST « simples » vers le serveur local (CSRF / DNS rebinding). Corrigé : refus des `Origin` étrangères et de `Sec-Fetch-Site: cross-site`, `Content-Type: application/json` obligatoire pour les écritures, contrôle du `Host` sur écoute locale, en-têtes CSP / `X-Frame-Options` / `nosniff` sur toutes les réponses, jeton en query limité au flux SSE, freinage des tentatives de jeton erronées (20/min/IP). Tests : `tests/server.test.js`.

Validation 100 % côté serveur ; N ≤ 2000, sims, workers, taille de corps (2 Mo, 4 Mo import) bornés ; limite de débit 400 req/10 s/IP ; écoute loopback sauf token ; protection traversée de chemins ; aucun code importé n'est exécuté (JSON numérique uniquement) ; CORS explicite.

## Benchmarks
`npm run bench:parallel [secondes] [N,N,…]` (vrais worker_threads, budget comparable : 2 workers × T s ; « recherche seule » = 1 worker × 2T). Résultats mesurés dans `docs/bench-parallel.json` et résumés dans le bilan. Référence fiable utilisée : s(17) ≈ 4,6756 (meilleur connu) ; aucune optimalité n'est affirmée.

## Limites connues
- Tests unitaires du coordinateur : `InlineWorker` (pas de vrai parallélisme) ; les threads réels sont couverts par `server.test.js`, l'e2e et le benchmark.
- Reprise approximative (voir ci-dessus).
- SQLite : une seule instance serveur ; la montée en charge multi-instance demanderait PostgreSQL (non implémenté, chemin de migration : `server/store.js` est la seule couche SQL).
- Le speed-up dépend des cœurs réels ; mesuré sur 2 cœurs seulement.
- Aucune preuve d'optimalité ; les résultats sont des bornes supérieures sur S.
- Node ≥ 22.5 requis (`node:sqlite` expérimental).

## Stratégie « Motifs à bande inclinée » (`pattern`) et affinage SLP

- **Construction** (`src/algorithms/strips.js`) : grille alignée + bande de carrés inclinés d'un angle θ, balayage systématique de θ (pas 1°), largeur de bande 1–4, décalages et phases. Chaque motif est valide *par construction* ; il est de toute façon revérifié par l'autorité (`judge`).
- **Affinage continu** (`src/algorithms/slp.js`) : programmation linéaire séquentielle (linéarisation des écarts SAT, région de confiance, recherche linéaire). Un pas n'est accepté que s'il reste valide (tolérance 1e-10) et fait baisser S ; jamais en dessous de √N.
- **Intégration** : départ de la stratégie `pattern`, et affinage final (`finalize`) de la meilleure solution de chaque cycle.
- **Résultats mesurés** (`docs/bench-strips.json`, 2 cœurs, 10 s, graines 11 et 12) : gains pour N = 17, 26, 27, 39, 50 ; aucun pour N = 29 et 37 (reste à la grille / au niveau précédent). Les valeurs « connues » (`known.js`) ne sont pas battues ; aucune optimalité n'est revendiquée.

## Stratégie « Secousse + SLP » (`hop`) et transfert N±1

- **Boucle** (`src/algorithms/hop.js`) : expansion du conteneur (valide par construction), secousse annulée si elle crée un chevauchement, éventuellement un carré replacé dans un vide, puis compression par SLP. La nouvelle disposition remplace la courante si elle est meilleure (ou, rarement, légèrement moins bonne pour franchir un col). La meilleure est conservée à part et toujours revalidée.
- **Départ** : parent élite, sinon transfert depuis le meilleur packing connu de N+1 (un carré retiré) ou N−1 (un carré inséré, conteneur dilaté), sinon motif à bande, sinon grille. Le transfert utilise les records des autres recherches enregistrées sur le serveur.
- **Correctif SLP** : la tolérance anti-dégénérescence laissait l'écart se dégrader de ~2e-11 à chaque itération ; un carré collé à un mur finissait hors tolérance et bloquait toute la suite. Désormais plancher fixe par ligne + dilatation de 4e-10 par pas accepté. Effet mesuré : le SLP continue de progresser là où il s'arrêtait.
- **Résultats mesurés** (`docs/bench-hop.json`, 2 cœurs, 10 s, graines 11 et 12) : voir tableau dans AUDIT_GLOBAL.md ; gains faibles (quelques millièmes) ; N=29 reste à 6,0000 dans ce benchmark court. Aucune valeur connue n'est battue.

## Détecteur de record (`src/engine/certify.js`)

Toute nouvelle meilleure solution est comparée à `known.js`. Si elle passe sous la valeur connue, la disposition est dilatée de 2e-9 (relatif), revalidée avec une tolérance de 1e-12, et l'événement `beat` affiche une alerte « à re-vérifier indépendamment ». Les références de `known.js` (mises à jour depuis la page Friedman « Squares in Squares », valeurs à 14 chiffres) imposent S certifié < référence − 1e-9 pour parler de record ; « égale » si l'écart est < 1e-7 ; pour les N sans référence (42–45, 49, > 50), rien n'est jamais annoncé comme record. Le `hop` essaie aussi des rotations de groupes de carrés voisins (nouveaux angles) ; mesuré : pas de gain visible en 10 s (voir `docs/bench-hop.json`).

## Audit performance de la recherche (nov. 2026)

Mesures (N = 29, départ = record, 1 cœur) : le solveur linéaire du SLP représentait 81 % du temps. Il est maintenant un simplexe à bornes supérieures (la région de confiance n'est plus un jeu de lignes) avec pivots creux : **14 → 3,8 ms par itération SLP** et **2 → 6,3 secousses de hop par seconde**, à résultats identiques (mêmes S sur N = 17, 26, 39).

Planification (`Coordinator.planCycle`) : tant que l'Elite Pool ne contient que la grille ⌈√N⌉, tous les cycles sont des départs indépendants (muter la grille retombe sur la grille) ; avec < 4 solutions actives, 50 % de départs neufs ; après 10 min (ou 40 cycles) sans amélioration, 35 % de départs neufs. Le choix hop / mutation classique est piloté par un bandit (`evoKind`) au lieu d'une probabilité fixe de 50 %.

Non mesuré / limites : à 2 cœurs et 45 s (`scripts/bench-fixed.mjs`), N = 29 ne quitte la grille ni avant ni après ; sur N = 39, pas de différence significative (6,8754 contre 6,8794 de moyenne, bruit). Les gains attendus portent sur les longues recherches (plusieurs dizaines de minutes) et ne sont pas démontrés ici. Un mode « exploration forte » du hop (option `explore`) n'a montré aucun effet en 70 s et reste désactivé par défaut.
