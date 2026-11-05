/**
 * Parallel Packing Lab — interface. AUCUN calcul géométrique ici : tout vient du serveur (état, solutions, historique).
 * Seules exceptions d'affichage : dissimilarité entre solutions comparées (module partagé) et mise en forme.
 */
import { drawChart, drawLayout } from './pchart.js';
import { dissimilarity } from '../parallel/canonical.js';
import { initA11y } from './a11y.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponible */ } };
const fmtMs = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; };
const STRAT = { direct: 'Direct', anneal: 'Multi-départ', circle: 'Circle→Square', pattern: 'Motifs bande', hop: 'Secousse + SLP', 'evo:best': 'Mutation du record', 'evo:diverse': 'Mutation élite diverse', 'evo:recomb': 'Recombinaison', import: 'Import', best: 'Mutation du record', diverse: 'Mutation élite diverse', recomb: 'Recombinaison', random: 'Nouvelle configuration' };
const STATE = { init: 'Initialisation', waiting: 'En attente', running: 'En cours', submitting: 'Soumission', done: 'Terminé', restarting: 'Relance', error: 'Erreur', suspended: 'Suspendu' };
const STATUS = { created: 'Créée', running: 'En cours', paused: 'En pause', stopped: 'Arrêtée', error: 'Erreur' };

