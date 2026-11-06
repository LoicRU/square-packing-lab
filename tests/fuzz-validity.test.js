// Fuzz d'accord entre le validateur exact (SAT + grille) et le vérificateur indépendant (aires de polygones).
// Objectif : détecter toute disposition « visuellement convaincante mais invalide » acceptée par l'un des deux.
import { describe, it, expect } from 'vitest';
import { validateLayout } from '../src/engine/validate.js';
import { verifyIndependent } from '../src/engine/verify.js';

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('accord validateur exact ↔ vérificateur indépendant', () => {
  it('3000 dispositions aléatoires denses (angles libres) : verdicts identiques hors marge de tolérance', () => {
    const r = rng(2026); let valid = 0, invalid = 0;
    for (let it = 0; it < 3000; it++) {
      const n = 2 + Math.floor(r() * 9), S = 2 + r() * 3, sq = Array.from({ length: n }, () => ({ x: r() * S, y: r() * S, side: 1, theta: r() * Math.PI * 2 }));
      const v = validateLayout(sq, S, S), w = verifyIndependent(sq, S);
      // zone grise : pénétration ou aire minuscules (tolérances différentes par conception)
      const gray = (v.maxPenetration > 1e-9 && v.maxPenetration < 1e-6) || (w.maxOverlapArea > 1e-9 && w.maxOverlapArea < 1e-6) || (w.maxExcess > 1e-9 && w.maxExcess < 1e-6);
      if (gray) continue;
      expect(v.valid, `it=${it}`).toBe(w.valid); v.valid ? valid++ : invalid++;
    }
    expect(invalid).toBeGreaterThan(500); expect(valid).toBeGreaterThan(20); // le fuzz couvre bien les deux cas
  });

  it('constructions tangentes à angle quelconque : valides à ε=0, invalides dès un enfoncement de 1e-5', () => {
    const r = rng(7);
    for (let k = 0; k < 400; k++) {
      const th = r() * Math.PI / 2, c = Math.cos(th), s = Math.sin(th), ox = r() * 3 + 3, oy = r() * 3 + 3;
      const mk = (gap) => [{ x: ox, y: oy, side: 1, theta: th }, { x: ox + (1 + gap) * c, y: oy + (1 + gap) * s, side: 1, theta: th }]; // le long de l'axe tourné
      const W = 12;
      for (const gap of [0, 1e-12]) { expect(validateLayout(mk(gap), W, W).valid, `θ=${th} gap=${gap}`).toBe(true); expect(verifyIndependent(mk(gap), W).valid).toBe(true); }
      for (const gap of [-1e-5, -1e-3, -0.2]) { expect(validateLayout(mk(gap), W, W).valid, `θ=${th} gap=${gap}`).toBe(false); expect(verifyIndependent(mk(gap), W).valid).toBe(false); }
    }
  });

  it('coin contre arête (carré à 45° contre un carré droit) : tangence exacte puis enfoncement', () => {
    const d = Math.SQRT1_2; // demi-diagonale d'un carré unité
    const at = (gap) => [{ x: 2.5, y: 2.5, side: 1, theta: 0 }, { x: 3 + d + gap, y: 2.5, side: 1, theta: Math.PI / 4 }];
    expect(validateLayout(at(0), 5, 5).valid).toBe(true); expect(verifyIndependent(at(0), 5).valid).toBe(true);
    expect(validateLayout(at(-1e-4), 5, 5).valid).toBe(false); expect(verifyIndependent(at(-1e-4), 5).valid).toBe(false);
  });

  it('conteneur : un carré incliné dépasse exactement quand sa demi-étendue dépasse la marge', () => {
    for (const th of [0, 0.1, Math.PI / 8, Math.PI / 4, 1.3]) {
      const h = 0.5 * (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th))), S = 6;
      const at = (x) => [{ x, y: S / 2, side: 1, theta: th }];
      expect(validateLayout(at(h), S, S).valid).toBe(true); expect(verifyIndependent(at(h), S).valid).toBe(true);
      expect(validateLayout(at(h - 1e-4), S, S).valid).toBe(false); expect(verifyIndependent(at(h - 1e-4), S).valid).toBe(false);
    }
  });

  it('θ et θ + k·π/2 désignent le même carré', () => {
    const r = rng(3);
    for (let k = 0; k < 200; k++) {
      const n = 6, S = 4, sq = Array.from({ length: n }, () => ({ x: r() * S, y: r() * S, side: 1, theta: r() * 1.5 }));
      const rot = sq.map((q) => ({ ...q, theta: q.theta + Math.floor(r() * 4) * Math.PI / 2 }));
      expect(validateLayout(rot, S, S).valid).toBe(validateLayout(sq, S, S).valid);
    }
  });

  it('entrées dégénérées : NaN, Infinity, côté nul ou négatif → invalide, jamais valide', () => {
    for (const bad of [{ x: NaN }, { y: Infinity }, { theta: NaN }, { side: 0 }, { side: -1 }]) {
      const sq = [{ x: 1, y: 1, side: 1, theta: 0, ...bad }]; expect(validateLayout(sq, 5, 5).valid).toBe(false);
    }
  });
});
