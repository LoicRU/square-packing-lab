/**
 * Contrôleur de l'interface du simulateur : relie formulaire, worker (moteur),
 * rendu, statistiques, graphiques, comparaison et expériences.
 * Aucun calcul de packing ici ; les statistiques affichées viennent du moteur
 * (et la disposition finale est re-validée exactement côté interface).
 */
import { EngineClient } from './client.js';
import { SceneRenderer } from '../render/renderer.js';
import { LineChart } from '../render/charts.js';
import { ALGORITHMS } from '../algorithms/registry.js';
import { ALGORITHM_IDS, SIZE_PRESETS, normalizeConfig, parseSizeList, encodeConfig, decodeConfig, DEFAULT_CONFIG } from '../engine/config.js';
import { validateLayout } from '../engine/validate.js';
import { computeStats } from '../engine/stats.js';
import { classify } from '../engine/classify.js';
import { layoutToSvg, resultToJson } from '../engine/export.js';
import { initA11y } from './a11y.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 50, Infinity];
const ALGO_COLORS = { circle2square: '#6ab0ff', maxrects: '#ff6a3d', guillotine: '#f0a830', skyline: '#7bd88f', anneal: '#c58cff', forces: '#4fd1c5', shelf: '#8a877d' };
const N_PRESETS = [5, 10, 25, 50, 100, 250, 500, 1000];
const fmt = {
  pct: (v) => `${(v * 100).toFixed(2)} %`,
  ms: (v) => (v < 1000 ? `${v.toFixed(v < 10 ? 1 : 0)} ms` : `${(v / 1000).toFixed(2)} s`),
  n: (v) => new Intl.NumberFormat('fr-FR').format(v),
};
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

/* ------------------------------------------------------------------ état */
const S = {
  state: 'idle', // idle | running | paused | done
  view: 'live', // live | cmp
  instance: null, config: null, last: null, lastDone: null, speedIdx: 2,
  best: lsGet('spl.best', {}), cmp: {}, study: {}, busy: null,
};
const client = new EngineClient();
const renderer = new SceneRenderer($('scene'), $('stageWrap'), {
  onCoords: (x, y) => { $('coords').textContent = x == null ? 'molette : zoom · glisser : déplacer · double-clic : centrer' : `x = ${x.toFixed(3)}   y = ${y.toFixed(3)}`; },
});
const pctF = (v) => `${v.toFixed(0)}%`;
const charts = {
  fill: new LineChart($('chFill'), { series: [{ key: 'v', color: '#ff6a3d' }], yFormat: pctF, yMax: 100 }),
  placed: new LineChart($('chPlaced'), { series: [{ key: 'v', color: '#7bd88f' }], yFormat: (v) => v.toFixed(0) }),
  coll: new LineChart($('chColl'), { series: [{ key: 'v', color: '#ff5262' }], yFormat: (v) => v.toFixed(0) }),
  prog: new LineChart($('chProg'), { series: [{ key: 'v', color: '#6ab0ff' }, { key: 'best', color: '#f0a830' }], yFormat: pctF, yMax: 100 }),
};
const scCharts = {
  fill: new LineChart($('chScFill'), { series: ALGORITHM_IDS.map((k) => ({ key: k, color: ALGO_COLORS[k] })), yFormat: pctF, yMax: 100, xLabel: 'n' }),
  time: new LineChart($('chScTime'), { series: ALGORITHM_IDS.map((k) => ({ key: k, color: ALGO_COLORS[k] })), yFormat: (v) => v.toFixed(0), xLabel: 'n', log: true }),
};

/* ------------------------------------------------------------- erreurs */
function showError(msg) {
  const b = $('errBanner'); b.textContent = `Erreur : ${String(msg).split('\n')[0]}`; b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), 9000);
  console.error(msg);
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason?.message || e.reason));
client.on('error', (m) => { showError(m.message); setState('idle'); });

/* ------------------------------------------------------------ formulaire */
const radio = (name) => document.querySelector(`input[name=${name}]:checked`)?.value;
const setRadio = (name, v) => { const el = document.querySelector(`input[name=${name}][value=${v}]`); if (el) el.checked = true; };
const val = (id) => $(id).value;

const isMs = () => (radio('problem') || 'maxsize') === 'maxsize';
const isPipe = () => !!S.config && S.config.problem === 'maxsize' && S.config.msStrategy === 'pipeline';
const pipeSelected = () => isMs() && val('msStrategy') === 'pipeline';
function readForm() {
  if (isMs()) return { problem: 'maxsize', n: val('n'), W: val('msW'), seed: val('msSeed'), msStrategy: val('msStrategy'), msIterations: val('msIter') || 0, limits: { maxN: val('maxN') } };
  const presetId = val('presetId');
  return {
    problem: 'pack',
    n: val('n'), sizeMode: radio('sizeMode'), sMin: val('sMin'), sMax: val('sMax'),
    presetId, presetSizes: presetId === 'custom' ? parseSizeList(val('presetSizes')) : undefined,
    containerMode: radio('containerMode'), W: val('W'), H: val('H'),
    rotation: $('rotation').checked, algorithm: val('algorithm'), iterations: val('iterations'), seed: val('seed'),
    options: {
      maxrects: { heuristic: val('o-mr-h') },
      guillotine: { choice: val('o-g-c'), split: val('o-g-s'), merge: $('o-g-m').checked },
      skyline: { heuristic: val('o-s-h') },
      anneal: { init: val('o-c-i') }, forces: { init: val('o-c-i') },
    },
    c2s: { transform: val('o-t'), lambda: parseFloat(val('o-l')), radiusSearch: $('o-rs').checked, relaxer: val('o-rx') },
    limits: { maxN: val('maxN') },
  };
}
function writeForm(c) {
  setRadio('problem', c.problem || 'maxsize'); $('msW').value = c.W; $('msSeed').value = c.seed; $('msStrategy').value = c.msStrategy || 'pipeline'; $('msIter').value = c.msIterations || '';
  $('n').value = c.n; $('nRange').value = Math.min(1000, c.n);
  setRadio('sizeMode', c.sizeMode); $('sMin').value = c.sMin; $('sMax').value = c.sMax;
  $('presetId').value = c.presetId; if (c.presetId === 'custom') $('presetSizes').value = c.presetSizes.join(', ');
  setRadio('containerMode', c.containerMode); $('W').value = c.W; $('H').value = c.H;
  $('rotation').checked = !!c.rotation; $('algorithm').value = c.algorithm; $('iterations').value = c.iterations; $('seed').value = c.seed;
  $('o-mr-h').value = c.options.maxrects.heuristic; $('o-g-c').value = c.options.guillotine.choice; $('o-g-s').value = c.options.guillotine.split;
  $('o-g-m').checked = !!c.options.guillotine.merge; $('o-s-h').value = c.options.skyline.heuristic;
  $('o-c-i').value = (c.algorithm === 'forces' ? c.options.forces : c.options.anneal).init || 'random';
  $('o-t').value = c.c2s.transform; $('o-l').value = c.c2s.lambda; $('o-rs').checked = !!c.c2s.radiusSearch; $('o-rx').value = c.c2s.relaxer;
  $('maxN').value = c.limits.maxN;
  syncVisibility();
}
const PROBLEM_NOTES = {
  maxsize: 'Problème : placer N carrés identiques (rotation libre) dans un grand carré en maximisant leur côté commun.',
  pack: 'Ancien mode : packing de carrés de tailles variées, objectif = maximiser la surface placée.',
};
const STRAT_NOTES = {
  pipeline: 'Cinq phases réellement calculées et enregistrées : 1 génération de cercles aléatoires, 2 Circle Packing (formation puis compaction), 3 transformation cercle → carré (inscrit, ×√2), 4 Square Packing (dichotomie + recuit + mouvements de groupe + places libres NFP), 5 optimisation finale (pool de solutions valides, perturbations). Le calcul tourne à pleine vitesse ; la vitesse règle seulement la lecture.',
  full: 'Réseau k×k comme borne haute valide → recherche dichotomique sur la taille → recuit simulé sur positions et angles, compression de la meilleure solution, départs multiples, déplacement du carré le plus contraint vers le meilleur trou, projection finale exacte.',
  anneal: 'Mêmes mouvements de recuit, mais uniquement des départs indépendants (aléatoire, réseaux décalés / tournés, hexagonal), sans compression progressive de la meilleure solution.',
  circle: 'Expérimental : centres d’un empilement hexagonal de disques → carrés inscrits d’orientations quelconques, puis la même relaxation. Aucune garantie d’optimalité.',
};
function syncProblem() {
  const ms = isMs();
  for (const [id, show] of [['msCfg', ms], ['cmpMs', ms], ['expMs', ms], ['legacyCfg', !ms], ['legacyExpert', !ms], ['cmpLegacy', !ms], ['expLegacy', !ms]]) $(id).hidden = !show;
  $('problemNote').textContent = PROBLEM_NOTES[ms ? 'maxsize' : 'pack']; $('msNote').textContent = STRAT_NOTES[val('msStrategy')] || '';
  for (const e of document.querySelectorAll('.pipeOnly')) e.hidden = !pipeSelected(); if (!pipeSelected()) $('player').hidden = true;
  $('tLabels').textContent = ms ? 'Angles' : 'Dimensions'; $('anglesBox').hidden = !ms;
  renderer.setOptions({ labelMode: ms ? 'angle' : 'side', colorBy: ms ? 'angle' : 'size' });
  const titles = ms ? ['Taux de remplissage', 'Côté du conteneur S (en côtés de carré)', 'Collisions de la tentative', 'Énergie de la tentative (×10⁻⁴)'] : ['Taux de remplissage', 'Carrés placés', 'Collisions', 'Progression de l\'optimisation'];
  document.querySelectorAll('.charts .chart h3').forEach((h, i) => { h.firstChild.textContent = titles[i] + ' '; });
  for (const c of Object.values(charts)) c.clear();
}
function syncVisibility() {
  syncProblem();
  const mode = radio('sizeMode'), rect = radio('containerMode') === 'rect', algo = val('algorithm'), preset = val('presetId');
  $('sizeRange').hidden = mode === 'preset'; $('presetBox').hidden = mode !== 'preset'; $('customSizesBox').hidden = preset !== 'custom';
  $('sMinLbl').textContent = mode === 'identical' ? 'Côté commun' : 'Taille min'; $('sMax').closest('label').hidden = mode === 'identical';
  $('hBox').hidden = !rect; $('wLbl').textContent = rect ? 'Largeur' : 'Côté';
  const show = { maxrects: algo === 'maxrects', guillotine: algo === 'guillotine', skyline: algo === 'skyline', continuous: algo === 'anneal' || algo === 'forces', c2s: algo === 'circle2square' };
  for (const [k, v] of Object.entries(show)) $(`opt-${k}`).hidden = !v;
  $('lamBox').hidden = val('o-t') !== 'optimized'; $('lamV').textContent = parseFloat(val('o-l')).toFixed(2);
  const a = ALGORITHMS[algo]; $('algoNote').textContent = `${a.family} · ${a.summary} Complexité ${a.complexity}. Rotation : ${a.rotation}.`;
  $('rotation').disabled = a.kind === 'constructif';
  if (a.kind === 'constructif') $('rotation').checked = false;
  $('maxN').closest('label').hidden = false;
}

