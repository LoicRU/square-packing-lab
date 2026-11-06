import { describe, it, expect } from 'vitest';
import { createRng } from '../src/engine/rng.js';
import { corners, halfExtent, penetration, overlaps, containerExcess, satPenCS, TOL } from '../src/engine/geometry.js';
import { Grid } from '../src/engine/grid.js';
import { validateLayout, stripConflicts } from '../src/engine/validate.js';
import { normalizeConfig, encodeConfig, decodeConfig, parseSizeList, LIMITS } from '../src/engine/config.js';
import { makeInstance, buildInstance, diagnose } from '../src/engine/instance.js';
import { computeStats } from '../src/engine/stats.js';
import { classify, literatureNote } from '../src/engine/classify.js';
import { layoutToSvg, resultToJson } from '../src/engine/export.js';
import { maxKnownCount, isProven, BEST } from '../src/engine/known.js';

const sq = (x, y, side = 1, theta = 0) => ({ x, y, side, theta });
const R2 = Math.SQRT2;

describe('rng', () => {
  it('même graine → même séquence ; graines différentes → séquences différentes', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
    expect(createRng(42).next()).not.toBe(c.next());
  });
  it('reste dans [0,1) et respecte range/int', () => {
    const r = createRng(1);
    for (let i = 0; i < 2000; i++) { const v = r.next(); expect(v >= 0 && v < 1).toBe(true); const k = r.int(3, 5); expect([3, 4, 5]).toContain(k); }
  });
});

describe('géométrie', () => {
  it('sommets d’un carré aligné et tourné à distance side/√2 du centre', () => {
    const c = corners(sq(0.5, 0.5)).map((p) => p.map((v) => +v.toFixed(9)).join(','));
    expect(new Set(c)).toEqual(new Set(['0,0', '1,0', '1,1', '0,1']));
    for (const th of [0, 0.3, 1.1, Math.PI / 4]) for (const [px, py] of corners(sq(3, 2, 1.5, th))) expect(Math.hypot(px - 3, py - 2)).toBeCloseTo(1.5 / R2, 12);
  });
  it('demi-étendue : (side/2)(|cos|+|sin|)', () => {
    expect(halfExtent(1, Math.PI / 4)).toBeCloseTo(R2 / 2, 12);
    expect(halfExtent(2, 0)).toBeCloseTo(1, 12);
    expect(halfExtent(2, Math.PI / 2)).toBeCloseTo(1, 12);
  });
  it('tangents → 0 ; recouvrement de 0.1 → 0.1 ; identiques → côté', () => {
    expect(penetration(sq(0.5, 0.5), sq(1.5, 0.5))).toBe(0);
    expect(penetration(sq(0.5, 0.5), sq(1.4, 0.5))).toBeCloseTo(0.1, 12);
    expect(penetration(sq(1, 1), sq(1, 1))).toBeCloseTo(1, 12);
    expect(overlaps(sq(0.5, 0.5), sq(1.5, 0.5))).toBe(false);
  });
  it('symétrie de la pénétration et normale unitaire orientée de A vers B', () => {
    const r = createRng(5), o1 = new Float64Array(2), o2 = new Float64Array(2);
    for (let i = 0; i < 800; i++) {
      const A = sq(r.range(0, 3), r.range(0, 3), r.range(0.5, 1.5), r.range(0, 3)), B = sq(r.range(0, 3), r.range(0, 3), r.range(0.5, 1.5), r.range(0, 3));
      const p = penetration(A, B, o1), q = penetration(B, A, o2);
      expect(p).toBeCloseTo(q, 12);
      if (p > 0) {
        expect(Math.hypot(o1[0], o1[1])).toBeCloseTo(1, 12);
        expect(o1[0] * (B.x - A.x) + o1[1] * (B.y - A.y)).toBeGreaterThanOrEqual(-1e-12);
        expect(o1[0] + o2[0]).toBeCloseTo(0, 9);
      }
    }
  });
  it('cas n=5 : carré à 45° tangent au coin d’un carré aligné ; poussé de 0.05 → collision', () => {
    const s = 2 + 1 / R2;
    expect(penetration(sq(0.5, 0.5), sq(s / 2, s / 2, 1, Math.PI / 4))).toBeLessThan(1e-12);
    expect(overlaps(sq(0.5, 0.5), sq(s / 2 - 0.05, s / 2 - 0.05, 1, Math.PI / 4))).toBe(true);
  });
  it('deux carrés à 45° côte à côte le long de leur axe → tangents', () => {
    const a = sq(0, 0, 1, Math.PI / 4), b = sq(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 1, Math.PI / 4);
    expect(penetration(a, b)).toBeLessThan(1e-12);
  });
  it('pas de faux négatif du rejet rapide (cercles circonscrits)', () => {
    const r = createRng(11);
    for (let i = 0; i < 3000; i++) {
      const A = sq(0, 0, 1, r.range(0, 3)), B = sq(r.range(-2, 2), r.range(-2, 2), r.range(0.4, 1.6), r.range(0, 3));
      // vérité terrain par échantillonnage de points : si un sommet de l'un est strictement dans l'autre → pénétration > 0
      const inside = (P, p) => { const dx = p[0] - P.x, dy = p[1] - P.y, c = Math.cos(-P.theta), s = Math.sin(-P.theta); const lx = dx * c - dy * s, ly = dx * s + dy * c; return Math.abs(lx) < P.side / 2 - 1e-9 && Math.abs(ly) < P.side / 2 - 1e-9; };
      const hit = corners(A).some((p) => inside(B, p)) || corners(B).some((p) => inside(A, p));
      if (hit) expect(penetration(A, B)).toBeGreaterThan(0);
    }
  });
  it('conteneur rectangulaire : dépassements exacts avec rotation', () => {
    expect(containerExcess(sq(0.5, 0.5), 3, 2)).toBe(0);
    expect(containerExcess(sq(2.7, 1), 3, 2)).toBeCloseTo(0.2, 12);
    expect(containerExcess(sq(1, 1.8), 3, 2)).toBeCloseTo(0.3, 12);
    const h = R2 / 2;
    expect(containerExcess(sq(h, h, 1, Math.PI / 4), 3, 3)).toBeCloseTo(0, 12);
    expect(containerExcess(sq(0.6, h, 1, Math.PI / 4), 3, 3)).toBeGreaterThan(0.1);
  });
});

