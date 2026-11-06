// Test de fumée e2e (Playwright) sur le build : node scripts/e2e.mjs  (nécessite `npm run build` + preview sur :4173)
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright');
const base = process.env.BASE || 'http://localhost:4173';
const errors = [], log = (...a) => console.log(...a);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ok = (c, m) => { log((c ? 'OK   ' : 'FAIL ') + m); if (!c) errors.push('assert: ' + m); };

for (const path of ['/', '/algorithms.html', '/learn.html', '/about.html']) { await p.goto(base + path); ok((await p.title()).length > 5, `page ${path}`); }
await p.goto(base + '/learn.html'); ok((await p.locator('#knownTable tbody tr').count()) === 40, 'table s(n) 40 lignes');

await p.goto(base + '/simulator.html');

await p.waitForFunction(() => window.__spl && window.__spl.S.instance, null, { timeout: 8000 });
ok(true, 'worker prêt + instance');
await p.waitForFunction(() => window.__spl && window.__spl.S.instance, null, { timeout: 8000 });
// ---- problème « taille maximale » (mode par défaut)
ok((await p.evaluate(() => window.__spl.S.config.problem)) === 'maxsize', 'mode par défaut : taille maximale');
// ---- pipeline Circle → Square, 17 carrés : lecteur, timeline, images enregistrées
ok((await p.evaluate(() => window.__spl.S.config.msStrategy)) === 'pipeline', 'stratégie par défaut : pipeline');
await p.fill('#n', '17'); await p.dispatchEvent('#n', 'input'); await p.fill('#msIter', '12000'); await p.dispatchEvent('#msIter', 'input'); await p.waitForTimeout(500);
ok(await p.isVisible('#player'), 'lecteur visible');
ok((await p.locator('#timeline .seg').count()) === 5, 'timeline : 5 phases');
await p.click('#bPlay');
await p.waitForFunction(() => document.querySelectorAll('#timeline .seg:not(.todo)').length >= 2, null, { timeout: 30000 });
ok(true, 'phases 1-2 enregistrées pendant le calcul');
await p.click('#bPlay'); // pause de la lecture : le calcul continue
await p.waitForFunction(() => document.getElementById('phaseTag').textContent.length > 3);
await p.waitForFunction(() => /images/.test(document.querySelector('#timeline .seg:not(.todo) span')?.textContent || ''), null, { timeout: 30000 });
await p.waitForFunction(() => document.querySelectorAll('#timeline .seg:not(.todo)').length === 5, null, { timeout: 120000 });
ok(true, 'les 5 phases ont été calculées');
const f0 = await p.evaluate(() => +document.getElementById('scrub').max); ok(f0 > 30, `images enregistrées : ${f0 + 1}`);
await p.click('#timeline .seg[data-p="1"]'); const t1 = await p.textContent('#phaseTag'); ok(/Circle Packing/.test(t1), `saut à la phase 2 (${t1})`);
await p.click('#bNextF'); await p.click('#bPrevF');
await p.click('#timeline .seg[data-p="2"]'); ok(/Transformation/.test(await p.textContent('#phaseTag')), 'saut à la phase 3');
await p.click('#tFree'); await p.click('#timeline .seg[data-p="4"]'); await p.waitForTimeout(600);
ok(await p.evaluate(() => !!window.__spl.renderer.overlay), 'surcouche zones libres/trajectoires');
await p.screenshot({ path: (process.env.SHOT || '/tmp/sim') + '-pipe.png' });
await p.click('#tFree');
await p.waitForFunction(() => window.__spl.S.lastDone, null, { timeout: 120000 });
const pv = await p.evaluate(() => ({ phases: document.querySelectorAll('#phaseTable tbody tr').length, ver: document.getElementById('verifyBox').textContent, v: window.__spl.S.lastDone.verify, S: window.__spl.S.msS }));
ok(pv.phases === 5, 'tableau de statistiques : 5 phases'); ok(pv.v && pv.v.valid && /valide/.test(pv.ver), `vérification indépendante : valide (S=${pv.S.toFixed(4)})`);
await p.fill('#n', '5'); await p.dispatchEvent('#n', 'input'); await p.fill('#msIter', '60000'); await p.dispatchEvent('#msIter', 'input'); await p.waitForTimeout(400);
for (let i = 0; i < 7; i++) await p.click('#bFast');
await p.click('#bPlay');
await p.waitForFunction(() => window.__spl.S.state === 'done', null, { timeout: 90000 });
const ms = await p.evaluate(() => ({ S: window.__spl.S.msS, st: window.__spl.S.lastDone.classification.status, coll: window.__spl.S.lastDone.stats.collisions, valid: window.__spl.S.lastDone.stats.valid }));
ok(ms.valid && ms.coll === 0 && ms.st !== 'invalid' && ms.S < 2.9, `maxsize N=5 : S=${ms.S.toFixed(4)} (${ms.st}), 0 collision`);
ok((await p.locator('#angTable tbody tr').count()) === 5, 'tableau des angles : 5 lignes');
await p.click('.tabs button[data-tab=cmp]'); await p.selectOption('#attCount', '3'); await p.click('#bAttempts');
await p.waitForFunction(() => !document.getElementById('bAttempts').disabled, null, { timeout: 120000 });
ok((await p.locator('#attTable tbody tr').count()) >= 3, 'tentatives multiples');
await p.screenshot({ path: (process.env.SHOT || '/tmp/sim') + '-ms.png' });
// ---- ancien mode : packing général
await p.click('label:has(input[name=problem][value=pack])'); await p.waitForTimeout(500);
await p.fill('#n', '50'); await p.dispatchEvent('#n', 'input'); await p.fill('#W', '13'); await p.dispatchEvent('#W', 'input');
// exécution complète à vitesse infinie pour chaque algorithme
for (const algo of ['maxrects', 'guillotine', 'skyline', 'shelf', 'anneal', 'forces', 'circle2square']) {
  await p.selectOption('#algorithm', algo);
  await p.fill('#iterations', '800'); await p.dispatchEvent('#iterations', 'input');
  await p.waitForTimeout(400);
  for (let i = 0; i < 7; i++) await p.click('#bFast');
  await p.click('#bPlay');
  await p.waitForFunction(() => window.__spl.S.state === 'done', null, { timeout: 60000 });
  const r = await p.evaluate(() => ({ cls: window.__spl.S.lastDone.classification.status, fill: window.__spl.S.lastDone.stats.fill, coll: window.__spl.S.lastDone.stats.collisions }));
  ok(r.cls !== 'invalid' && r.coll === 0 && r.fill > 0.2, `${algo}: ${r.cls}, remplissage ${(r.fill * 100).toFixed(1)} %`);
}
// pause / reprise / pas à pas / reset
await p.selectOption('#algorithm', 'maxrects'); await p.waitForTimeout(400);
await p.click('#bSlow'); await p.click('#bSlow'); await p.click('#bSlow'); await p.click('#bSlow'); await p.click('#bSlow'); await p.click('#bSlow');
await p.click('#bPlay'); await p.waitForTimeout(500); await p.click('#bPlay');
ok((await p.evaluate(() => window.__spl.S.state)) === 'paused', 'pause');
await p.click('#bStep'); await p.click('#bReset'); await p.waitForTimeout(300);
ok((await p.evaluate(() => window.__spl.S.state)) === 'idle', 'reset');
// n=1000
await p.fill('#n', '1000'); await p.dispatchEvent('#n', 'input'); await p.fill('#W', '55'); await p.dispatchEvent('#W', 'input'); await p.waitForTimeout(500);
for (let i = 0; i < 7; i++) await p.click('#bFast');
const t0 = Date.now(); await p.click('#bPlay'); await p.waitForFunction(() => window.__spl.S.state === 'done', null, { timeout: 60000 });
ok(true, `n=1000 maxrects terminé en ${Date.now() - t0} ms (UI incl.)`);
// comparaison
await p.fill('#n', '60'); await p.dispatchEvent('#n', 'input'); await p.fill('#W', '20'); await p.dispatchEvent('#W', 'input'); await p.waitForTimeout(400);
await p.click('.tabs button[data-tab=cmp]'); await p.click('#bCompare');
await p.waitForFunction(() => !document.getElementById('bCompare').disabled, null, { timeout: 120000 });
ok((await p.locator('#cmpTable tbody tr').count()) === 7, 'comparaison : 7 lignes');
await p.click('#cmpTable tbody tr:first-child'); ok(!(await p.locator('#bBackLive').isHidden()), 'aperçu de disposition');
// expérience + étude
await p.click('.tabs button[data-tab=exp]'); await p.click('#bStudy');
await p.waitForFunction(() => !document.getElementById('bStudy').disabled, null, { timeout: 120000 });
ok((await p.locator('#stTable tbody tr').count()) === 4, 'étude C→S : 4 lignes');
// passage à l'échelle
await p.fill('#scNs', '10, 50, 100'); await p.click('#bScale');
await p.waitForFunction(() => !document.getElementById('bScale').disabled, null, { timeout: 180000 });
ok((await p.locator('#scTable tbody tr').count()) > 0, 'passage à l’échelle');
await p.screenshot({ path: process.env.SHOT || '/tmp/sim.png' });
// export / config
const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#bExport'); await p.click('[data-ex=json]'); })()]);
ok(dl.suggestedFilename().endsWith('.json'), 'export JSON');
// mobile
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 392, `mobile sans scroll horizontal (${sw}px)`);
await p.screenshot({ path: (process.env.SHOT || '/tmp/sim') + '-mobile.png' });
await b.close();
if (errors.length) { console.log('\nERREURS:\n' + errors.join('\n')); process.exit(1); } else console.log('\nE2E OK');