/* ------------------------------------------------------------- init UI */
for (const n of N_PRESETS) {
  const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = n; b.onclick = () => { $('n').value = n; $('nRange').value = n; scheduleInit(); };
  $('nChips').append(b);
}
for (const [id, p] of Object.entries(SIZE_PRESETS)) $('presetId').append(new Option(p.label, id));
for (const id of ALGORITHM_IDS) $('algorithm').append(new Option(ALGORITHMS[id].name, id));
$('algorithm').value = DEFAULT_CONFIG.algorithm;
for (const id of ALGORITHM_IDS) {
  const b = document.createElement('button'); b.className = 'chip on'; b.type = 'button'; b.dataset.id = id; b.textContent = ALGORITHMS[id].name;
  b.onclick = () => b.classList.toggle('on'); $('cmpAlgos').append(b);
}
$('scLeg').innerHTML = ALGORITHM_IDS.map((k) => `<span><i style="background:${ALGO_COLORS[k]}"></i>${ALGORITHMS[k].name}</span>`).join('');

let initTimer = null;
function scheduleInit() { syncVisibility(); clearTimeout(initTimer); initTimer = setTimeout(initEngine, 180); }
for (const el of document.querySelectorAll('.cfg input, .cfg select')) {
  if (['cfgName', 'savedCfgs', 'fImportCfg'].includes(el.id) || el.id.startsWith('lp-')) continue;
  el.addEventListener('input', () => { if (el.id === 'nRange') $('n').value = el.value; if (el.id === 'n') $('nRange').value = Math.min(1000, el.value || 1); scheduleInit(); });
}
$('bDice').onclick = () => { $('seed').value = Math.floor(Math.random() * 1e6); scheduleInit(); };
$('bDice2').onclick = () => { $('msSeed').value = Math.floor(Math.random() * 1e6); scheduleInit(); };
$('bSeed').onclick = () => { const id = isMs() ? 'msSeed' : 'seed'; $(id).value = Math.floor(Math.random() * 1e6); initEngine(); };