const A = { id: null, sum: null, sols: [], solsFetchedAt: 0, es: null, detail: null, frozen: false, lastPaint: 0, snap: null, sel: new Set(), hist: [], viewMode: 'mosaic', tab: 'dash', lastSeq: 0, n: 17 };
const api = (path, opt = {}) => {
  const base = lsGet('ppl.api', ''), tok = sessionStorage.getItem('ppl.token') || '';
  return fetch(base + path, { ...opt, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(opt.headers || {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined }).then(async (r) => {
    let j = null; try { j = await r.json(); } catch { /* */ }
    if (r.status === 401) { $('tokenBox').hidden = false; throw new Error('authentification requise : saisissez le jeton'); }
    if (!r.ok) throw new Error((j && j.error) || (r.status >= 500 ? 'le serveur ne répond pas correctement' : `erreur HTTP ${r.status}`));
    return j;
  }, () => { throw new Error('serveur injoignable'); });
};
const toast = (msg, bad) => { const b = $('errBanner'); b.textContent = msg; b.classList.toggle('show', true); b.style.background = bad ? '' : '#0e1b12'; setTimeout(() => b.classList.remove('show'), 5000); };
const fail = (e) => toast(`Erreur : ${e.message || e}`, true);

/* ----------------------------------------------------------- configuration */
for (const n of [5, 10, 17, 25, 50, 100]) { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = n; b.onclick = () => { $('pN').value = n; $('pNr').value = Math.min(200, n); }; $('nChips').appendChild(b); }
for (const n of [2, 4, 8, 16, 32]) { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = n; b.onclick = () => { $('pSims').value = n; }; $('simChips').appendChild(b); }
$('pNr').oninput = () => { $('pN').value = $('pNr').value; };
$('pN').oninput = () => { $('pNr').value = Math.min(200, +$('pN').value || 1); };
$('token').onchange = () => { sessionStorage.setItem('ppl.token', $('token').value); init(); };
$('bCreate').onclick = async () => {
  const n = +$('pN').value, sims = +$('pSims').value;
  if (!(n >= 1 && n <= 400)) return fail(new Error('N doit être entre 1 et 400'));
  if (!(sims >= 1 && sims <= 128)) return fail(new Error('simulations : 1 à 128'));
  try {
    const r = await api('/api/searches', { method: 'POST', body: { params: { n, sims, seed: +$('pSeed').value, maxWorkers: +$('pMax').value, mode: $('pMode').value, cycleMs: +$('pCycle').value || 0, effort: +$('pEffort').value, strategies: [...document.querySelectorAll('.pStrat:checked')].map((c) => c.value) } } });
    await refreshList(); open(r.id);
  } catch (e) { fail(e); }
};
$('bOpen').onclick = () => { if ($('pList').value) open($('pList').value); };
$('bStopAll').onclick = async () => { if (!confirm('Arrêter TOUTES les recherches en cours ? Les résultats sont conservés.')) return; try { const r = await api('/api/stop-all', { method: 'POST' }); toast(`${r.stopped} recherche(s) arrêtée(s)`); if (A.id) A.sum = await api(`/api/searches/${A.id}`); render(); refreshList(); } catch (e) { fail(e); } };
$('bDelAll').onclick = async () => { if (!confirm('Supprimer DÉFINITIVEMENT toutes les recherches et toutes leurs solutions ? Action irréversible.')) return; if (prompt('Tape SUPPRIMER pour confirmer') !== 'SUPPRIMER') return toast('Suppression annulée'); try { const r = await api('/api/searches?confirm=yes', { method: 'DELETE' }); toast(`${r.deleted} recherche(s) supprimée(s)`); close(); await refreshList(); loadRecords(); } catch (e) { fail(e); } };
$('bDelete').onclick = async () => { const id = $('pList').value; if (!id || !confirm('Supprimer définitivement cette recherche et toutes ses solutions ?')) return; try { await api(`/api/searches/${id}`, { method: 'DELETE' }); if (A.id === id) close(); await refreshList(); } catch (e) { fail(e); } };

async function refreshList() {
  const { searches } = await api('/api/searches'), sel = $('pList');
  sel.innerHTML = '<option value="">—</option>' + searches.map((s) => `<option value="${s.id}">${s.id} · N=${s.params.n} · ${s.params.sims} sim. · ${STATUS[s.status] || s.status}${s.best ? ' · S=' + s.best.S.toFixed(4) : ''}</option>`).join('');
  if (A.id) sel.value = A.id; return searches;
}

/* --------------------------------------------------------- connexion / SSE */
function close() { if (A.es) A.es.close(); A.es = null; A.id = null; A.sum = null; A.sols = []; render(); }
function open(id) {
  if (A.es) A.es.close(); A.id = id; lsSet('ppl.current', id); A.sols = []; A.sel.clear(); A.detail = null; A.snap = null; $('pList').value = id;
  const base = lsGet('ppl.api', ''), tok = sessionStorage.getItem('ppl.token');
  const es = new EventSource(`${base}/api/searches/${id}/events${tok ? '?token=' + encodeURIComponent(tok) : ''}`); A.es = es;
  es.onopen = () => { $('connBanner').hidden = true; };
  es.onerror = () => { $('connBanner').hidden = false; }; // EventSource se reconnecte seul ; le serveur renvoie l'état complet + événements manqués
  es.addEventListener('state', (e) => { const d = JSON.parse(e.data); A.sum = d.summary; A.lastSeq = d.seq; A.n = A.sum.params.n; fetchSols(true); render(); });
  es.addEventListener('summary', (e) => { A.sum = JSON.parse(e.data).summary; render(); });
  es.addEventListener('record', (e) => { const d = JSON.parse(e.data); toast(`Nouveau record : S = ${d.S.toFixed(5)} (remplissage ${(d.fill * 100).toFixed(2)} %) — simulation ${d.slot < 0 ? 'import' : d.slot + 1}`); fetchSols(true); });
  es.addEventListener('beat', (e) => { const d = JSON.parse(e.data); toast(`⚠ Valeur sous le record connu pour N = ${d.n} : S = ${d.S.toFixed(6)} < ${d.ref} (certifié avec marge 2e-9). À re-vérifier indépendamment avant toute annonce.`); });
  es.addEventListener('solution', () => fetchSols(false));
  es.addEventListener('snapshot', (e) => { const d = JSON.parse(e.data); if (A.detail === d.slotId) { A.snap = d.frame; paintDetail(); } });
  es.addEventListener('slot-error', (e) => toast(`Simulation ${JSON.parse(e.data).slot + 1} : erreur, relance automatique`, true));
  es.addEventListener('recovered', () => toast('Recherche reprise depuis les derniers checkpoints (reprise approximative)'));
}
async function fetchSols(force) {
  if (!A.id || (!force && Date.now() - A.solsFetchedAt < 3000)) return; A.solsFetchedAt = Date.now();
  try { A.sols = (await api(`/api/searches/${A.id}/solutions`)).solutions; if (A.tab === 'rank') renderRank(); populateFilters(); } catch { /* reconnexion en cours */ }
}
async function fetchHist() { if (!A.id) return; try { A.hist = (await api(`/api/searches/${A.id}/history`)).history; if (A.tab === 'hist') renderHist(); } catch { /* */ } }

/* ----------------------------------------------------------------- actions */
const act = (a) => async () => { if (!A.id) return; try { A.sum = await api(`/api/searches/${A.id}/${a}`, { method: 'POST' }); render(); refreshList(); } catch (e) { fail(e); } };
$('bStart').onclick = act('start'); $('bPause').onclick = act('pause'); $('bResume').onclick = act('resume'); $('bStop').onclick = act('stop');
$('bPatch').onclick = async () => { try { const b = { maxWorkers: +$('mMax').value, cycleMs: +$('mCycle').value || 0, mode: $('mMode').value }; if (+$('mSims').value > A.sum.params.sims) b.sims = +$('mSims').value; A.sum = await api(`/api/searches/${A.id}/params`, { method: 'PATCH', body: b }); toast('Paramètres mis à jour'); render(); } catch (e) { fail(e); } };

/* ---------------------------------------------------------------- rendu */
function render() {
  const s = A.sum; $('bStart').disabled = !s || s.status === 'running' || s.status === 'paused'; $('bPause').disabled = !s || s.status !== 'running'; $('bResume').disabled = !s || s.status !== 'paused'; $('bStop').disabled = !s || !['running', 'paused'].includes(s.status);
  const st = $('pStatus'); st.textContent = s ? STATUS[s.status] : 'Aucune recherche'; st.className = `badge ${s ? (s.status === 'running' ? 'info' : s.status === 'stopped' ? 'ok' : 'warn') : ''}`; $('pId').textContent = s ? `recherche ${s.id}` : '';
  if (!s) { $('pMetrics').innerHTML = '<p class="note">Configurez puis lancez une recherche, ou ouvrez une recherche enregistrée.</p>'; return; }
  const r = s.resources, c = s.counters, b = s.best;
  const cell = (k, v, cl = '') => `<div class="metric ${cl}"><span>${k}</span><b>${v}</b></div>`;
  $('pMetrics').innerHTML = [
    cell('Nombre de carrés', s.params.n), cell('Simulations demandées', r.requested), cell('Workers actifs', `${r.active} / cible ${r.target}`, 'good'), cell('Simulations en attente', r.waiting, r.waiting ? 'hl' : ''),
    cell('Cycles terminés', c.cycles.toLocaleString('fr-FR')), cell('Solutions valides (soumises)', c.validSolutions.toLocaleString('fr-FR')), cell('Meilleure taille commune S', b ? b.S.toFixed(5) : '—', 'hl'), cell('Taille s (conteneur L = 1)', b ? b.size.toFixed(5) : '—', 'hl'),
    cell('Meilleur remplissage', b ? (b.fill * 100).toFixed(3) + ' %' : '—', 'hl'), cell('Nouveaux records', c.improvements), cell('Temps total de recherche', fmtMs(s.searchMs)), cell('Solutions rejetées (invalides)', c.invalid, c.invalid ? 'bad' : ''),
    cell('Élite Pool', `${c.pool.size} (dont ${c.pool.categories.diverse} div.)`), cell('Doublons écartés', c.duplicates), cell('Redémarrages de workers', c.workerRestarts), cell('Durée moy. d\'un cycle', r.avgCycleMs ? (r.avgCycleMs / 1000).toFixed(1) + ' s' : '—'),
  ].join('');
  $('govNote').textContent = `Workers : ${r.requested} simulations souhaitées · ${r.active} actives · ${r.waiting} en attente · cible adaptative ${r.target}${r.caps ? ` (plafonds : CPU ${r.caps.cpu}, mémoire ${r.caps.memory}${r.caps.manual ? ', manuel ' + r.caps.manual : ''}, serveur ${r.caps.server})` : ''}${r.reasons.length ? ' — ' + r.reasons.join(' ; ') : ''}.`;
  $('honest').innerHTML = b ? `Record actuel : valide (vérifié par l'autorité de validation) mais <b>non prouvé optimal</b>. Borne d'aire prouvée : S ≥ √N = ${Math.sqrt(s.params.n).toFixed(4)} (remplissage ≤ 100 %).` : '';
  if (document.activeElement && !['mMax', 'mSims', 'mCycle', 'mMode'].includes(document.activeElement.id)) { $('mMax').value = s.params.maxWorkers; $('mSims').value = s.params.sims; $('mCycle').value = s.params.cycleMs || 0; $('mMode').value = s.params.mode; }
  const rows = [];
  for (const [k, v] of Object.entries(s.bandits.origins)) rows.push([STRAT[k] || k, v]);
  for (const [k, v] of Object.entries(s.bandits.strategies)) rows.push([`Exploration : ${STRAT[k] || k}`, v]);
  for (const [k, v] of Object.entries(s.bandits.amplitudes)) rows.push([`Amplitude : ${k}`, v]);
  $('banditTable').tBodies[0].innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${(v.p * 100).toFixed(1)} %</td><td>${v.pulls}</td><td>${v.meanReward.toFixed(3)}</td><td>${v.records}</td><td>${v.improvements}</td><td>${v.accepted}</td><td>${fmtMs(v.ms)}</td></tr>`).join('');
  if (A.tab === 'viz') paintViz();
  if (A.tab === 'hist' && Date.now() - (A.histAt || 0) > 4000) { A.histAt = Date.now(); fetchHist(); }
}

/* ---------------------------------------------------------- visualisation */
const slotLabel = (sl) => `#${sl.id + 1}`;
function paintViz() {
  if (A.frozen || !$('vAnim').checked && A.viewMode === 'mosaic' && $('mosaic').children.length) return;
  const gap = 1500 * +$('vSpeed').value; if (Date.now() - A.lastPaint < Math.min(gap, 1500) * 0.6) return; A.lastPaint = Date.now();
  const s = A.sum; if (!s) return;
  if (A.viewMode === 'mosaic') {
    const m = $('mosaic');
    if (m.children.length !== s.slots.length) m.innerHTML = s.slots.map((sl) => `<div class="mcard" data-id="${sl.id}" data-state="${sl.state}"><div class="mh"><span>${slotLabel(sl)}</span><span class="badge">${STATE[sl.state]}</span></div><canvas></canvas><div class="pbar"><i></i></div><div class="mm sa"></div><div class="mm sb"></div></div>`).join('');
    s.slots.forEach((sl, i) => {
      const el = m.children[i]; el.dataset.state = sl.state; el.querySelector('.badge').textContent = STATE[sl.state]; el.querySelector('.pbar i').style.width = `${Math.round(sl.progress * 100)}%`;
      el.querySelector('.sa').textContent = `meilleur ${sl.bestS ? sl.bestS.toFixed(4) : '—'} · ${sl.cycles} cycles`; el.querySelector('.sb').textContent = `${STRAT[sl.strategy] || sl.strategy || '—'} · ${sl.iterations.toLocaleString('fr-FR')} it.`;
      if (sl.preview) drawLayout(el.querySelector('canvas'), sl.preview); el.onclick = () => showDetail(sl.id);
    });
  } else paintDetail();
}
function showDetail(id) { A.detail = id; A.viewMode = 'detail'; A.snap = null; $('mosaic').hidden = true; $('detail').hidden = false; $('vMosaic').classList.remove('on'); $('vDetail').classList.add('on'); $('dSlot').innerHTML = A.sum.slots.map((sl) => `<option value="${sl.id}">Simulation ${sl.id + 1}</option>`).join(''); $('dSlot').value = id; api(`/api/searches/${A.id}/watch`, { method: 'POST', body: { slot: id, on: true } }).catch(() => {}); paintDetail(); }
function hideDetail() { A.viewMode = 'mosaic'; A.detail = null; $('mosaic').hidden = false; $('detail').hidden = true; $('vMosaic').classList.add('on'); $('vDetail').classList.remove('on'); if (A.id) api(`/api/searches/${A.id}/watch`, { method: 'POST', body: { slot: null, on: false } }).catch(() => {}); A.lastPaint = 0; paintViz(); }
$('vMosaic').onclick = hideDetail; $('vDetail').onclick = () => { if (A.sum && A.sum.slots.length) showDetail(A.detail ?? 0); }; $('dBack').onclick = hideDetail; $('dSlot').onchange = () => showDetail(+$('dSlot').value);
$('vFreeze').onclick = () => { A.frozen = !A.frozen; $('vFreeze').textContent = A.frozen ? '▶ Reprendre l\'affichage' : '❚❚ Figer l\'affichage'; };
function paintDetail() {
  if (A.detail === null || !A.sum || A.frozen) return; const sl = A.sum.slots[A.detail]; if (!sl) return;
  const frame = A.snap || sl.preview; $('dState').textContent = STATE[sl.state];
  if (frame) drawLayout($('dCanvas'), frame, { labels: $('dLabels').checked, free: $('dFree').checked ? frame.free : null });
  $('dInfo').textContent = frame ? `${frame.working ? 'tentative en cours' : 'meilleure solution du cycle'}${frame.target ? ` · cible S=${frame.target.toFixed(4)}` : ''}${frame.phase ? ' · phase ' + frame.phase : ''} · conteneur ${frame.container.toFixed(4)} · meilleur du cycle ${frame.best.toFixed(4)} · ${frame.flags.reduce((a, b) => a + b, 0)} carré(s) en collision temporaire` : 'en attente d\'une image du worker…';
  const h = sl.history.map((e, i) => ({ x: i, y: e.S })); drawChart($('dChart'), { series: [{ name: 'S', points: h }], xFormat: (v) => `#${Math.round(v) + 1}`, yFormat: (v) => v.toFixed(4) });
  $('dHist').innerHTML = sl.history.slice().reverse().map((e) => `<li>S = ${e.S.toFixed(5)} · ${esc(e.status)} · ${new Date(e.t).toLocaleTimeString('fr-FR')}</li>`).join('') || '<li>aucune découverte pour l\'instant</li>';
}
$('dFree').onchange = () => { paintDetail(); };

/* --------------------------------------------------------------- classement */
function populateFilters() {
  const fs = $('fStrat'), cur = fs.value, strs = [...new Set(A.sols.map((s) => s.meta.strategy).filter(Boolean))].sort();
  if (fs.options.length !== strs.length + 1) fs.innerHTML = '<option value="">toutes</option>' + strs.map((x) => `<option value="${esc(x)}">${esc(STRAT[x] || x)}</option>`).join(''); fs.value = cur;
  const sl = $('fSlot'), c2 = sl.value, ids = [...new Set(A.sols.map((s) => s.meta.slot))].sort((a, b) => a - b);
  if (sl.options.length !== ids.length + 1) sl.innerHTML = '<option value="">tous</option>' + ids.map((i) => `<option value="${i}">${i < 0 ? 'import' : 'simulation ' + (i + 1)}</option>`).join(''); sl.value = c2;
}
let REC = [], recKey = 'n', recDir = 1;
async function loadRecords() { try { REC = (await api('/api/records')).records.filter((r) => r.best); renderRecords(); } catch { /* */ } }
function renderRecords() {
  const val = (r) => recKey === 'n' ? r.n : recKey === 'searches' ? r.searches : r.best[recKey], l = REC.slice().sort((a, b) => (val(a) - val(b)) * recDir * (recKey === 'fill' ? -1 : 1));
  $('recTable').tBodies[0].innerHTML = l.length ? l.map((r) => `<tr><td><b>${r.n}</b></td><td>${r.best.S.toFixed(5)}</td><td>${r.best.size.toFixed(5)}</td><td>${(r.best.fill * 100).toFixed(2)} %</td><td>${r.searches}</td><td><button class="btn sm recOpen" data-id="${esc(r.best.searchId)}" type="button">Ouvrir</button></td></tr>`).join('') : '<tr><td colspan="6">Aucun record pour l\'instant.</td></tr>';
}
$('recTable').addEventListener('click', (e) => {
  const b = e.target.closest('.recOpen'); if (b) return open(b.dataset.id);
  const th = e.target.closest('th[data-k]'); if (!th) return; const k = th.dataset.k; recDir = k === recKey ? -recDir : 1; recKey = k;
  for (const h of $('recTable').tHead.rows[0].cells) h.textContent = h.textContent.replace(/ [▲▼]$/, '') + (h.dataset.k === k ? (recDir > 0 ? ' ▲' : ' ▼') : '');
  renderRecords();
});
for (const id of ['fSort', 'fCat', 'fStrat', 'fSlot']) $(id).onchange = () => renderRank();
function renderRank() {
  let l = A.sols.slice(); const cat = $('fCat').value, st = $('fStrat').value, sl = $('fSlot').value;
  if (cat) l = l.filter((s) => s.category === cat); if (st) l = l.filter((s) => s.meta.strategy === st); if (sl !== '') l = l.filter((s) => String(s.meta.slot) === sl);
  const key = $('fSort').value; l.sort(key === 'S' ? (a, b) => a.S - b.S : key === 'fill' ? (a, b) => b.fill - a.fill : key === 'date' ? (a, b) => (b.meta.t || 0) - (a.meta.t || 0) : (a, b) => b.nov - a.nov);
  $('rankTable').tBodies[0].innerHTML = l.map((s, i) => `<tr data-id="${s.id}" class="${A.sel.has(s.id) ? 'sel' : ''}"><td><input type="checkbox" class="sc" ${A.sel.has(s.id) ? 'checked' : ''}> ${s.id}</td><td>${s.category === 'record' ? '★ record' : s.category}</td><td>${s.S.toFixed(5)}</td><td>${s.size.toFixed(5)}</td><td>${(s.fill * 100).toFixed(3)} %</td><td>${(s.nov ?? 0).toFixed(2)}</td><td>${esc(STRAT[s.meta.strategy] || s.meta.strategy || '')}</td><td>${s.meta.slot < 0 ? 'import' : s.meta.slot + 1}</td><td>${s.meta.t ? new Date(s.meta.t).toLocaleString('fr-FR') : ''}</td><td><button class="btn sm" data-a="view">Voir</button> <button class="btn sm" data-a="exp">JSON</button> <button class="btn sm" data-a="classic">Simulateur</button></td></tr>`).join('') || '<tr><td colspan="10">aucune solution</td></tr>';
  $('bCompare').disabled = A.sel.size < 2;
}
$('rankTable').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return; const id = +tr.dataset.id;
  if (e.target.classList.contains('sc')) { e.target.checked ? A.sel.add(id) : A.sel.delete(id); $('bCompare').disabled = A.sel.size < 2; tr.classList.toggle('sel', e.target.checked); return; }
  const a = e.target.dataset.a; if (!a) return;
  try { const s = await api(`/api/searches/${A.id}/solutions/${id}`);
    if (a === 'view') viewSolution(s); else if (a === 'exp') download(`solution-${A.id}-${id}.json`, exportObj(s)); else if (a === 'classic') openClassic(s);
  } catch (err) { fail(err); }
});
const exportObj = (s) => ({ format: 'square-packing-lab/solution', version: 1, searchId: A.id, id: s.id, n: s.solution.n, S: s.S, size: s.size ?? 1 / s.S, fill: s.fill ?? s.solution.n / s.S ** 2, units: 'carré unité dans un conteneur S×S ; taille réelle s = L/S', category: s.category, meta: s.meta, solution: s.solution });
function download(name, obj) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function viewSolution(s) { $('viewer').hidden = false; drawLayout($('vCanvas'), s.solution, { labels: true }); const an = s.solution.th.map((t) => ((((t * 180) / Math.PI) % 90) + 90) % 90);
  $('vInfo').innerHTML = `<div class="metrics"><div class="metric hl"><span>S (côtés)</span><b>${s.S.toFixed(6)}</b></div><div class="metric"><span>Taille s (L=1)</span><b>${(1 / s.S).toFixed(6)}</b></div><div class="metric"><span>Remplissage</span><b>${((s.solution.n / s.S ** 2) * 100).toFixed(3)} %</b></div><div class="metric"><span>Carrés</span><b>${s.solution.n}</b></div></div><p class="note">Catégorie : ${esc(s.category)} · graine ${s.meta.seed ?? '—'} · stratégie ${esc(STRAT[s.meta.strategy] || s.meta.strategy || '—')} · worker ${s.meta.slot < 0 ? 'import' : s.meta.slot + 1} · parents : ${(s.meta.parents || []).join(', ') || 'aucun'} · cycle ${s.meta.cycle ?? '—'}</p><p class="note">Angles (mod 90°) : min ${Math.min(...an).toFixed(1)}° · max ${Math.max(...an).toFixed(1)}° · carrés tournés (&gt; 1°) : ${an.filter((a) => a > 1 && a < 89).length}</p>`; $('viewer').scrollIntoView({ behavior: 'smooth' }); }
function openClassic(s) { const W = 20, k = W / s.S; const pl = s.solution.x.map((_, i) => [i, s.solution.x[i] * k, s.solution.y[i] * k, k, s.solution.th[i], 0]).flat(); lsSet('spl.import', { n: s.solution.n, S: s.S, W, sq: pl, label: `Parallel Lab ${A.id} #${s.id}` }); location.href = '/simulator.html?import=1'; }
$('bExportAll').onclick = async () => { try { const full = await Promise.all(A.sols.map((s) => api(`/api/searches/${A.id}/solutions/${s.id}`))); download(`elite-pool-${A.id}.json`, { format: 'square-packing-lab/pool', version: 1, searchId: A.id, solutions: full.map(exportObj) }); } catch (e) { fail(e); } };
$('fImport').onchange = async (e) => { const f = e.target.files[0]; if (!f || !A.id) return; try { const j = JSON.parse(await f.text()); const list = j.solutions || [j]; let ok = 0, ko = 0; for (const x of list) { try { await api(`/api/searches/${A.id}/solutions`, { method: 'POST', body: { solution: x.solution || x } }); ok++; } catch { ko++; } } toast(`Import : ${ok} acceptée(s), ${ko} rejetée(s) par l'autorité de validation`, ko > 0 && ok === 0); fetchSols(true); } catch (err) { fail(new Error('fichier JSON invalide')); } e.target.value = ''; };

/* --------------------------------------------------------------- comparaison */
$('bCompare').onclick = async () => {
  try {
    const sols = await Promise.all([...A.sel].slice(0, 4).map((id) => api(`/api/searches/${A.id}/solutions/${id}`))); $('compare').hidden = false;
    $('cmpGrid').innerHTML = sols.map((s, i) => { const an = s.solution.th.map((t) => ((((t * 180) / Math.PI) % 90) + 90) % 90); return `<div class="mcard"><div class="mh"><span>#${s.id} ${s.category === 'record' ? '★' : ''}</span><span>${(s.solution.n / s.S ** 2 * 100).toFixed(2)} %</span></div><canvas id="cc${i}"></canvas><div class="mm">S = ${s.S.toFixed(5)} · s = ${(1 / s.S).toFixed(5)}</div><div class="mm">${s.solution.n} carrés · angles ${Math.min(...an).toFixed(0)}–${Math.max(...an).toFixed(0)}° · ${an.filter((a) => a > 1 && a < 89).length} tournés</div></div>`; }).join('');
    sols.forEach((s, i) => drawLayout($(`cc${i}`), s.solution, { labels: true }));
    const rows = []; for (let i = 0; i < sols.length; i++) for (let j = i + 1; j < sols.length; j++) { const d = dissimilarity(sols[i].solution, sols[j].solution); rows.push(`<tr><td>#${sols[i].id} ↔ #${sols[j].id}</td><td>${(sols[j].S - sols[i].S).toFixed(5)}</td><td>${d.toFixed(3)}</td><td>${d < 0.06 ? 'même disposition (symétrie / compression)' : 'dispositions différentes'}</td></tr>`); }
    $('cmpInfo').innerHTML = `<table class="t"><thead><tr><th>Paire</th><th>Δ S</th><th>Dissimilarité (côtés)</th><th>Verdict</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="note">Dissimilarité = distance moyenne de placement (en côtés de carré) sous la meilleure des 8 symétries du carré, avec appariement des carrés (ils sont interchangeables).</p>`; $('compare').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { fail(e); }
};

/* ---------------------------------------------------------------- historique */
function renderHist() {
  const h = A.hist, t = (p) => p.t / 60000; const rec = h.map((p) => ({ x: t(p), y: p.S })), fill = h.map((p) => ({ x: t(p), y: p.fill * 100 }));
  drawChart($('hRecord'), { series: [{ name: 'S', points: rec }], xFormat: (v) => `${v.toFixed(1)} min`, yFormat: (v) => v.toFixed(4) });
  drawChart($('hFill'), { series: [{ name: 'remplissage', points: fill, color: '#7bd88f' }], xFormat: (v) => `${v.toFixed(1)} min`, yFormat: (v) => v.toFixed(2) + ' %' });
  const span = Math.max(1, h.length ? Math.max(...h.map((p) => p.t)) : 1), period = Math.max(60000, Math.ceil(span / 12 / 60000) * 60000), buckets = new Map(); for (const p of h) { const b = Math.floor(p.t / period); buckets.set(b, (buckets.get(b) || 0) + 1); }
  drawChart($('hPeriod'), { bars: true, series: [{ name: 'améliorations', points: [...buckets.entries()].map(([b, v]) => ({ x: (b * period) / 60000, y: v })), color: '#f0a830' }], xFormat: (v) => `${v.toFixed(0)} min`, yFormat: (v) => v.toFixed(0) });
  const by = {}; for (const p of h) by[p.strategy || '—'] = (by[p.strategy || '—'] || 0) + 1; const keys = Object.keys(by);
  drawChart($('hStrat'), { bars: true, series: [{ name: 'records', points: keys.map((k, i) => ({ x: i, y: by[k], label: k })), color: '#6ab0ff' }], xFormat: (v) => STRAT[keys[Math.round(v)]] || keys[Math.round(v)] || '', yFormat: (v) => v.toFixed(0) });
  const s = A.sum; if (!s) return; const first = h[0], last = h[h.length - 1];
  const cell = (k, v) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`;
  $('histStats').innerHTML = [cell('Améliorations du record', h.length), cell('Temps de recherche', fmtMs(s.searchMs)), cell('Solutions découvertes', s.counters.validSolutions), cell('Gain total sur S', first && last ? (first.S - last.S).toFixed(5) : '—'), cell('Dernière amélioration', last ? fmtMs(last.t) : '—'), cell('Cycles', s.counters.cycles)].join('');
}

/* ----------------------------------------------------------------- onglets */
for (const b of document.querySelectorAll('#ptabs button')) b.onclick = () => {
  A.tab = b.dataset.tab; for (const x of document.querySelectorAll('#ptabs button')) x.setAttribute('aria-selected', x === b); for (const p of document.querySelectorAll('.plab .tabpane')) p.classList.toggle('on', p.id === `tab-${A.tab}`);
  if (A.tab === 'rank') { fetchSols(true).then(renderRank); renderRank(); loadRecords(); } if (A.tab === 'hist') fetchHist(); if (A.tab === 'viz') { A.lastPaint = 0; paintViz(); }
};
window.addEventListener('resize', () => { if (A.tab === 'hist') renderHist(); });
window.__ppl = A;

/* ------------------------------------------------------------------ démarrage */
async function init() {
  try {
    const h = await fetch(lsGet('ppl.api', '') + '/api/health').then((r) => { if (!r.ok) throw new Error('pas de serveur à cette adresse'); return r.json(); }, () => { throw new Error('connexion impossible'); });
    A.down = 0; $('bCreate').disabled = false; $('srvStatus').textContent = 'Serveur connecté — les calculs continuent après fermeture du navigateur.'; $('srvStatus').className = 'note ok';
    const r = await api('/api/resources'); void h;
    $('srvRes').innerHTML = [['Cœurs', r.cpus], ['Charge CPU', r.load1.toFixed(2)], ['Mémoire libre', r.freeMemMB + ' Mo'], ['Workers max serveur', r.serverMaxWorkers]].map(([k, v]) => `<div class="metric"><span>${k}</span><b>${v}</b></div>`).join('');
    const list = await refreshList(); const cur = lsGet('ppl.current', null); const pick = list.find((s) => s.id === cur) || list.find((s) => s.status === 'running'); if (pick && !A.id) open(pick.id);
  } catch (e) { A.down = (A.down || 0) + 1; $('bCreate').disabled = true; $('srvStatus').textContent = `Serveur de calcul indisponible (${e.message}). Cette page exige un serveur persistant : lancez « npm run server » (en développement, « npm run dev » proxifie /api) ou saisissez l'URL de votre serveur ci-dessous. Le simulateur classique fonctionne sans serveur.`; $('srvStatus').className = 'note err'; if (!$('apiBox')) { const d = document.createElement('label'); d.className = 'f'; d.id = 'apiBox'; d.innerHTML = 'URL du serveur (hébergement séparé)<input id="apiUrl" type="url" placeholder="https://ppl.exemple.org">'; $('srvStatus').after(d); $('apiUrl').value = lsGet('ppl.api', ''); $('apiUrl').onchange = () => { lsSet('ppl.api', $('apiUrl').value.replace(/\/$/, '')); init(); }; } }
}
render(); init(); let pollT = 0; setInterval(() => { pollT += 5; if (!A.id && pollT >= Math.min(60, 10 * 2 ** Math.min(A.down || 0, 3))) { pollT = 0; init(); } }, 5000);
initA11y();
