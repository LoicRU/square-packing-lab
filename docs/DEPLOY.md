# Déploiement

Le simulateur classique est 100 % statique (`dist/`). Le **Parallel Packing Lab** exige en plus un serveur Node persistant (voir plus bas) : sans lui, seule cette page est indisponible.

```bash
npm ci && npm run build
```

## Vercel
Importer le dépôt : `vercel.json` fournit build, dossier de sortie et en-têtes de sécurité (CSP incluse). Ou `npx vercel --prod`.

## Netlify
Importer le dépôt : `netlify.toml` est détecté. Ou `npx netlify deploy --prod --dir=dist`.

## Cloudflare Pages
Build command `npm run build`, output directory `dist`. Le fichier `public/_headers` (copié dans `dist/`) applique CSP et cache.

## Après déploiement
1. Remplacer le domaine factice `https://square-packing-lab.example` (canonical, Open Graph, JSON-LD, sitemap, robots) : `SITE_URL=https://votre-domaine npm run build:prod` (ou `node scripts/set-domain.mjs https://votre-domaine`).
2. Vérifier que le Web Worker se charge (console sans erreur) ; la CSP autorise `worker-src 'self' blob:`.
3. Tester `npm run e2e` avec `BASE=https://votre-domaine`.

## Parallel Packing Lab : backend persistant
**Pas de serverless** (Vercel/Netlify Functions, Lambda…) : le calcul est continu, avec threads et SQLite ; ces plateformes coupent les processus.

Option A — tout sur une machine (recommandé) : `docker build -t ppl . && docker run -d --restart=always -p 8787:8787 -v ppl-data:/data -e PPL_TOKEN=$(openssl rand -hex 32) ppl`, derrière Caddy (`deploy/Caddyfile`, HTTPS, SSE sans buffering ; ajouter `-e PPL_TRUST_PROXY=1 -e PPL_HSTS=1`). Ou sans Docker : Node ≥ 22.5, `npm ci && npm run build`, `deploy/ppl.service` (systemd) + `/etc/ppl.env` (voir `.env.example`).

Option B — front statique + back séparé : définir `PPL_ORIGIN=https://front`, ajouter l'URL du back à `connect-src` dans les CSP (`vercel.json`, `netlify.toml`, `public/_headers`), et saisir l'API dans l'interface (`ppl.api`). `/api` n'est pas servi par les hébergeurs statiques.

Sauvegarde : `deploy/backup.sh` (VACUUM INTO, cohérent à chaud) en cron. Coût estimé (payant, à votre charge) : VPS 4 vCPU / 8 Go ≈ 15–25 €/mois (Hetzner/OVH) ; Fly.io/Railway équivalent ≈ 30–60 €/mois ; front statique gratuit. Un VPS 2 vCPU (≈ 5–8 €/mois) suffit pour essayer, avec moins de parallélisme.

Note SEO : `parallel.html` est en `noindex` et absent du sitemap tant qu'aucun backend public n'est déployé (page sans serveur = contenu pauvre). Retirez la balise `robots` et ajoutez la page au sitemap une fois le backend public en ligne. Node ≥ 22 requis (Netlify : `NODE_VERSION = "22"`).