/* ----------------------------------------------------------- moteur ↔ UI */
function initEngine() {
  clearTimeout(initTimer);
  S.view = 'live'; $('bBackLive').hidden = true; S.lastDone = null;
  client.init(readForm());
}
client.on('ready', (m) => {
  S.config = m.config; S.instance = m.instance; S.state = 'idle'; S.msS = Math.ceil(Math.sqrt(m.instance.n));
  renderer.setInstance({ W: m.instance.W, H: m.instance.H, minSide: m.instance.minSide, maxSide: m.instance.maxSide });
  renderer.setScene({});
  for (const c of Object.values(charts)) c.clear();
  setState('idle'); resetStats(m); $('angTable').tBodies[0].innerHTML = ''; $('angCount').textContent = '';
  const notes = [...m.warnings.map((w) => ({ level: 'info', text: w })), ...m.diagnostics];
  $('diagBox').innerHTML = notes.map((d) => `<p class="note ${d.level === 'error' ? 'err' : 'info'}">${esc(d.text)}</p>`).join('');
  $('phaseTag').textContent = S.config.problem === 'maxsize' ? `Réseau ${Math.ceil(Math.sqrt(m.instance.n))}×${Math.ceil(Math.sqrt(m.instance.n))} (borne haute valide) — appuyez sur Démarrer` : 'En attente — appuyez sur Démarrer';
  // les champs reflètent la config normalisée (valeurs corrigées/bornées)
  if (m.warnings.length) { $('n').value = m.config.n; $('nRange').value = Math.min(1000, m.config.n); $('sMin').value = m.config.sMin; $('sMax').value = m.config.sMax; }
  $('zoomInfo').textContent = `${m.instance.n} carrés · ${m.instance.W}×${m.instance.H}`;
  P.reset(); consumeImport();
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function resetStats(m) {
  const i = m.instance;
  const k0 = Math.ceil(Math.sqrt(i.n));
  renderMetrics({ placed: 0, unplaced: i.n, placedArea: 0, fill: S.config.problem === 'maxsize' ? i.n / (k0 * k0) : 0, wasted: 1, collisions: 0, iteration: 0, computeMs: 0 }, { S: k0 });
  setBadges(null); $('litBox').innerHTML = ''; $('classBox').innerHTML = '';
  $('bigFill').textContent = '0 %'; $('fillBar').style.width = '0%'; showBest();
}
function renderMsMetrics(s, x = {}) {
  const i = S.instance, b = S.best[instanceKey()], W = S.config.W, Sb = x.S ?? S.msS ?? Math.ceil(Math.sqrt(i.n));
  const cells = [
    ['Taille optimale trouvée', (W / Sb).toPrecision(5), 'hl'], ['Rapport a / W', (1 / Sb).toFixed(5)], ['Côté conteneur S (en côtés)', Sb.toFixed(4)],
    ['Remplissage', fmt.pct(s.fill), 'hl'], ['Carrés placés', `${i.n} / ${i.n}`, 'good'], ['Collisions (solution)', '0', 'good'],
    ['Itérations (balayages)', fmt.n(s.iteration)], ['Temps de calcul', fmt.ms(s.computeMs)], ['Cible en cours', x.target ? x.target.toFixed(4) : '—'],
    ['Collisions (tentative)', x.working ? fmt.n(x.attemptColl ?? 0) : '—', x.working && x.attemptColl ? 'bad' : ''], ['Énergie (tentative)', x.working ? (x.attemptE ?? 0).toExponential(2) : '—'],
    ['Tentatives (réussies)', x.attempt !== undefined ? `${x.attempt} (${x.successes ?? 0})` : '—'], ['Limite explorée', x.lo ? x.lo.toFixed(4) : '—'], ['Meilleur (session)', b ? fmt.pct(b.fill) : '—'],
  ];
  $('metrics').innerHTML = cells.map(([k, v, c]) => `<div class="metric ${c || ''}"><span>${k}</span><b>${v}</b></div>`).join('');
  $('bigFill').textContent = fmt.pct(s.fill); $('fillBar').style.width = `${Math.min(100, s.fill * 100)}%`;
}
function renderMetrics(s, x) {
  if (S.config && S.config.problem === 'maxsize') return renderMsMetrics(s, x);
  const i = S.instance, b = S.best[instanceKey()];
  const cells = [
    ['Demandés', fmt.n(i.n)], ['Placés', fmt.n(s.placed), s.unplaced === 0 && i.n ? 'good' : ''], ['Non placés', fmt.n(s.unplaced), s.unplaced ? 'hl' : ''],
    ['Aire des carrés (demandée)', i.totalArea.toFixed(2)], ['Aire du conteneur', i.containerArea.toFixed(2)], ['Aire placée', s.placedArea.toFixed(2)],
    ['Remplissage', fmt.pct(s.fill), 'hl'], ['Espace perdu', fmt.pct(s.wasted)], ['Collisions', fmt.n(s.collisions), s.collisions ? 'bad' : 'good'],
    ['Itérations', fmt.n(s.iteration)], ['Temps de calcul', fmt.ms(s.computeMs)], ['Meilleur (session)', b ? fmt.pct(b.fill) : '—'],
  ];
  $('metrics').innerHTML = cells.map(([k, v, c]) => `<div class="metric ${c || ''}"><span>${k}</span><b>${v}</b></div>`).join('');
  $('bigFill').textContent = fmt.pct(s.fill); $('fillBar').style.width = `${Math.min(100, s.fill * 100)}%`;
}
function instanceKey() {
  const c = S.config; if (!c) return '';
  if (c.problem === 'maxsize') return JSON.stringify(['ms', c.n]);
  return JSON.stringify([c.n, c.W, c.H, c.sizeMode, c.sMin, c.sMax, c.presetSizes, c.seed, c.rotation]);
}
function showBest() {
  const b = S.best[instanceKey()];
  $('bestBox').innerHTML = b ? `<p class="note ok">Meilleur résultat de cette session sur cette instance : <b>${fmt.pct(b.fill)}</b> (${esc(b.algo)}, ${b.placed} carrés).</p>` : '';
}

function setBadges(cls, isBest) {
  const sb = $('statusBadge'), vb = $('validBadge');
  const labels = { idle: 'Prêt', running: 'Calcul en cours', paused: 'En pause', done: 'Terminé' };
  sb.textContent = labels[S.state]; sb.className = `badge ${S.state === 'running' ? 'info' : S.state === 'done' ? 'ok' : ''}`;
  if (!cls) { vb.hidden = true; return; }
  vb.hidden = false;
  const map = { invalid: ['bad', 'Invalide'], valid: ['warn', 'Valide · heuristique'], optimal: ['ok', 'Optimale prouvée'] };
  vb.className = `badge ${map[cls.status][0]}`; vb.textContent = (isBest ? '★ Meilleure trouvée · ' : '') + map[cls.status][1];
}
function setState(s) {
  S.state = s;
  const play = $('bPlay');
  play.textContent = s === 'running' ? '❚❚ Pause' : s === 'paused' ? '▶ Reprendre' : s === 'done' ? '▶ Relancer' : '▶ Démarrer';
  $('bStop').disabled = !(s === 'running' || s === 'paused'); $('bStep').disabled = s === 'done';
  if (s !== 'done') setBadges(null); else setBadges(S.lastDone?.classification, S.lastDone?.isBest);
  $('statusBadge').textContent = { idle: 'Prêt', running: 'Calcul en cours', paused: 'En pause', done: 'Terminé' }[s];
  $('statusBadge').className = `badge ${s === 'running' ? 'info' : s === 'done' ? 'ok' : ''}`;
}

client.on('snapshot', (m) => {
  if (S.state === 'done' && S.view === 'cmp') return;
  S.last = m;
  if (S.view === 'live') renderer.setScene({ sq: m.sq, circ: m.circ, morph: m.morph });
  $('phaseTag').textContent = m.label ? `${m.label}${m.stats.stage ? ' · ' + m.stats.stage : ''}` : '';
  const s = m.stats;
  if (S.config.problem === 'maxsize') { S.msS = m.extra.S; return snapshotMs(m); }
  renderMetrics(s);
  const it = s.iteration;
  charts.fill.push(it, { v: s.fill * 100 }); charts.placed.push(it, { v: s.placed }); charts.coll.push(it, { v: s.collisions });
  const bestSoFar = Math.max(s.fill * 100, charts.prog.data.length ? charts.prog.data[charts.prog.data.length - 1].best : 0);
  charts.prog.push(it, { v: (s.progress ?? 0) * 100, best: bestSoFar });
  $('chv1').textContent = fmt.pct(s.fill); $('chv2').textContent = `${s.placed}/${S.instance.n}`; $('chv3').textContent = s.collisions; $('chv4').textContent = `${((s.progress ?? 0) * 100).toFixed(0)} %`;
});

function snapshotMs(m) {
  const s = m.stats, x = m.extra, it = s.iteration;
  renderMsMetrics(s, x);
  charts.fill.push(it, { v: s.fill * 100 }); charts.placed.push(it, { v: x.S }); charts.coll.push(it, { v: x.working ? x.attemptColl : 0 });
  charts.prog.push(it, { v: Math.log10(1 + (x.attemptE || 0) * 1e4) * 20, best: 0 });
  $('chv1').textContent = fmt.pct(s.fill); $('chv2').textContent = x.S.toFixed(4); $('chv3').textContent = x.working ? x.attemptColl : 0; $('chv4').textContent = (x.attemptE || 0).toExponential(1);
}
function toPlacements(arr) {
  const out = []; for (let i = 0; i < arr.length; i += 6) out.push({ id: arr[i], x: arr[i + 1], y: arr[i + 2], side: arr[i + 3], theta: arr[i + 4] });
  return out;
}
client.on('done', (m) => {
  if (m.problem === 'maxsize') return doneMs(m);
  // re-validation exacte côté interface (indépendante du worker)
  const pl = toPlacements(m.sq), v = validateLayout(pl, S.instance.W, S.instance.H);
  if (!v.valid) showError(`La disposition finale n'a pas passé la re-validation (${v.pairs.length} collisions). Résultat marqué invalide.`);
  const stats = v.valid ? m.stats : { ...m.stats, valid: false, collisions: v.pairs.length };
  const cls = v.valid ? m.classification : classify({ ...S.instance, n: S.instance.n }, stats);
  const key = instanceKey(), prev = S.best[key];
  const isBest = v.valid && (!prev || stats.fill > prev.fill + 1e-12 || prev.algo === ALGORITHMS[m.algorithm].name);
  if (v.valid && (!prev || stats.fill > prev.fill + 1e-12)) { S.best[key] = { fill: stats.fill, algo: ALGORITHMS[m.algorithm].name, placed: stats.placed }; lsSet('spl.best', S.best); }
  S.lastDone = { ...m, stats, classification: cls, isBest: v.valid && S.best[key].algo === ALGORITHMS[m.algorithm].name && Math.abs(S.best[key].fill - stats.fill) < 1e-12, placements: pl };
  if (S.view === 'live') renderer.setScene({ sq: m.sq });
  setState('done'); renderMetrics({ ...stats, computeMs: stats.elapsedMs, iteration: stats.iterations });
  const last = charts.fill.data.length ? charts.fill.data[charts.fill.data.length - 1].x : 0;
  charts.fill.push(last + 1, { v: stats.fill * 100 }); charts.placed.push(last + 1, { v: stats.placed }); charts.coll.push(last + 1, { v: 0 });
  charts.prog.push(last + 1, { v: 100, best: stats.fill * 100 });
  $('phaseTag').textContent = 'Terminé';
  $('classBox').innerHTML = `<p class="note ${cls.status === 'invalid' ? 'err' : cls.status === 'optimal' ? 'ok' : 'info'}"><b>${esc(cls.label)}</b> — ${esc(cls.detail)}</p>` +
    (m.rejected?.length ? `<p class="note">${m.rejected.length} objet(s) non retenu(s) par l'algorithme.</p>` : '');
  $('litBox').innerHTML = m.literature ? `<p class="note info">${esc(m.literature.text)}</p>` : '';
  if (m.analysis) {
    const a = m.analysis;
    $('litBox').innerHTML += `<p class="note info"><b>Circle → Square</b> — λ = ${a.lambda?.toFixed?.(2) ?? a.lambda} · ${a.circlesPlaced} disques posés · après transformation brute : ${a.rawCollisions} collision(s), ${a.rawOob} sortie(s), surface certifiée ${(a.rawCertifiedArea / S.instance.containerArea * 100).toFixed(2)} % ; après ré-optimisation : ${fmt.pct(stats.fill)}.</p>`;
  }
  showBest();
});

function deg90(t) { return ((((t * 180) / Math.PI) % 90) + 90) % 90; }
function doneMs(m) {
  const pl = toPlacements(m.sq), W = S.config.W, v = validateLayout(pl, W, W), a = m.analysis;
  if (!v.valid) showError(`La solution finale n'a pas passé la re-validation (${v.pairs.length} collisions).`);
  const stats = v.valid ? m.stats : { ...m.stats, valid: false, collisions: v.pairs.length };
  const cls = v.valid ? m.classification : { status: 'invalid', label: 'Invalide', detail: 'Échec de la re-validation exacte.' };
  const key = instanceKey(), prev = S.best[key], fill = stats.fill;
  const improved = v.valid && (!prev || fill > prev.fill + 1e-12);
  if (improved) { S.best[key] = { fill, algo: `${STRAT_NAMES[m.strategy]}, graine ${S.config.seed}`, placed: stats.placed }; lsSet('spl.best', S.best); }
  const isBest = v.valid && Math.abs((S.best[key]?.fill ?? -1) - fill) < 1e-12;
  S.lastDone = { ...m, stats, classification: cls, isBest, placements: pl }; S.msS = a.S;
  if (S.view === 'live' && !isPipe()) renderer.setScene({ sq: m.sq });
  if (isPipe()) P.onDone(m); else setState('done'); renderMsMetrics({ ...stats, computeMs: stats.elapsedMs, iteration: stats.iterations }, { S: a.S, lo: a.lo, attempt: a.attempts, successes: a.successes });
  const last = charts.fill.data.length ? charts.fill.data[charts.fill.data.length - 1].x : 0;
  charts.fill.push(last + 1, { v: fill * 100 }); charts.placed.push(last + 1, { v: a.S }); charts.coll.push(last + 1, { v: 0 }); charts.prog.push(last + 1, { v: 0, best: 0 });
  if (!isPipe()) $('phaseTag').textContent = `Terminé · ${a.stopReason || ''}`;
  $('classBox').innerHTML = `<p class="note ${cls.status === 'invalid' ? 'err' : cls.status === 'optimal' ? 'ok' : 'info'}"><b>${esc(cls.label)}</b> — ${esc(cls.detail)}</p>`;
  $('litBox').innerHTML = (m.literature ? `<p class="note info">${esc(m.literature.text)}</p>` : '') +
    `<p class="note">Intervalle exploré : ${a.lo.toFixed(4)} ≤ S ≤ ${a.S.toFixed(4)} (la borne basse est la borne de surface √N ou la dernière cible non atteinte : <b>ce n’est pas une preuve d’impossibilité</b>). ${a.attempts} tentatives, ${a.successes} réussies. Précision numérique ≈ ${a.tolerance.toExponential(1)}.</p>`;
  fillAngles(pl, W);
  if (isPipe()) P.report(m, pl, W, stats);
  addAttempt({ strategy: m.strategy, seed: S.config.seed, S: a.S, W, fill, iterations: stats.iterations, ms: stats.elapsedMs, status: cls.status, sq: m.sq, source: 'manuel' });
  showBest();
}
const STRAT_NAMES = { import: 'Parallel Lab', pipeline: 'Pipeline', full: 'Complet', anneal: 'Recuit seul', circle: 'Circle→Square' };
function fillAngles(pl, W) {
  $('angCount').textContent = `(${pl.length})`;
  $('angTable').tBodies[0].innerHTML = pl.map((p) => `<tr><td>${p.id + 1}</td><td>${(p.x / W).toFixed(4)}</td><td>${(p.y / W).toFixed(4)}</td><td>${deg90(p.theta).toFixed(2)}°</td></tr>`).join('');
}

/* ---- ouverture d'une solution du Parallel Packing Lab (localStorage 'spl.import') ---- */
let pendingImport = new URLSearchParams(location.search).get('import') === '1' ? lsGet('spl.import', null) : null;
if (pendingImport) { $('n').value = pendingImport.n; $('nRange').value = Math.min(1000, pendingImport.n); $('msW').value = pendingImport.W; }
function consumeImport() {
  const imp = pendingImport; if (!imp || !isMs() || S.config.n !== imp.n) return; pendingImport = null;
  const sq = Float64Array.from(imp.sq), pl = toPlacements(sq), v = validateLayout(pl, imp.W, imp.W);
  addAttempt({ strategy: 'import', seed: '—', S: imp.S, W: imp.W, fill: imp.n / (imp.S * imp.S), iterations: 0, ms: 0, status: v.valid ? 'valid' : 'invalid', sq, source: 'import' });
  fillAngles(pl, imp.W); $('litBox').innerHTML = `<p class="note ${v.valid ? 'ok' : 'err'}"><b>${esc(imp.label)}</b> — revalidé dans le navigateur (SAT exact) : ${v.valid ? 'valide' : 'INVALIDE'} · S = ${imp.S.toFixed(5)} · remplissage ${(imp.n / imp.S ** 2 * 100).toFixed(3)} %. Importé tel quel : aucune optimalité prouvée.</p>`;
  document.querySelector('.tabs button[data-tab=cmp]')?.click(); preview(sq, imp.label);
}

/* ------------------------------------------- lecteur du pipeline (images clés réelles) */
const PHASE_NAMES = ['Génération', 'Circle Packing', 'Transformation', 'Square Packing', 'Optimisation finale'];
const P = {
  frames: [], idx: 0, playing: false, follow: false, computeDone: false, raf: 0, lastT: 0, acc: 0, freeBusy: false, freeCache: null, lastPhaseHtml: '',
  reset() {
    cancelAnimationFrame(this.raf); this.frames = []; this.idx = 0; this.playing = false; this.follow = false; this.computeDone = false; this.freeCache = null; this.freeBusy = false;
    $('player').hidden = !isPipe(); $('phaseBox').hidden = true; $('phaseTable').tBodies[0].innerHTML = ''; $('phaseNotes').innerHTML = ''; $('verifyBox').innerHTML = '';
    if (isPipe()) { this.buildTimeline(); this.syncUi(); this.showHist(); }
  },
  buildTimeline() {
    $('timeline').innerHTML = PHASE_NAMES.map((n, i) => `<button class="seg todo" type="button" data-p="${i}" role="tab"><b>${i + 1} · ${n}</b><span>—</span><i></i></button>`).join('');
    for (const b of $('timeline').children) b.onclick = () => { const f = this.frames.findIndex((x) => x.phaseIdx === +b.dataset.p); if (f >= 0) { this.pause(); this.follow = false; this.seek(f); } };
  },
  ingest(list) {
    for (const f of list) {
      this.frames.push(f);
      const x = f.extra, st = f.stats, W = S.config.W, it = st.iteration, fill = st.certArea / (W * W);
      charts.fill.push(it, { v: fill * 100 }); charts.placed.push(it, { v: x.best }); charts.coll.push(it, { v: x.working ? x.attemptColl : 0 });
      charts.prog.push(it, { v: Math.log10(1 + (x.attemptE || 0) * 1e4) * 20, best: 0 });
    }
    if (this.follow || this.frames.length === list.length) this.idx = this.follow ? this.frames.length - 1 : this.idx;
    this.renderPhases(this.frames[this.frames.length - 1].extra.phases); this.syncUi();
    if (this.follow || this.frames.length === list.length) this.show();
  },
  fps() { const v = speedValue(); return v === Infinity ? Infinity : 15 * v; },
  toggle() {
    if (this.playing) return this.pause();
    if (S.state === 'done' && this.idx >= this.frames.length - 1) this.idx = 0;
    if (S.state === 'idle') { client.play(speedValue()); }
    this.follow = false; this.playing = true; this.lastT = performance.now(); this.acc = 0; setState(S.state === 'done' ? 'running' : 'running');
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame((t) => this.loop(t));
  },
  pause() { if (!this.playing) return; this.playing = false; cancelAnimationFrame(this.raf); if (S.state === 'running') setState('paused'); },
  loop(t) {
    if (!this.playing) return;
    const dt = Math.min(0.2, (t - this.lastT) / 1000); this.lastT = t; const last = this.frames.length - 1, f = this.fps();
    if (f === Infinity) { if (this.idx !== last) this.seek(last, true); } else { this.acc += f * dt; const k = Math.floor(this.acc); if (k > 0) { this.acc -= k; this.seek(Math.min(last, this.idx + k), true); } }
    if (this.idx >= this.frames.length - 1 && this.computeDone) { this.playing = false; setState('done'); return; }
    this.raf = requestAnimationFrame((tt) => this.loop(tt));
  },
  seek(i, fromLoop) {
    if (!this.frames.length) return; const last = this.frames.length - 1; i = Math.max(0, Math.min(last, i));
    if (!fromLoop) { if (i < last || !this.computeDone) this.follow = false; }
    this.idx = i; this.show(); this.syncUi(); this.requestFree();
    if (!fromLoop && this.computeDone && this.idx >= last && !this.playing) setState('done');
  },
  atEnd() { return this.idx >= this.frames.length - 1 && !this.playing; },
  trails(f) {
    const n = f.sq ? f.sq.length / 6 : f.circ ? f.circ.length / 4 : 0; if (!n || n > 300 || !this.frames.length) return null;
    const from = Math.max(0, this.idx - 80), out = Array.from({ length: n }, () => []);
    for (let j = from; j <= this.idx; j++) {
      if (this.frames[j].phaseIdx < Math.max(1, f.phaseIdx === 4 ? 3 : f.phaseIdx) && j < this.idx) continue; // trajectoires : phase courante uniquement
      const g = this.frames[j], useSq = g.sq && g.sq.length && (!g.circ || g.morph >= 1 || g.morph > 0); // carrés dès qu'ils existent
      for (let i = 0; i < n; i++) { if (useSq && g.sq.length > i * 6 + 2) out[i].push(g.sq[i * 6 + 1], g.sq[i * 6 + 2]); else if (g.circ && g.circ.length > i * 4 + 2) out[i].push(g.circ[i * 4 + 1], g.circ[i * 4 + 2]); }
    }
    return out;
  },
  show() {
    if (!isPipe()) return;
    const f = this.frames[this.idx]; if (!f) { renderer.setScene({}); return; }
    const free = this.freeCache && this.freeCache.idx === this.idx ? this.freeCache.data : null;
    renderer.setScene({ sq: f.sq, circ: f.circ, morph: f.morph, circFlags: f.circFlags, overlay: { trails: this.trails(f), free } });
    const W = S.config.W, st = f.stats, x = f.extra;
    $('phaseTag').textContent = `${f.phaseIdx + 1}/5 · ${f.phaseName}${f.stage ? ' · ' + f.stage : ''}`;
    renderMsMetrics({ fill: st.certArea / (W * W), iteration: st.iteration, computeMs: st.computeMs }, { ...x, S: x.best, lo: x.lo, attempt: x.attempt, successes: x.successes, target: x.target });
  },
  syncUi() {
    const n = this.frames.length; $('scrub').max = Math.max(0, n - 1); $('scrub').value = this.idx;
    const f = this.frames[this.idx]; $('frameInfo').textContent = f ? `image ${this.idx + 1}/${n} · ${f.stats.iteration.toLocaleString('fr-FR')} it.` : '';
    $('bFollow').classList.toggle('on', this.follow);
    const first = [-1, -1, -1, -1, -1], cnt = [0, 0, 0, 0, 0]; this.frames.forEach((g, i) => { if (first[g.phaseIdx] < 0) first[g.phaseIdx] = i; cnt[g.phaseIdx]++; });
    const ph = n ? this.frames[n - 1].extra.phases : null, cur = f ? f.phaseIdx : -1;
    [...$('timeline').children].forEach((b, i) => {
      b.classList.toggle('todo', first[i] < 0); b.classList.toggle('cur', i === cur); b.setAttribute('aria-selected', i === cur);
      b.querySelector('span').textContent = first[i] < 0 ? 'à venir' : `${cnt[i]} images`;
      b.querySelector('i').style.width = ph && ph[i].done ? '100%' : first[i] >= 0 ? '50%' : '0';
    });
  },
  renderPhases(ph) {
    if (!ph) return; $('phaseBox').hidden = false;
    const pct = (v) => (v == null ? '—' : (v * 100).toFixed(2) + ' %'), num = (v, d = 4) => (v == null ? '—' : v.toFixed(d));
    const html = ph.map((p, i) => `<tr class="${p.done ? '' : 'dim'}"><td>${i + 1} · ${p.name}</td><td>${p.unit}</td><td>${num(p.S)}</td><td>${num(p.a != null ? p.a : null)}${p.unit === 'cercle' ? ' (diam.)' : ''}</td><td>${pct(p.fill)}</td><td>${fmt.n(p.iterations)}</td><td>${fmt.ms(p.ms)}</td></tr>`).join('');
    if (html !== this.lastPhaseHtml) { this.lastPhaseHtml = html; $('phaseTable').tBodies[0].innerHTML = html; }
    $('phaseNotes').innerHTML = ph.filter((p) => p.note).map((p, i) => `<p class="note">${esc(PHASE_NAMES[ph.indexOf(p)])} : ${esc(p.note)}</p>`).join('');
  },
  requestFree() {
    if (!isPipe() || !$('tFree').classList.contains('on') || this.freeBusy) return;
    const f = this.frames[this.idx]; if (!f || !f.sq || !f.sq.length || f.extra.working || f.morph > 0 && f.morph < 1 || f.phaseIdx < 2) return;
    this.freeBusy = true; this.freeFor = this.idx; client.free(f.sq.slice(), S.config.W, S.config.W / f.sq[3], this.idx);
  },
  onFree(m) { this.freeBusy = false; this.freeCache = { idx: m.id, data: { hole: m.hole, spots: m.spots } }; if (m.id === this.idx) this.show(); else this.requestFree(); },
  onDone(m) {
    this.computeDone = true;
    if (this.follow || !this.playing && this.idx >= this.frames.length - 1) { this.idx = this.frames.length - 1; this.show(); this.syncUi(); }
    this.renderPhases(m.analysis.phases);
    if (this.playing) setState('running'); else if (this.idx >= this.frames.length - 1) setState('done'); else setState('paused');
    this.requestFree();
  },
  report(m, pl, W, stats) {
    const v = m.verify, a = m.analysis, side = pl[0]?.side ?? 0;
    $('verifyBox').innerHTML = `<p class="note ${v && v.valid ? 'ok' : 'err'}"><b>Vérification géométrique indépendante</b> (aire d'intersection polygonale par découpage de Sutherland–Hodgman, sommets dans le conteneur, côtés égaux, angles) : ${v ? (v.valid ? `valide — 0 chevauchement, 0 sortie, côtés identiques, angles dans [0°, 90°).` : `<b>invalide</b> — ${esc(v.problems.join(' ; '))}`) : 'indisponible'}</p>` +
      `<p class="note">Cohérence : côté mesuré sur la disposition = ${side.toPrecision(6)} · W/S = ${(W / a.S).toPrecision(6)} · remplissage = N·côté²/W² = ${(pl.length * side * side / (W * W) * 100).toFixed(3)} %.</p>`;
    const key = JSON.stringify(['hist', S.config.n]); const h = lsGet('spl.hist', {}); (h[key] = h[key] || []).push({ S: a.S, fill: stats.fill, seed: S.config.seed, t: Date.now() }); h[key] = h[key].sort((p, q) => p.S - q.S).slice(0, 8); lsSet('spl.hist', h);
    this.showHist();
  },
  showHist() {
    if (!S.config) return; const h = lsGet('spl.hist', {})[JSON.stringify(['hist', S.config.n])];
    $('histBox').innerHTML = h && h.length ? `<h3 style="margin:12px 0 4px;font-size:13px">Meilleures solutions conservées (N = ${S.config.n})</h3><ol class="hist">${h.map((e) => `<li>S = ${e.S.toFixed(4)} · a/W = ${(1 / e.S).toFixed(4)} · ${(e.fill * 100).toFixed(2)} % · graine ${e.seed}</li>`).join('')}</ol>` : '';
  },
};
client.on('frames', (m) => { if (isPipe()) P.ingest(m.frames); });
client.on('free', (m) => P.onFree(m));
$('scrub').oninput = () => { P.pause(); P.follow = false; P.seek(+$('scrub').value); };
$('bPrevF').onclick = () => { P.pause(); P.seek(P.idx - 1); };
$('bNextF').onclick = () => { P.pause(); P.seek(P.idx + 1); };
$('bFollow').onclick = () => { P.follow = !P.follow; if (P.follow) { P.playing = false; if (S.state === 'idle') { client.play(speedValue()); setState('running'); } P.seek(P.frames.length - 1, true); } P.syncUi(); };

/* --------------------------------------------------------- contrôles */
function speedValue() { return SPEEDS[S.speedIdx]; }
function updateSpeed() {
  $('speed').value = S.speedIdx; const v = speedValue(); $('speedOut').textContent = v === Infinity ? '∞ instantané' : `×${v}`;
  client.setSpeed(v);
}
$('speed').oninput = () => { S.speedIdx = +$('speed').value; updateSpeed(); };
$('bSlow').onclick = () => { S.speedIdx = Math.max(0, S.speedIdx - 1); updateSpeed(); };
$('bFast').onclick = () => { S.speedIdx = Math.min(SPEEDS.length - 1, S.speedIdx + 1); updateSpeed(); };

function play() {
  if (S.view === 'cmp') backToLive();
  if (isPipe()) return P.toggle();
  if (S.state === 'running') { client.pause(); setState('paused'); return; }
  if (S.state === 'done') { initEngine(); setTimeout(() => { client.play(speedValue()); setState('running'); }, 60); return; }
  charts.fill.data.length === 0 && S.state === 'idle' && void 0;
  client.play(speedValue()); setState('running');
}
$('bPlay').onclick = play;
$('bStep').onclick = () => { if (isPipe()) { P.pause(); P.seek(P.idx + 1); return; } if (S.view === 'cmp') backToLive(); client.step(1); if (S.state !== 'done') setState('paused'); };
$('bStop').onclick = () => client.stop();
$('bReset').onclick = initEngine;
$('bFit').onclick = () => renderer.fit();
$('bFull').onclick = () => renderer.toggleFullscreen();
$('bBackLive').onclick = backToLive; $('bBackLive2').onclick = backToLive;
function backToLive() {
  if (isPipe()) { S.view = 'live'; $('bBackLive').hidden = true; $('bBackLive2').hidden = true; P.show(); return; }
  S.view = 'live'; $('bBackLive').hidden = true; $('bBackLive2').hidden = true;
  document.querySelectorAll('#cmpTable tr.sel, #stTable tr.sel, #attTable tr.sel').forEach((r) => r.classList.remove('sel'));
  if (S.lastDone) renderer.setScene({ sq: S.lastDone.sq }); else if (S.last) renderer.setScene({ sq: S.last.sq, circ: S.last.circ, morph: S.last.morph }); else renderer.setScene({});
  $('phaseTag').textContent = S.state === 'done' ? 'Terminé' : '';
}
function preview(sq, label) {
  if (S.state === 'running') { client.pause(); setState('paused'); }
  S.view = 'cmp'; $('bBackLive').hidden = false; $('bBackLive2').hidden = false; renderer.setScene({ sq }); $('phaseTag').textContent = `Aperçu : ${label}`;
}

for (const [id, key] of [['tGrid', 'grid'], ['tVoid', 'voids'], ['tLabels', 'labels'], ['tCol', 'collisions'], ['tCoords', 'coords']]) {
  const el = $(id); const flip = () => { el.classList.toggle('on'); renderer.setOptions({ [key]: el.classList.contains('on') }); if (key === 'coords') $('coords').style.visibility = el.classList.contains('on') ? 'visible' : 'hidden'; };
  el.onclick = flip; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  renderer.setOptions({ [key]: el.classList.contains('on') });
}
for (const [id, key] of [['tCirc', 'showCircles'], ['tSq', 'showSquares'], ['tTrail', 'trails'], ['tFree', 'free']]) {
  const el = $(id); const flip = () => { el.classList.toggle('on'); renderer.setOptions({ [key]: el.classList.contains('on') }); if (key === 'free') P.requestFree(); P.show(); };
  el.onclick = flip; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  renderer.setOptions({ [key]: el.classList.contains('on') });
}
document.addEventListener('keydown', (e) => {
  if (isPipe() && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { if (e.key === 'ArrowLeft') { P.seek(P.idx - 1); return; } if (e.key === 'ArrowRight') { P.seek(P.idx + 1); return; } }
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return;
  if (e.key === ' ') { e.preventDefault(); play(); } else if (e.key === 's' || e.key === 'S') $('bStep').click();
  else if (e.key === 'r' || e.key === 'R') initEngine(); else if (e.key === 'f' || e.key === 'F') renderer.toggleFullscreen(); else if (e.key === '0') renderer.fit();
});

/* mode expérimental : paramètres en direct */
for (const [id, out, f] of [['lp-stiffness', 'lp1v', (v) => (+v).toFixed(2)], ['lp-noise', 'lp2v', (v) => (+v).toFixed(2)], ['lp-tScale', 'lp3v', (v) => (+v).toFixed(3)], ['lp-stageIters', 'lp4v', (v) => v], ['lp-batchFrac', 'lp5v', (v) => `${(v * 100).toFixed(1)} %`], ['lp-tempScale', 'lp6v', (v) => (+v).toFixed(2)], ['lp-ampScale', 'lp7v', (v) => (+v).toFixed(2)]]) {
  $(id).addEventListener('input', () => { $(out).textContent = f($(id).value); client.setParams({ [id.slice(3)]: +$(id).value }); });
}

/* ------------------------------------------------------------- export */
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function currentPlacements() {
  if (S.lastDone) return S.lastDone.placements;
  return S.last ? toPlacements(S.last.sq) : [];
}
$('bExport').onclick = (e) => { e.stopPropagation(); const m = $('exportMenu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; };
document.addEventListener('click', () => { $('exportMenu').style.display = 'none'; });
$('exportMenu').addEventListener('click', (e) => {
  const kind = e.target.dataset?.ex; if (!kind || !S.instance) return;
  const name = `square-packing-${S.config.algorithm}-n${S.config.n}-seed${S.config.seed}`;
  const inst = { ...S.instance }, pl = currentPlacements();
  if (kind === 'png') renderer.toBlob((b) => b && download(`${name}.png`, b));
  else if (kind === 'svg') download(`${name}.svg`, new Blob([layoutToSvg(inst, pl)], { type: 'image/svg+xml' }));
  else {
    const stats = S.lastDone?.stats || computeStats(inst, pl, S.last?.stats.computeMs || 0, S.last?.stats.iteration || 0);
    const cls = S.lastDone?.classification || classify(inst, stats);
    download(`${name}.json`, new Blob([resultToJson({ config: S.config, instance: inst, placements: pl, stats, classification: cls, algorithm: S.config.algorithm })], { type: 'application/json' }));
  }
});

/* ---------------------------------------------- configurations sauvegardées */
function refreshSaved() {
  const all = lsGet('spl.configs', {}), sel = $('savedCfgs'); sel.innerHTML = '<option value="">—</option>';
  for (const k of Object.keys(all)) sel.append(new Option(k, k));
}
$('bSaveCfg').onclick = () => {
  const name = $('cfgName').value.trim() || `Config ${new Date().toLocaleString('fr-FR')}`;
  const all = lsGet('spl.configs', {}); all[name] = S.config; lsSet('spl.configs', all); refreshSaved(); $('savedCfgs').value = name;
};
$('bLoadCfg').onclick = () => { const c = lsGet('spl.configs', {})[$('savedCfgs').value]; if (c) { writeForm(c); initEngine(); } };
$('bDelCfg').onclick = () => { const all = lsGet('spl.configs', {}); delete all[$('savedCfgs').value]; lsSet('spl.configs', all); refreshSaved(); };
$('bShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}#c=${encodeConfig(S.config)}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); $('bShare').textContent = 'Lien copié ✓'; } catch { $('bShare').textContent = 'Lien dans la barre d’adresse'; }
  setTimeout(() => { $('bShare').textContent = 'Lien de partage'; }, 2500);
};
$('bExportCfg').onclick = () => download('square-packing-config.json', new Blob([JSON.stringify(S.config, null, 2)], { type: 'application/json' }));
$('fImportCfg').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const raw = JSON.parse(await f.text()); const { config } = normalizeConfig(raw.config || raw); writeForm(config); initEngine(); } catch { showError('Fichier de configuration invalide.'); }
  e.target.value = '';
};

/* ----------------------------------------------------------- onglets */
for (const b of document.querySelectorAll('.tabs button')) {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === `tab-${b.dataset.tab}`));
  };
}
function openTab(name) { document.querySelector(`.tabs button[data-tab=${name}]`).click(); }
for (const b of document.querySelectorAll('.mobtabs button')) {
  b.onclick = () => { document.body.dataset.pane = b.dataset.pane; document.querySelectorAll('.mobtabs button').forEach((x) => x.setAttribute('aria-pressed', x === b)); setTimeout(() => renderer.requestRender(), 50); };
}

