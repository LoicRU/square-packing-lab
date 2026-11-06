// Motifs « bande inclinée » : validité par construction, bornes, déterminisme, intégration au Cycle (stratégie 'pattern').
import { describe, it, expect } from 'vitest';
import { stripSearch, stripLayout, stripCount } from '../src/algorithms/strips.js';
import { judge } from '../src/parallel/authority.js';
import { Cycle } from '../src/parallel/task.js';
import { BEST } from '../src/engine/known.js';

const asSol = (L) => ({ n: L.n, S: L.S, x: L.x, y: L.y, th: L.th });

describe('motifs à bande inclinée', () => {
  it('valides par construction : chaque candidat passe l’autorité (SAT + vérificateur indépendant), exactement N carrés', () => {
    for (const n of [5, 10, 17, 18, 26, 27, 28, 37, 38, 39, 50, 65]) {
      const c = stripSearch(n, { maxMs: 4000, keep: 8 });
      for (const cand of c) {
        const L = stripLayout(n, cand), j = judge(asSol(L), { n });
        expect(j.ok, `n=${n} S=${cand.S} θ=${cand.th} w=${cand.w} : ${j.reasons}`).toBe(true);
        expect(L.x).toHaveLength(n); expect(cand.S).toBeGreaterThanOrEqual(Math.sqrt(n) - 1e-9); expect(cand.S).toBeLessThan(Math.ceil(Math.sqrt(n)));
      }
    }
  }, 120000);

  it('améliore la grille là où elle est lâche (N = 26, 27, 37, 38, 39) sans jamais descendre sous la borne d’aire ni sous la meilleure valeur connue', () => {
    for (const n of [26, 27, 37, 38, 39]) {
      const c = stripSearch(n, { maxMs: 4000 }); expect(c.length, `n=${n}`).toBeGreaterThan(0);
      expect(c[0].S).toBeLessThan(Math.ceil(Math.sqrt(n)) - 0.05);
      expect(c[0].S).toBeGreaterThanOrEqual(BEST[n] - 1e-9); // jamais « mieux que la littérature » : ce serait un bug de validité
    }
  }, 60000);

  it('N = k² : aucun motif (la grille est déjà optimale) ; le décompte est monotone en S pour un motif fixe', () => {
    expect(stripSearch(25)).toEqual([]); expect(stripSearch(36)).toEqual([]);
    let last = 0; for (let S = 4; S <= 6; S += 0.05) { const c = stripCount(S, 0.3, 2, 0.2, 0.25); expect(c).toBeGreaterThanOrEqual(last - 3); last = Math.max(last, c); }
  });

  it('déterministe', () => { const a = stripSearch(26, { maxMs: 4000 }), b = stripSearch(26, { maxMs: 4000 }); expect(a.map((x) => x.S)).toEqual(b.map((x) => x.S)); });

  it('stratégie « pattern » du Cycle : solution valide, meilleure que la grille pour N = 26 dès le départ', () => {
    const c = new Cycle({ n: 26, seed: 3, strategy: 'pattern', budgetMs: 1500 }); expect(c.kind).toBe('pattern');
    const t0 = performance.now(); while (!c.done && performance.now() - t0 < 5000) c.step();
    const b = c.best(), j = judge(b, { n: 26 }); expect(j.ok).toBe(true); expect(b.S).toBeLessThan(5.9);
  }, 30000);

  it('stratégie « pattern » sans motif disponible (N = 16) : repli propre sur la recherche directe', () => {
    const c = new Cycle({ n: 16, seed: 1, strategy: 'pattern', budgetMs: 300 }); const t0 = performance.now(); while (!c.done && performance.now() - t0 < 3000) c.step();
    expect(judge(c.best(), { n: 16 }).ok).toBe(true);
  });
});