describe('grille spatiale', () => {
  it('énumère toutes les paires proches, sans doublon', () => {
    const r = createRng(9), n = 250, W = 30, H = 14, L = [];
    for (let i = 0; i < n; i++) L.push(sq(r.range(0, W), r.range(0, H), r.range(0.5, 1.5), r.range(0, 3)));
    const g = new Grid(W, H, 2 * 1.5 / R2 + 1e-9, n);
    L.forEach((q, i) => g.insert(i, q.x, q.y));
    const got = new Set();
    g.pairs((i, j) => { expect(got.has(i * n + j)).toBe(false); got.add(i * n + j); });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y) < (L[i].side + L[j].side) / R2) expect(got.has(i * n + j)).toBe(true);
    }
  });
  it('move/remove maintiennent la cohérence', () => {
    const g = new Grid(10, 10, 1, 3); g.insert(0, 0.5, 0.5); g.insert(1, 9.5, 9.5);
    g.move(0, 9.4, 9.4); const seen = []; g.near(9.5, 9.5, (j) => seen.push(j)); expect(seen.sort()).toEqual([0, 1]);
    g.remove(0); const s2 = []; g.near(9.5, 9.5, (j) => s2.push(j)); expect(s2).toEqual([1]);
  });
});

describe('validateLayout (exactitude)', () => {
  it('grille 3×3 → valide, remplissage 100 %', () => {
    const L = []; for (let i = 0; i < 9; i++) L.push(sq(0.5 + (i % 3), 0.5 + Math.floor(i / 3)));
    const v = validateLayout(L, 3, 3); expect(v.valid).toBe(true); expect(v.validArea).toBeCloseTo(9, 12);
  });
  it('n=5 optimal valide pour s=2+1/√2 et invalide pour s−0.01', () => {
    const s = 2 + 1 / R2, mk = (S) => [sq(.5, .5), sq(S - .5, .5), sq(.5, S - .5), sq(S - .5, S - .5), sq(S / 2, S / 2, 1, Math.PI / 4)];
    expect(validateLayout(mk(s), s, s).valid).toBe(true);
    expect(validateLayout(mk(s - 0.01), s - 0.01, s - 0.01).valid).toBe(false);
  });
  it('détecte sorties, chevauchements, valeurs non finies et côtés nuls', () => {
    expect(validateLayout([sq(0.2, 0.5)], 3, 3).oob).toEqual([0]);
    const v = validateLayout([sq(.5, .5), sq(1.2, .5)], 3, 3); expect(v.pairs).toHaveLength(1); expect(v.maxPenetration).toBeCloseTo(0.3, 12);
    expect(validateLayout([sq(NaN, 1)], 3, 3).valid).toBe(false);
    expect(validateLayout([sq(1, 1, 0)], 3, 3).valid).toBe(false);
    expect(validateLayout([sq(1, 1, -1)], 3, 3).valid).toBe(false);
  });
  it('équivalent au test O(n²) sur dispositions aléatoires (conteneur rectangulaire)', () => {
    const r = createRng(2024);
    for (let t = 0; t < 15; t++) {
      const n = 120, W = 17, H = 9, L = [];
      for (let i = 0; i < n; i++) L.push(sq(r.range(-1, W + 1), r.range(-1, H + 1), r.range(0.3, 1.2), r.range(0, 3)));
      const v = validateLayout(L, W, H), brute = new Set();
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (penetration(L[i], L[j]) > TOL) brute.add(`${i},${j}`);
      expect(new Set(v.pairs.map(([i, j]) => `${i},${j}`))).toEqual(brute);
      const oob = L.map((q, i) => (containerExcess(q, W, H) > TOL ? i : -1)).filter((i) => i >= 0);
      expect(v.oob.sort((a, b) => a - b)).toEqual(oob);
    }
  });
  it('disposition vide valide ; stripConflicts produit une disposition valide', () => {
    expect(validateLayout([], 5, 5).valid).toBe(true);
    const r = createRng(3), L = []; for (let i = 0; i < 80; i++) L.push(sq(r.range(0, 8), r.range(0, 8), 1, r.range(0, 3)));
    const { kept, removed } = stripConflicts(L, 8, 8);
    expect(validateLayout(kept, 8, 8).valid).toBe(true); expect(kept.length + removed.length).toBe(80); expect(removed.length).toBeGreaterThan(0);
  });
});

