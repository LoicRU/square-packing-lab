# Audit global — Square Packing Lab (novembre 2026)

Audit réalisé par exploration du code, mesures automatisées (Lighthouse, axe-core, Playwright, npm audit, Vitest) et lecture de captures d'écran. Tout ce qui est annoncé « mesuré » l'a été sur ce build, avec Chromium (Playwright). **Aucun test sur Firefox, Safari ni appareil physique n'a été réalisé.**

## 1. État initial (mesuré avant modification)

| Mesure | Valeur initiale |
|---|---|
| Tests Vitest | 250 / 250 verts (12 fichiers) |
| `npm audit` | 6 vulnérabilités (2 critiques, 1 haute, 3 modérées), toutes dans l'outillage de dev (vite, vitest, esbuild, tinypool) ; aucune dans le code livré |
| Lighthouse mobile (perf / a11y / bp / seo) | accueil 91/95/100/100 · **simulateur 68/93/100/100 (CLS 0,349, TBT 598 ms)** · algorithmes 100/95 · le problème 100/95 · à propos 100/95 · parallel 96/92/96/100 (CLS 0,126) |
| axe-core (WCAG 2.x AA + bonnes pratiques) | simulateur : 10 erreurs de contraste (« serious »), pas de H1, ordre des titres ; parallel : pas de H1, ordre des titres ; toutes pages : lien de marque sans nom accessible en mobile |
| Responsive | **simulateur : débordement horizontal (455 px pour un écran de 390 px) ; la zone de simulation dépassait de l'écran sur smartphone** |

## 2. Problèmes identifiés

Classement : C = critique, I = important, M = moyen, m = mineur. « Statut » : ✅ corrigé · ⚠️ partiel · ❌ non traité.

| # | Prio | Problème | Localisation | Conséquence | Statut |
|---|---|---|---|---|---|
| 1 | C | Sans jeton (mode localhost par défaut), un site tiers pouvait envoyer des POST « simples » à `127.0.0.1:8787` (CSRF) ; aucun contrôle du `Host` (DNS rebinding) ; le corps JSON était accepté quel que soit le `Content-Type` | `server/index.js` | lancement/arrêt de recherches (CPU) par une page web quelconque | ✅ garde Origin / Sec-Fetch-Site / Host / Content-Type, testée |
| 2 | I | Pages statiques servies par Node sans CSP ni en-têtes de sécurité ; `decodeURIComponent` invalide → erreur 500 ; fichiers cachés (`.env`) non refusés explicitement | `server/index.js` | durcissement manquant (déploiement « option A ») | ✅ |
| 3 | I | Limite de débit basée sur l'IP du proxy (tous les clients confondus derrière Caddy) ; aucun frein aux jetons erronés ; jeton accepté en query sur toutes les routes | `server/index.js` | contournement/DoS, jeton dans les journaux | ✅ `PPL_TRUST_PROXY`, 20 échecs/min/IP, query limitée au flux SSE |
| 4 | I | Simulateur illisible sur smartphone : colonne de grille implicite « auto » élargie par ses enfants (455 px) | `styles.css` (`.stage`, `.sim`) | débordement horizontal, canvas coupé | ✅ |
| 5 | I | CLS 0,349 (simulateur mobile) : lecteur de phases et boutons masqués au chargement puis révélés par le JS | `simulator.html` | instabilité visuelle, Lighthouse perf 68 | ✅ → CLS 0,010 |
| 6 | I | Accueil affichait « 0 serveur » ; pieds de page et « À propos » affirmaient « aucune donnée envoyée » alors que le Parallel Lab envoie des données au serveur de calcul | `index.html`, `about.html`, footers | information inexacte | ✅ reformulé honnêtement |
| 7 | I | Parallel Lab sans serveur : message technique brut (« Failed to execute 'json'… »), bouton de lancement actif, sondage toutes les 10 s sans fin | `src/app/parallel.js` | échec incompréhensible, bruit réseau | ✅ message clair, bouton désactivé, sondage espacé (10 s → 60 s) |
| 8 | I | Contrastes insuffisants (phases « à venir » à 2,01:1 via `opacity`) | `styles.css` | WCAG AA non respecté | ✅ |
| 9 | I | Aucun H1 sur simulateur et parallel ; ordre des titres incohérent ; lien de marque sans nom accessible en mobile ; interrupteurs `.tog` sans `aria-pressed` ; onglets sans navigation clavier fléchée | pages + `src/app/a11y.js` | lecteurs d'écran, clavier | ✅ |
| 10 | M | Cibles tactiles < 24 px (navigation, curseurs, puces) | `styles.css` | ergonomie mobile, WCAG 2.2 (2.5.8) | ✅ 32 px (44 px sur écrans tactiles) |
| 11 | M | SEO : pas d'image Open Graph, `twitter:card` minimal, `og:title` du Parallel Lab copié du simulateur, JSON-LD « WebApplication » sur des pages de contenu, pas de page 404, `robots.txt` sans `Disallow: /api/`, domaine factice remplacé à la main | `*.html`, `public/` | partage et indexation dégradés | ✅ `og.png` générée, métadonnées complètes, JSON-LD corrigé, `404.html`, `scripts/set-domain.mjs` |
| 12 | M | `parallel.html` indexable alors qu'elle n'a pas de contenu sans backend | `parallel.html` | contenu pauvre indexé | ✅ `noindex` + doc ; explication indexable ajoutée dans `algorithms.html` |
| 13 | M | Aucune page n'expliquait le moteur parallèle (ni ses limites) hors dépôt | `algorithms.html` | produit non documenté pour l'utilisateur | ✅ section ajoutée |
| 14 | M | Dépendances de dev vulnérables | `package.json` | chaîne d'outillage | ✅ vite 8 / vitest 5 → **0 vulnérabilité** (Node ≥ 22 requis, Netlify mis à jour) |
| 15 | M | Doublon d'attribut `id` sur `<main>` (Parallel Lab) | `parallel.html` | HTML invalide | ✅ + test d'intégrité statique |
| 16 | m | Suppression de toutes les recherches : bouton rouge plein au même niveau que les actions courantes | `parallel.html` | risque de clic accidentel | ✅ « Zone dangereuse » repliée + double confirmation |
| 17 | m | Titres de graphiques en `h4` sans `h2/h3` parents | `simulator.html` | hiérarchie | ✅ |

