// E2E Parallel Packing Lab : vrai serveur (worker_threads + SQLite) + vrai navigateur.
//   PW=$(npm root -g)/playwright node scripts/e2e-parallel.mjs   (après `npm run build`)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PW || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'ppl-e2e-')), PORT = 8791, base = `http://127.0.0.1:${PORT}`;
const startServer = () => spawn('node', ['server/index.js'], { env: { ...process.env, PPL_PORT: String(PORT), PPL_DB: join(dir, 'e.sqlite'), NODE_NO_WARNINGS: '1' }, stdio: 'inherit' });
let srv = startServer(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/health'); break; } catch { await sleep(200); } }
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/EventSource|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.goto(base + '/parallel.html'); await p.waitForFunction(() => /Serveur connecté/.test(document.getElementById('srvStatus').textContent), null, { timeout: 8000 }); ok(true, 'serveur connecté depuis la page');
await p.fill('#pN', '10'); await p.fill('#pSims', '4'); await p.fill('#pSeed', '3'); await p.click('summary:has-text("Paramètres avancés")'); await p.fill('#pCycle', '1500'); await p.click('#bCreate');
await p.waitForFunction(() => window.__ppl.sum && window.__ppl.sum.counters.cycles >= 3, null, { timeout: 40000 }); ok(true, 'recherche lancée, cycles terminés');
const m = await p.evaluate(() => ({ active: window.__ppl.sum.resources.active, req: window.__ppl.sum.resources.requested, best: window.__ppl.sum.best?.S, status: window.__ppl.sum.status }));
ok(m.status === 'running' && m.req === 4 && m.active >= 1, `dashboard : ${m.active} worker(s) actif(s) pour ${m.req} demandés, S=${m.best?.toFixed(4)}`);
await p.screenshot({ path: '/tmp/claude-0/pl-dash.png' });
await p.click('#ptabs button[data-tab=viz]'); await p.waitForFunction(() => document.querySelectorAll('#mosaic .mcard').length === 4, null, { timeout: 10000 }); ok(true, 'mosaïque : 4 cartes');
await p.waitForFunction(() => [...document.querySelectorAll('#mosaic canvas')].some((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < d.length; i += 400) if (d[i] > 200 && d[i + 2] < 120) k++; return k > 3; }), null, { timeout: 15000 }); ok(true, 'aperçus dessinés (états réels des workers)');
await p.click('#mosaic .mcard'); await p.waitForFunction(() => !document.getElementById('detail').hidden); await p.waitForFunction(() => /conteneur/.test(document.getElementById('dInfo').textContent), null, { timeout: 10000 }); ok(true, 'vue détaillée avec état du moteur');
await p.screenshot({ path: '/tmp/claude-0/pl-viz.png' }); await p.click('#dBack');
await p.click('#ptabs button[data-tab=rank]'); await p.waitForFunction(() => document.querySelectorAll('#rankTable tbody tr[data-id]').length >= 1, null, { timeout: 10000 });
const rows = await p.locator('#rankTable tbody tr[data-id]').count(); ok(rows >= 1, `classement : ${rows} solution(s)`);
if (rows >= 2) { await p.locator('#rankTable .sc').nth(0).check(); await p.locator('#rankTable .sc').nth(1).check(); await p.click('#bCompare'); await p.waitForSelector('#cmpGrid .mcard'); ok(true, 'comparaison côte à côte'); }
await p.locator('#rankTable tbody tr[data-id] [data-a=view]').first().click(); await p.waitForFunction(() => !document.getElementById('viewer').hidden); ok(true, 'consultation d\'une solution');
const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('#rankTable tbody tr[data-id] [data-a=exp]').first().click()]); ok(dl.suggestedFilename().endsWith('.json'), 'export JSON');
await p.click('#ptabs button[data-tab=hist]'); await p.waitForTimeout(800); ok(await p.evaluate(() => document.getElementById('hRecord').width > 0 && document.querySelectorAll('#histStats .metric').length > 0), 'historique : graphiques + statistiques');
await p.screenshot({ path: '/tmp/claude-0/pl-hist.png' });
// import falsifié rejeté
await p.click('#ptabs button[data-tab=rank]');
const bad = await p.evaluate(async (id) => (await fetch(`/api/searches/${id}/solutions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ solution: { n: 10, S: 2, x: Array(10).fill(1), y: Array(10).fill(1), th: Array(10).fill(0) } }) })).status, await p.evaluate(() => window.__ppl.id)); ok(bad === 422, 'import falsifié rejeté par le serveur (422)');
// ouverture dans le simulateur classique
const sol = await p.evaluate(async () => { const id = window.__ppl.id, l = (await (await fetch(`/api/searches/${id}/solutions`)).json()).solutions; return { id, sid: l[0].id }; });
await p.locator('#rankTable tbody tr[data-id] [data-a=classic]').first().click(); await p.waitForURL(/simulator\.html/); await p.waitForFunction(() => /revalidé dans le navigateur/.test(document.getElementById('litBox').textContent), null, { timeout: 10000 }); ok(/valide/.test(await p.textContent('#litBox')), 'solution ouverte dans le simulateur classique (revalidée)');
// fermeture du navigateur : le serveur continue
await p.close(); const c0 = (await (await fetch(`${base}/api/searches/${sol.id}`)).json()).counters.cycles; await sleep(4000); const c1 = (await (await fetch(`${base}/api/searches/${sol.id}`)).json()).counters.cycles;
ok(c1 > c0, `le serveur continue sans navigateur (cycles ${c0} → ${c1})`);
const p2 = await b.newPage(); await p2.goto(base + '/parallel.html'); await p2.waitForFunction(() => window.__ppl.sum && window.__ppl.sum.counters.cycles >= 1, null, { timeout: 10000 }); ok(true, 'réouverture : recherche active récupérée automatiquement');
// redémarrage du serveur : reprise depuis les checkpoints
await p2.evaluate(() => fetch('/api/searches/' + window.__ppl.id + '/pause', { method: 'POST' })); await sleep(300); const bestBefore = (await (await fetch(`${base}/api/searches/${sol.id}`)).json()).best.S;
await p2.evaluate(() => fetch('/api/searches/' + window.__ppl.id + '/resume', { method: 'POST' })); await sleep(2500);
srv.kill('SIGKILL'); await sleep(500); srv = startServer(); for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/health'); break; } catch { await sleep(200); } }
await sleep(2500); const after = await (await fetch(`${base}/api/searches/${sol.id}`)).json(); ok(after.best.S <= bestBefore + 1e-9 && after.status === 'running', `redémarrage serveur : record conservé (${after.best.S.toFixed(4)} ≤ ${bestBefore.toFixed(4)}), recherche reprise`);
await p2.waitForFunction(() => document.getElementById('connBanner').hidden, null, { timeout: 15000 }); ok(true, 'le navigateur se reconnecte et se resynchronise');
await fetch(`${base}/api/searches/${sol.id}/stop`, { method: 'POST' });
// classement par N : tableau des records, tri, boutons « tout arrêter » et « tout supprimer » (double confirmation)
await p2.click('#ptabs button[data-tab=rank]'); await p2.waitForFunction(() => document.querySelectorAll('#recTable tbody tr td b').length >= 1, null, { timeout: 8000 });
ok(await p2.evaluate(() => [...document.querySelectorAll('#recTable tbody tr')].every((r) => r.cells.length === 6 && /^\d+$/.test(r.cells[0].textContent) && parseFloat(r.cells[1].textContent) >= Math.sqrt(+r.cells[0].textContent) - 1e-9)), 'classement par N : records cohérents (S ≥ √N)');
await p2.click('#recTable th[data-k=S]'); ok((await p2.textContent('#recTable th[data-k=S]')).includes('▲'), 'classement par N : tri par S');
p2.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept('SUPPRIMER'); else await d.accept(); });
await p2.click('#bStopAll'); await p2.waitForFunction(() => window.__ppl.sum && window.__ppl.sum.status === 'stopped', null, { timeout: 8000 }); ok(true, 'bouton « Tout arrêter »');
await p2.click('.danger summary'); await p2.click('#bDelAll'); await p2.waitForFunction(async () => (await (await fetch('/api/searches')).json()).searches.length === 0, null, { timeout: 8000 }); ok(true, 'bouton « Tout supprimer » (double confirmation)');
await p2.setViewportSize({ width: 390, height: 800 }); await p2.waitForTimeout(300); const sw = await p2.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 392, `mobile sans scroll horizontal (${sw}px)`);
await b.close(); srv.kill(); await sleep(300); rmSync(dir, { recursive: true, force: true });
if (errors.length) { console.log('ERREURS JS:\n' + errors.join('\n')); fails++; }
console.log(fails ? `\n${fails} échec(s)` : '\nE2E PARALLEL OK'); process.exit(fails ? 1 : 0);