describe('configuration', () => {
  it('normalise : limites, min>max échangés, mode carré, algo inconnu', () => {
    const { config, warnings } = normalizeConfig({ problem: 'pack', n: 99999, sMin: 5, sMax: 2, containerMode: 'square', W: 10, H: 3, algorithm: 'nope', seed: '12' });
    expect(config.n).toBe(LIMITS.maxN); expect(config.sMin).toBe(2); expect(config.sMax).toBe(5); expect(config.H).toBe(10);
    expect(config.algorithm).toBe('maxrects'); expect(config.seed).toBe(12); expect(warnings.length).toBeGreaterThan(0);
    expect(normalizeConfig({ n: -5 }).config.n).toBe(1);
    expect(normalizeConfig({ problem: 'pack', containerMode: 'rect', W: 10, H: 3 }).config.H).toBe(3);
    expect(normalizeConfig({ limits: { maxN: 5000 }, n: 3000 }).config.n).toBe(3000);
  });
  it('ne lance jamais d’exception sur des entrées absurdes', () => {
    for (const raw of [undefined, null, {}, { n: 'abc', W: 'x', sMin: NaN, options: 5 }, { presetSizes: 'zz', presetId: 'custom' }]) expect(() => normalizeConfig(raw ?? undefined)).not.toThrow();
  });
  it('encodage URL aller-retour et parseSizeList', () => {
    const { config } = normalizeConfig({ n: 12, seed: 5 });
    expect(decodeConfig(encodeConfig(config))).toEqual(config);
    expect(decodeConfig('%%%')).toBeNull();
    expect(parseSizeList('3, 2;2.5  -1 abc 0')).toEqual([3, 2, 2.5]);
  });
});