/* ------------------------------------------------------- comparaison */
const selectedAlgos = () => [...document.querySelectorAll('#cmpAlgos .chip.on')].map((b) => b.dataset.id);
function setBusy(kind) {
  S.busy = kind;
  $('bCompare').disabled = !!kind; $('bScale').disabled = !!kind; $('bStudy').disabled = !!kind;
  $('bCmpCancel').disabled = kind !== 'compare'; $('bScCancel').disabled = kind !== 'scaling';
  $('bAttempts').disabled = !!kind; $('bAttCancel').disabled = kind !== 'attempts';
}
function badgeCell(c) { return `<span class="badge ${c.status === 'optimal' ? 'ok' : c.status === 'invalid' ? 'bad' : 'warn'}">${c.status === 'optimal' ? 'optimale' : c.status === 'invalid' ? 'invalide' : 'heuristique'}</span>`; }
$('bCompare').onclick = () => {
  const algos = selectedAlgos(); if (!algos.length) return showError('Sélectionnez au moins un algorithme.');
  if (S.state === 'running') { client.pause(); setState('paused'); }
  S.cmp = {}; $('cmpTable').tBodies[0].innerHTML = ''; $('bCsv').disabled = true;
  $('cmpStatus').hidden = false; $('cmpStatus').textContent = `Même configuration et même graine (${S.config.seed}) pour tous les algorithmes…`;
  setBusy('compare'); client.compare(readForm(), algos, 30000);
};
$('bCmpCancel').onclick = () => client.cancel();
client.on('compareStart', (m) => { $('cmpStatus').textContent = `Calcul : ${ALGORITHMS[m.id].name}…`; });
client.on('compareRow', (m) => {
  S.cmp[m.id] = m; renderCmp();
});
client.on('compareDone', (m) => { setBusy(null); $('cmpStatus').textContent = m.cancelled ? 'Comparaison annulée.' : 'Comparaison terminée — cliquez une ligne pour visualiser la disposition.'; $('bCsv').disabled = !Object.keys(S.cmp).length; });
function renderCmp() {
  const rows = Object.values(S.cmp), bestFill = Math.max(...rows.filter((r) => r.stats.valid).map((r) => r.stats.fill), -1);
  $('cmpTable').tBodies[0].innerHTML = rows.map((r) => `<tr data-id="${r.id}" class="${r.stats.valid && r.stats.fill === bestFill ? 'best' : ''}"><td>${esc(ALGORITHMS[r.id].name)}</td><td>${r.stats.placed}/${r.stats.requested}</td><td>${fmt.pct(r.stats.fill)}</td><td>${fmt.pct(r.stats.wasted)}</td><td>${r.stats.elapsedMs.toFixed(0)}</td><td>${badgeCell(r.classification)}</td></tr>`).join('');
}
$('cmpTable').tBodies[0].addEventListener('click', (e) => {
  const tr = e.target.closest('tr'); if (!tr) return; const r = S.cmp[tr.dataset.id]; if (!r) return;
  document.querySelectorAll('#cmpTable tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel');
  preview(r.sq, ALGORITHMS[r.id].name);
  if (r.literature) $('cmpStatus').textContent = r.literature.text;
});
$('bCsv').onclick = () => {
  const head = 'algorithme;places;demandes;remplissage;perdu;collisions;temps_ms;iterations;statut;graine\n';
  const body = Object.values(S.cmp).map((r) => [ALGORITHMS[r.id].name, r.stats.placed, r.stats.requested, r.stats.fill.toFixed(6), r.stats.wasted.toFixed(6), r.stats.collisions, r.stats.elapsedMs.toFixed(1), r.iterations, r.classification.status, S.config.seed].join(';')).join('\n');
  download(`comparaison-n${S.config.n}-seed${S.config.seed}.csv`, new Blob([head + body], { type: 'text/csv' }));
};

