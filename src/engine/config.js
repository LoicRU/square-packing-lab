/**
 * Configuration : valeurs par défaut, limites, normalisation et validation.
 * Fonction pure : aucune dépendance au DOM ni au framework.
 */
export const ALGORITHM_IDS = ['circle2square', 'maxrects', 'guillotine', 'skyline', 'anneal', 'forces', 'shelf'];

export const SIZE_PRESETS = {
  fibonacci: { label: 'Fibonacci (1, 1, 2, 3, 5, 8)', sizes: [1, 1, 2, 3, 5, 8] },
  powers: { label: 'Puissances de 2 (1, 2, 4, 8)', sizes: [1, 2, 4, 8] },
  pythagoras: { label: 'Mélange 3 · 4 · 5', sizes: [3, 4, 5] },
  harmonic: { label: 'Harmonique (1, ½, ⅓, ¼ … ×6)', sizes: [6, 3, 2, 1.5, 1.2, 1] },
  custom: { label: 'Personnalisé', sizes: [] },
};

export const LIMITS = { maxN: 1000, hardMaxN: 5000, minDim: 0.05, maxDim: 10000, maxIterations: 200000 };

export const DEFAULT_CONFIG = {
  problem: 'maxsize', // 'maxsize' : N carrés identiques, taille maximale · 'pack' : packing général (hétérogène)
  msStrategy: 'pipeline', // 'pipeline' | 'full' | 'anneal' | 'circle'
  msIterations: 0, // 0 = automatique (selon N)
  n: 50,
  containerMode: 'square', // 'square' | 'rect'
  W: 20,
  H: 20,
  sizeMode: 'random', // 'identical' | 'random' | 'preset'
  sMin: 1,
  sMax: 2.5,
  presetId: 'fibonacci',
  presetSizes: [1, 1, 2, 3, 5, 8],
  rotation: false,
  algorithm: 'maxrects',
  seed: 42,
  iterations: 3000,
  options: {
    maxrects: { heuristic: 'bssf', sort: 'desc' },
    guillotine: { choice: 'baf', split: 'slas', merge: true, sort: 'desc' },
    skyline: { heuristic: 'bl', sort: 'desc' },
    shelf: { sort: 'desc' },
    anneal: { init: 'random' },
    forces: { init: 'random' },
  },
  c2s: { transform: 'optimized', lambda: 0.5, radiusSearch: false, relaxer: 'forces' },
  limits: { maxN: LIMITS.maxN },
};

const num = (v, d) => { const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return Number.isFinite(x) ? x : d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Parse une liste de tailles « 3, 2, 2.5 » → [3,2,2.5] (valeurs ≤ 0 ignorées). */
export function parseSizeList(text) {
  return String(text ?? '').split(/[\s,;]+/).map((s) => parseFloat(s.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0);
}

/**
 * Normalise une configuration brute (formulaire, URL, fichier JSON).
 * Retourne { config, warnings } : jamais d'exception, toujours une config utilisable.
 */
export function normalizeConfig(raw = {}) {
  const d = DEFAULT_CONFIG, warnings = [];
  const c = JSON.parse(JSON.stringify(d));
  const maxN = clamp(Math.round(num(raw.limits?.maxN, LIMITS.maxN)), 10, LIMITS.hardMaxN);
  c.limits = { maxN };

  c.problem = raw.problem === 'pack' ? 'pack' : 'maxsize';
  c.msStrategy = ['pipeline', 'full', 'anneal', 'circle'].includes(raw.msStrategy) ? raw.msStrategy : 'pipeline';
  c.n = Math.round(num(raw.n, d.n));
  if (c.n > maxN) { warnings.push(`n limité à ${maxN} (limite configurable)`); c.n = maxN; }
  if (c.n < 1) { warnings.push('n doit être ≥ 1'); c.n = 1; }

  c.containerMode = c.problem === 'maxsize' || raw.containerMode !== 'rect' ? 'square' : 'rect';
  c.W = clamp(num(raw.W, d.W), LIMITS.minDim, LIMITS.maxDim);
  c.H = c.containerMode === 'square' ? c.W : clamp(num(raw.H, d.H), LIMITS.minDim, LIMITS.maxDim);

  c.sizeMode = ['identical', 'random', 'preset'].includes(raw.sizeMode) ? raw.sizeMode : d.sizeMode;
  c.sMin = clamp(num(raw.sMin, d.sMin), LIMITS.minDim, LIMITS.maxDim);
  c.sMax = clamp(num(raw.sMax, d.sMax), LIMITS.minDim, LIMITS.maxDim);
  if (c.sMin > c.sMax) { warnings.push('taille min > max : valeurs échangées'); [c.sMin, c.sMax] = [c.sMax, c.sMin]; }
  c.presetId = SIZE_PRESETS[raw.presetId] ? raw.presetId : d.presetId;
  const custom = Array.isArray(raw.presetSizes) ? raw.presetSizes.map((x) => num(x, NaN)).filter((x) => x > 0) : [];
  c.presetSizes = c.presetId === 'custom' ? (custom.length ? custom : [1, 2]) : SIZE_PRESETS[c.presetId].sizes.slice();

  c.rotation = c.problem === 'maxsize' ? true : !!raw.rotation;
  c.msIterations = Math.round(clamp(num(raw.msIterations, 0), 0, 2000000));
  c.algorithm = ALGORITHM_IDS.includes(raw.algorithm) ? raw.algorithm : d.algorithm;
  c.seed = Math.round(num(raw.seed, d.seed)) | 0;
  c.iterations = Math.round(clamp(num(raw.iterations, d.iterations), 1, LIMITS.maxIterations));
  for (const k of Object.keys(d.options)) c.options[k] = { ...d.options[k], ...(raw.options?.[k] || {}) };
  c.c2s = { ...d.c2s, ...(raw.c2s || {}) };
  c.c2s.lambda = clamp(num(c.c2s.lambda, 0.5), 0, 1);
  if (!['inscribed', 'circumscribed', 'optimized'].includes(c.c2s.transform)) c.c2s.transform = 'optimized';
  if (!['forces', 'anneal'].includes(c.c2s.relaxer)) c.c2s.relaxer = 'forces';
  c.c2s.radiusSearch = !!c.c2s.radiusSearch;
  return { config: c, warnings };
}

/** Encodage compact d'une config pour l'URL (partage). */
export const encodeConfig = (cfg) => btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
export function decodeConfig(str) {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch { return null; }
}

/** Budget d'itérations (balayages) pour le problème « taille maximale » : environ 4 millions de mouvements. */
export const msIterationsFor = (cfg) => (cfg.msIterations > 0 ? cfg.msIterations : Math.min(400000, Math.max(5000, Math.round(4e6 / Math.max(1, cfg.n)))));