describe('instance', () => {
  it('déterministe ; identique/préréglé/aléatoire ; détection d’impossibilités', () => {
    const { config } = normalizeConfig({ n: 20, sizeMode: 'random', sMin: 1, sMax: 3, seed: 9 });
    const a = makeInstance(config), b = makeInstance(config);
    expect(a.items).toEqual(b.items);
    expect(makeInstance({ ...config, seed: 10 }).items).not.toEqual(a.items);
    a.items.forEach((it) => expect(it.side >= 1 && it.side <= 3).toBe(true));
    const idt = makeInstance(normalizeConfig({ n: 5, sizeMode: 'identical', sMax: 2 }).config);
    expect(idt.identical).toBe(true); expect(idt.items.every((i) => i.side === 2)).toBe(true);
    const pre = makeInstance(normalizeConfig({ n: 7, sizeMode: 'preset', presetId: 'pythagoras' }).config);
    expect(pre.items.map((i) => i.side)).toEqual([3, 4, 5, 3, 4, 5, 3]);
    const big = buildInstance({ W: 4, H: 4, items: [{ id: 0, side: 5 }, { id: 1, side: 1 }] });
    expect(big.impossible).toEqual([0]); expect(diagnose(big).some((d) => d.level === 'error')).toBe(true);
    expect(buildInstance({ W: 2, H: 2, items: Array.from({ length: 5 }, (_, i) => ({ id: i, side: 1 })) }).areaExceeds).toBe(true);
  });
});

describe('classification et statistiques', () => {
  it('invalide ≠ optimal ; tout placé → optimal prouvé ; sinon heuristique', () => {
    const inst = buildInstance({ W: 3, H: 3, items: Array.from({ length: 9 }, (_, i) => ({ id: i, side: 1 })) });
    const full = Array.from({ length: 9 }, (_, i) => ({ id: i, x: .5 + (i % 3), y: .5 + Math.floor(i / 3), side: 1, theta: 0 }));
    const s = computeStats(inst, full); expect(classify(inst, s).status).toBe('optimal'); expect(s.fill).toBeCloseTo(1, 12);
    const bad = computeStats(inst, [full[0], { ...full[1], x: .6 }]); expect(classify(inst, bad).status).toBe('invalid');
    const part = computeStats(inst, full.slice(0, 5)); expect(classify(inst, part).status).toBe('valid'); expect(part.unplaced).toBe(4);
    expect(part.placed + part.unplaced).toBe(9);
  });
  it('statistiques calculées sur la disposition réelle (collisions comptées, surface valide seulement)', () => {
    const inst = buildInstance({ W: 4, H: 4, items: [{ id: 0, side: 1 }, { id: 1, side: 1 }, { id: 2, side: 2 }] });
    const L = [{ id: 0, x: .5, y: .5, side: 1, theta: 0 }, { id: 1, x: .9, y: .5, side: 1, theta: 0 }, { id: 2, x: 3, y: 3, side: 2, theta: 0 }];
    const s = computeStats(inst, L);
    expect(s.collisions).toBe(1); expect(s.placed).toBe(1); expect(s.placedArea).toBeCloseTo(4, 12); expect(s.valid).toBe(false);
  });
  it('note de littérature : prouvé vs meilleur connu', () => {
    expect(isProven(5)).toBe(true); expect(isProven(11)).toBe(false); expect(BEST[5]).toBeCloseTo(2.7071, 4);
    expect(maxKnownCount(2.7072)).toBe(5); expect(maxKnownCount(3.7072)).toBe(10); expect(maxKnownCount(2.5)).toBe(4);
    const inst = buildInstance({ W: 3, H: 3, items: Array.from({ length: 9 }, (_, i) => ({ id: i, side: 1 })) });
    expect(literatureNote(inst, { placed: 9 }).knownCount).toBe(9);
    expect(literatureNote(buildInstance({ W: 3, H: 4, items: [{ id: 0, side: 1 }] }), { placed: 1 })).toBeNull();
  });
});

describe('exports', () => {
  it('SVG et JSON contiennent la disposition et le certificat', () => {
    const inst = buildInstance({ W: 3, H: 2, items: [{ id: 0, side: 1 }, { id: 1, side: 1 }] });
    const L = [{ id: 0, x: .5, y: .5, side: 1, theta: 0 }, { id: 1, x: 1.5, y: .5, side: 1, theta: .3 }];
    const svg = layoutToSvg(inst, L); expect((svg.match(/<polygon/g) || []).length).toBe(2); expect(svg.startsWith('<svg')).toBe(true);
    const js = JSON.parse(resultToJson({ config: { seed: 1 }, instance: inst, placements: L, stats: {}, classification: {}, algorithm: 'x' }));
    expect(js.placements).toHaveLength(2); expect(js.certificate.exactSAT).toBe(true); expect(js.format).toContain('square-packing-lab');
  });
});