/* ----------------------------------------------------- expériences */
const EXPERIMENTS = [
  { t: 'Grille parfaite 6 × 6', d: '36 carrés unité dans un carré de côté 6 : le remplissage de 100 % est atteignable et prouvé optimal (conteneur plein).', cfg: { n: 36, sizeMode: 'identical', sMin: 1, W: 6, algorithm: 'maxrects' }, act: 'run' },
  { t: 'Le cas n = 5 (carré incliné)', d: 'Cinq carrés unité tiennent dans un côté 2 + 1/√2 ≈ 2,707 grâce à un carré incliné à 45°. Les méthodes à axes alignés échouent ; la rotation libre est nécessaire. Ici W = 2,9 (marge pour la recherche continue).', cfg: { n: 5, sizeMode: 'identical', sMin: 1, W: 2.9, rotation: true, algorithm: 'forces', iterations: 4000 }, act: 'compare' },
  { t: 'Le cas n = 11 (exploratoire)', d: 'Meilleur côté connu ≈ 3,877 avec carrés inclinés. À W = 3,9 la marge est mince : un test honnête des méthodes continues.', cfg: { n: 11, sizeMode: 'identical', sMin: 1, W: 3.9, rotation: true, algorithm: 'forces', iterations: 6000 }, act: 'compare' },
  { t: 'Tailles de Fibonacci', d: 'Carrés de côtés 1, 1, 2, 3, 5, 8 répétés : instance hétérogène structurée.', cfg: { n: 60, sizeMode: 'preset', presetId: 'fibonacci', W: 34, algorithm: 'maxrects' }, act: 'compare' },
  { t: 'Instance dense (≈ 75 %)', d: '200 carrés aléatoires de côté 1–2 dans un carré de côté 25 : densité requise élevée, les écarts entre algorithmes apparaissent.', cfg: { n: 200, sizeMode: 'random', sMin: 1, sMax: 2, W: 25, algorithm: 'maxrects' }, act: 'compare' },
  { t: 'Rectangle allongé', d: 'Conteneur 60 × 8 : les heuristiques de type étagères / skyline sont à l’aise ; les méthodes continues moins.', cfg: { n: 80, containerMode: 'rect', sizeMode: 'random', sMin: 0.8, sMax: 2, W: 60, H: 8, algorithm: 'skyline' }, act: 'compare' },
  { t: 'Configuration impossible', d: '30 carrés de côté 3 dans un carré de côté 10 : au plus 9 tiennent. Le simulateur le signale et maximise la surface placée.', cfg: { n: 30, sizeMode: 'identical', sMin: 3, W: 10, algorithm: 'maxrects' }, act: 'run' },
  { t: 'Avec / sans rotation libre', d: '40 carrés aléatoires, recuit simulé : lancez avec puis sans « rotation libre » et comparez le remplissage.', cfg: { n: 40, sizeMode: 'random', sMin: 1, sMax: 2, W: 14, rotation: true, algorithm: 'anneal', iterations: 4000 }, act: 'run' },
  { t: 'Démo Circle → Square', d: '60 carrés identiques : disques, transformation, vérification exacte puis ré-optimisation. Lancez ensuite l’étude pour comparer inscrit / circonscrit / orienté.', cfg: { n: 60, sizeMode: 'identical', sMin: 1, W: 12, rotation: true, algorithm: 'circle2square', iterations: 3000, c2s: { transform: 'optimized', lambda: 0.5, radiusSearch: false, relaxer: 'forces' } }, act: 'study' },
];
$('expList').innerHTML = EXPERIMENTS.map((e, i) => `<div class="card"><h3>${esc(e.t)}</h3><p>${esc(e.d)}</p><div class="row"><button class="btn sm" data-load="${i}" type="button">Charger</button><button class="btn sm primary" data-go="${i}" type="button">${e.act === 'run' ? 'Charger et lancer' : e.act === 'study' ? 'Charger et étudier' : 'Charger et comparer'}</button></div></div>`).join('');
$('expList').addEventListener('click', (ev) => {
  const li = ev.target.dataset.load, go = ev.target.dataset.go, i = +(li ?? go); if (Number.isNaN(i)) return;
  const e = EXPERIMENTS[i], { config } = normalizeConfig({ ...DEFAULT_CONFIG, ...e.cfg, options: DEFAULT_CONFIG.options, c2s: { ...DEFAULT_CONFIG.c2s, ...(e.cfg.c2s || {}) }, seed: S.config?.seed ?? 42 });
  writeForm(config); initEngine();
  if (go === undefined) return;
  setTimeout(() => {
    if (e.act === 'run') { openTab('stats'); play(); } else if (e.act === 'compare') { openTab('cmp'); $('bCompare').click(); } else { openTab('exp'); $('bStudy').click(); }
  }, 250);
});