## 3. Audit mathématique et scientifique

- **Formules** (`docs/MATHS.md`, `src/engine/geometry.js`, `validate.js`, `verify.js`) relues : demi-étendue `h = (s/2)(|cos θ|+|sin θ|)`, SAT à 4 axes, rejet rapide par cercle circonscrit, rotation libre prise en compte partout, angles repliés sur [0, π/2). **Aucune erreur trouvée.**
- **Nouveau fuzz** (`tests/fuzz-validity.test.js`) : 3 000 dispositions aléatoires denses à angles libres — le validateur exact (SAT + grille) et le vérificateur indépendant (aires de polygones) rendent le même verdict (hors zone grise de tolérance 1e-9…1e-6 volontairement exclue) ; 400 constructions tangentes à angle quelconque (valide à écart 0, invalide dès −1e-5) ; coin contre arête à 45° ; dépassement du conteneur par demi-étendue ; invariance θ ↔ θ + kπ/2 ; entrées NaN/Infinity/côté ≤ 0 toujours invalides.
- **Tolérance** : une disposition « valide » peut recouvrir d'une pénétration ≤ 1e-9 (paramètre explicite). C'est une validation en virgule flottante avec marge, **pas une preuve exacte** ; c'est écrit dans `MATHS.md` et rappelé dans l'interface.
- **Table `known.js`** (s(n), n ≤ 40) : cohérence interne testée (`tests/known.test.js` : √n ≤ s(n) ≤ ⌈√n⌉, monotonie, Nagamochi pour k²−1 et k²−2, « optimal » jamais annoncé sans preuve). **Les valeurs numériques n'ont pas pu être recontrôlées contre la source externe (Friedman) pendant cet audit : la lecture web a été refusée.** Elles sont cohérentes avec la littérature telle que je la connais, mais restent à vérifier.
- Distinction prouvé / expérimental : respectée (classification, notes, Parallel Lab). Aucune affirmation d'optimalité sans preuve.

## 4. Algorithmes et performances

