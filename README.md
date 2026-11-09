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