$('bScale').onclick = () => {
  const ns = parseSizeList($('scNs').value).map(Math.round).filter((n) => n >= 1 && n <= 5000), algos = selectedAlgos();
  if (!ns.length || !algos.length) return showError('Indiquez des valeurs de n et sélectionnez des algorithmes (onglet Comparaison).');
  if (S.state === 'running') { client.pause(); setState('paused'); }
  scCharts.fill.clear(); scCharts.time.clear(); $('scTable').tBodies[0].innerHTML = '';
  setBusy('scaling'); client.scaling(readForm(), algos, ns, Math.min(1, Math.max(0.1, +$('scDen').value || 0.6)), 15000);
};
$('bScCancel').onclick = () => client.cancel();
client.on('scalingRow', (m) => {
  scCharts.fill.set(m.n, m.id, m.stats.fill * 100); scCharts.time.set(m.n, m.id, Math.max(0.1, m.stats.elapsedMs));
  $('scTable').tBodies[0].insertAdjacentHTML('beforeend', `<tr><td>${m.n}</td><td>${esc(ALGORITHMS[m.id].name)}</td><td>${m.stats.placed}/${m.stats.requested}</td><td>${fmt.pct(m.stats.fill)}</td><td>${m.stats.elapsedMs.toFixed(0)}</td></tr>`);
});
client.on('scalingDone', () => setBusy(null));