- Aucun algorithme n'a été remplacé : aucun benchmark ne justifiait de le faire. Résultats existants (budgets courts, 2 cœurs, **une seule exécution par cas**, `docs/bench-parallel.json`) : écarts dans le bruit entre « recherche seule », indépendantes, évolutif et direct ; à N = 17 le meilleur reste ≈ 4,708 contre 4,6756 connu (+0,7 %) ; à N = 50 forte variance (7,76 à 8,00). **Le mode évolutif n'est pas démontré supérieur** ; une conclusion exigerait budgets longs, plusieurs graines, plus de cœurs.
- Taille des bundles (gzip) : worker de calcul 24,8 Ko, simulateur 17,4 Ko, rendu 13,4 Ko, Parallel Lab 10,8 Ko, CSS 5,1 Ko. Pas de police externe, pas de requête tierce. Code splitting déjà par page.
- Lighthouse : le seul goulot réel trouvé était le CLS du simulateur (corrigé). TBT de l'accueil variable d'un passage à l'autre (5 à 480 ms) : l'animation d'en-tête exécute un vrai placement MaxRects ; non modifiée.

## 5. Améliorations effectuées

Sécurité : garde anti-CSRF/rebinding, en-têtes, proxy, anti brute-force, chemins, dépendances. UX/design : zone dangereuse, messages d'erreur, états désactivés, texte d'accueil honnête, cibles tactiles, correction du simulateur mobile. Accessibilité : H1, titres, contrastes, noms accessibles, `aria-pressed`, onglets au clavier, zones `aria-live`. SEO : Open Graph/Twitter, JSON-LD, 404, robots/sitemap, script de domaine. Tests : +64. Outils : `npm run audit:a11y` (axe + 7 tailles), `npm run build:prod`. Docs : `PARALLEL.md`, `DEPLOY.md`, `.env.example`.

### Fichiers modifiés ou créés
`server/index.js` · `src/app/{a11y,parallel,simulator}.js` · `src/styles/styles.css` · `{index,simulator,parallel,algorithms,learn,about}.html` · `public/{og.png,404.html,sitemap.xml,robots.txt,_headers}` · `vercel.json` · `netlify.toml` · `vite.config.js` · `package.json` / `package-lock.json` · `scripts/{audit-site,set-domain,e2e-parallel}.mjs` · `tests/{site,known,fuzz-validity,server}.test.js` · `docs/{PARALLEL,DEPLOY}.md` · `.env.example` · `AUDIT_GLOBAL.md`

## 6. Tests et résultats

| Test | Résultat |
|---|---|
| Vitest | **314 / 314** (15 fichiers) : 250 initiaux + intégrité statique (47), table s(n) (7), fuzz de validité (6), sécurité serveur (1), records par N / tout arrêter / tout supprimer (3) |
| e2e classique (`scripts/e2e.mjs`) | OK |
| e2e Parallel Lab (vrais threads, redémarrage forcé, reconnexion) | OK, avec contrôles ajoutés (records par N, tri, « Tout arrêter », « Tout supprimer ») |
| `npm run audit:a11y` (axe WCAG 2.2 AA + bonnes pratiques, 7 tailles 320 → 2560 px, erreurs JS) | **6 pages OK** |
| `npm audit` | **0 vulnérabilité** |
| Navigation clavier (Playwright) | interrupteurs et onglets fléchés vérifiés |

### Lighthouse final (mobile émulé, build local `vite preview`)
| Page | perf | a11y | bonnes pratiques | SEO | CLS |
|---|---|---|---|---|---|
| Accueil | 100 (91) | 100 (95) | 100 | 100 | 0 |
| Simulateur | **100 (68)** | **100 (93)** | 100 | 100 | **0,010 (0,349)** |
| Algorithmes / Le problème / À propos | 100 | 100 (95) | 100 | 100 | 0 |
| Parallel Lab | 97 (96) | 100 (92) | 96 | 66* | 0,107 (0,126) |

(entre parenthèses : état initial). *Le score SEO 66 de Parallel Lab est **voulu** (`noindex`, voir #12). Ses bonnes pratiques à 96 viennent de l'erreur réseau console quand aucun backend ne répond, inévitable avec un `fetch` vers un serveur absent.

## 7. Problèmes non résolus / limites

- Chromium uniquement ; pas de Firefox, Safari, ni de vrai smartphone ; Lighthouse en émulation sur serveur local (pas de réseau réel).
- Parallel Lab : axe n'a analysé que l'état initial (aucune recherche active) ; les onglets Visualisation / Classement / Historique peuplés n'ont pas été scannés. CLS résiduel 0,107 en mobile (texte d'état qui change).
- Jeton d'accès transmis en query pour le flux SSE (`EventSource` ne permet pas d'en-tête) : il peut apparaître dans les journaux d'un proxy. Alternative (SSE par `fetch`) non implémentée.
- Reprise après redémarrage approximative ; SQLite mono-instance ; speed-up mesuré sur 2 cœurs seulement ; **aucun gain algorithmique démontré** ; Parallel Lab non déterministe (dépend du temps).
- Valeurs `known.js` non recontrôlées à la source externe.
- Non faits (volontairement, pas de valeur démontrée) : thème clair, internationalisation, PWA, tutoriel interactif guidé, `ppl.api` par en-tête plutôt que stockage local.

## 8. Recommandations
1. Recontrôler `known.js` contre la publication de Friedman et ajouter la référence exacte.
2. Lancer `npm run bench:parallel` avec 8+ cœurs, budgets longs et 5+ graines avant toute affirmation sur l'intérêt du mode évolutif.
3. Tester sur Firefox/Safari et au moins un smartphone réel ; mesurer avec WebPageTest depuis le domaine final.
4. Remplacer le jeton en query SSE par un flux `fetch`, ou un cookie `HttpOnly` signé, avant une exposition publique.
5. Après mise en ligne : `SITE_URL=https://… npm run build:prod`, retirer le `noindex` de `parallel.html` seulement si un backend public existe.

## Addendum — amélioration des résultats (hop + SLP corrigé)

Benchmark `CMP=hop SEEDS=11,12 node scripts/bench-strips.mjs 10` (2 cœurs, 10 s ; « sans hop » inclut déjà le SLP corrigé) :

| N | sans hop | avec hop | connu (`known.js`) |
|---|---|---|---|
| 17 | 4,7073 | 4,7071 | 4,6756 |
| 26 | 5,7071 | 5,7071 | 5,6213 |
| 27 | 5,7078 | 5,7071 | 5,7071 |
| 29 | 6,0000 | 6,0000 | 5,9344 |
| 37 | 6,7453 | 6,7134 | 6,5987 |
| 39 | 6,9089 | 6,9035 | 6,8189 |
| 50 | 7,7146 | 7,7133 | — |

Constats honnêtes : le correctif du SLP apporte l'essentiel (ex. N=27 : 5,7544 → 5,7078) ; le hop ajoute de petits gains ; les structures qui diffèrent vraiment (N=17, 26, 29, 37, 39) ne sont pas atteintes en 10 s. Un redémarrage aléatoire + compression SLP a été testé (N=17 : 5,65 à 7,6) et n'est pas compétitif sans beaucoup plus de temps. Aucune optimalité n'est revendiquée.

**Correction (nov. 2026)** : la colonne « connu » des tableaux ci-dessus reprend l'ancienne `known.js` (survey 2005). Valeurs mises à jour d'après la page Friedman « Squares in Squares » : N=28 → 5,82444462 ; N=29 → 5,93383346 (T. Schadt, déc. 2025, optimisé par D. Ellsworth) ; N=39 → 6,81072208 (T. Schadt, janv. 2026) ; N=41 → 6,92669309 ; N=50 → 7 + 4/7 = 7,57142857. Ces valeurs n'ont pas été recalculées indépendamment. Les écarts de nos résultats aux records sont donc un peu plus grands que ceux écrits plus haut (ex. N=29 : 5,93434 contre 5,93383, soit +0,0005).

## Addendum — performance de la recherche (nov. 2026)
Profil : simplexe du SLP = 81 % du temps → réécrit (bornes supérieures, pivots creux) : 14 → 3,8 ms/itération, hop 2 → 6,3 secousses/s (résultats identiques). Planification adaptative (pool trivial, pool maigre, stagnation, bandit hop/mutation). Détails et limites dans docs/PARALLEL.md. Non démontré : gain de qualité sur les longues recherches.