$('bStudy').onclick = () => {
  if (S.state === 'running') { client.pause(); setState('paused'); }
  S.study = {}; $('stTable').tBodies[0].innerHTML = ''; setBusy('study'); client.c2sStudy(readForm(), 30000);
};
client.on('studyRow', (m) => {
  S.study[m.key] = m; const a = m.analysis || {}, area = m.W * m.H;
  $('stTable').tBodies[0].insertAdjacentHTML('beforeend', `<tr data-key="${m.key}"><td>${esc(m.label)}</td><td>${a.circlesPlaced ?? '—'}</td><td>${a.rawCollisions ?? '—'}</td><td>${a.rawCertifiedArea !== undefined ? fmt.pct(a.rawCertifiedArea / area) : '—'}</td><td>${fmt.pct(m.stats.fill)}</td></tr>`);
});
client.on('studyDone', () => setBusy(null));
$('stTable').tBodies[0].addEventListener('click', (e) => {
  const tr = e.target.closest('tr'); if (!tr || !S.study[tr.dataset.key]) return;
  document.querySelectorAll('#stTable tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel');
  preview(S.study[tr.dataset.key].sq, S.study[tr.dataset.key].label);
});

/* ------------------------------------------- tentatives (taille maximale) */
S.attempts = [];
function addAttempt(a) { S.attempts.push(a); renderAtt(); $('bAttCsv').disabled = false; }
function renderAtt() {
  const rows = S.attempts, best = Math.min(...rows.filter((r) => r.status !== 'invalid').map((r) => r.S), Infinity);
  $('attTable').tBodies[0].innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="${r.S === best ? 'best' : ''}"><td>${esc(STRAT_NAMES[r.strategy] || r.strategy)}${r.source === 'manuel' ? ' ·m' : ''}</td><td>${r.seed}</td><td>${r.S.toFixed(4)}</td><td>${(1 / r.S).toFixed(4)}</td><td>${fmt.pct(r.fill)}</td><td>${fmt.n(r.iterations)}</td><td>${r.ms.toFixed(0)}</td><td>${badgeCell({ status: r.status })}</td></tr>`).join('');
}
$('attTable').tBodies[0].addEventListener('click', (e) => {
  const tr = e.target.closest('tr'); if (!tr) return; const r = S.attempts[+tr.dataset.i]; if (!r) return;
  document.querySelectorAll('#attTable tr.sel').forEach((x) => x.classList.remove('sel')); tr.classList.add('sel');
  preview(r.sq, `${STRAT_NAMES[r.strategy]} · graine ${r.seed} · S = ${r.S.toFixed(4)}`);
  $('angCount').textContent = `(aperçu)`; fillAngles(toPlacements(r.sq), S.config.W);
});
for (const b of document.querySelectorAll('#msStratChips .chip')) b.onclick = () => b.classList.toggle('on');
$('bAttempts').onclick = () => {
  const strategies = [...document.querySelectorAll('#msStratChips .chip.on')].map((b) => b.dataset.s), count = +$('attCount').value, first = +$('attSeed').value || 1;
  if (!strategies.length) return showError('Sélectionnez au moins une stratégie.');
  if (S.state === 'running') { client.pause(); setState('paused'); }
  const runs = []; for (const st of strategies) for (let k = 0; k < count; k++) runs.push({ strategy: st, seed: first + k });
  $('attStatus').hidden = false; $('attStatus').textContent = `${runs.length} tentatives sur N = ${S.config.n}…`;
  setBusy('attempts'); client.attempts(readForm(), runs, 60000);
};
$('bAttCancel').onclick = () => client.cancel();
$('bAttClear').onclick = () => { S.attempts = []; renderAtt(); $('bAttCsv').disabled = true; };
client.on('attemptStart', (m) => { $('attStatus').textContent = `Calcul : ${STRAT_NAMES[m.run.strategy]}, graine ${m.run.seed}…`; });
client.on('attemptRow', (m) => { addAttempt({ strategy: m.run.strategy, seed: m.run.seed, S: m.analysis.S, W: m.W, fill: m.stats.fill, iterations: m.stats.iterations, ms: m.stats.elapsedMs, status: m.classification.status, sq: m.sq, source: 'auto' }); });
client.on('attemptsDone', (m) => { setBusy(null); $('attStatus').textContent = m.cancelled ? 'Annulé.' : 'Terminé — cliquez une ligne pour visualiser la disposition et ses angles. ★ = plus grande taille.'; });
$('bAttCsv').onclick = () => {
  const head = 'strategie;graine;S;a_sur_W;remplissage;iterations;temps_ms;statut;n\n';
  download(`tentatives-n${S.config.n}.csv`, new Blob([head + S.attempts.map((r) => [r.strategy, r.seed, r.S.toFixed(6), (1 / r.S).toFixed(6), r.fill.toFixed(6), r.iterations, r.ms.toFixed(1), r.status, S.config.n].join(';')).join('\n')], { type: 'text/csv' }));
};
const MS_EXPERIMENTS = [
  { t: 'N = 5 — le carré incliné', n: 5, d: 'Cas d’école : la grille donne S = 3, mais un carré à 45° au centre ramène S à 2 + 1/√2 ≈ 2,7071 (optimum démontré).' },
  { t: 'N = 10', n: 10, d: 'Optimum démontré s(10) = 3 + 1/√2 ≈ 3,7071, obtenu avec des carrés inclinés.' },
  { t: 'N = 11', n: 11, d: 'Meilleur connu ≈ 3,877 (non prouvé optimal). Un cas où la grille 4×4 est loin d’être la bonne structure.' },
  { t: 'N = 17', n: 17, d: 'Meilleur connu ≈ 4,676 (non prouvé).' },
  { t: 'N = 19', n: 19, d: 'Meilleur connu = 3 + 4√2/3 ≈ 4,886. Difficile : la recherche reste souvent bloquée sur la grille 5×5.' },
  { t: 'N = 25 — grille parfaite', n: 25, d: 'S = 5 : la borne de surface √N est atteinte, optimum prouvé immédiatement.' },
  { t: 'N = 26', n: 26, d: 'Meilleur connu = 7/2 + 3√2/2 ≈ 5,621.' },
  { t: 'N = 50 — plus grand', n: 50, d: 'Instance plus grande : la qualité dépend du budget d’itérations ; comparez plusieurs tentatives.' },
];
$('expMsList').innerHTML = MS_EXPERIMENTS.map((e, i) => `<div class="card"><h3>${esc(e.t)}</h3><p>${esc(e.d)}</p><div class="row"><button class="btn sm" data-mload="${i}" type="button">Charger</button><button class="btn sm primary" data-mgo="${i}" type="button">Charger et lancer</button></div></div>`).join('');
$('expMsList').addEventListener('click', (ev) => {
  const i = +(ev.target.dataset.mload ?? ev.target.dataset.mgo); if (Number.isNaN(i)) return;
  $('n').value = MS_EXPERIMENTS[i].n; $('nRange').value = MS_EXPERIMENTS[i].n; setRadio('problem', 'maxsize'); syncVisibility(); initEngine();
  if (ev.target.dataset.mgo !== undefined) setTimeout(() => { openTab('stats'); play(); }, 250);
});

/* ------------------------------------------------------------ démarrage */
refreshSaved();
(function boot() {
  let raw = null;
  const m = /[#&]c=([^&]+)/.exec(location.hash);
  if (m) raw = decodeConfig(m[1]);
  const { config } = normalizeConfig(raw || { problem: 'maxsize', n: 10, W: 20, seed: 42 });
  writeForm(config); updateSpeed(); initEngine();
})();
window.__spl = { S, client, renderer, P }; // aide au débogage / tests e2e
initA11y();
