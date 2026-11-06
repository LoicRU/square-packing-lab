// Audit accessibilité (axe-core WCAG 2.x AA + bonnes pratiques) et responsive (7 tailles) sur le build.
//   npm run build && npx vite preview --port 4173 &   PW=$(npm root -g)/playwright node scripts/audit-site.mjs
// Échoue (code 1) si : violation axe, débordement horizontal, ou erreur JS. Parallel Lab sans serveur : l'erreur réseau attendue est ignorée.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const axeSrc = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const base = process.env.BASE || 'http://127.0.0.1:4173';
const PAGES = ['index', 'simulator', 'algorithms', 'learn', 'about', 'parallel'];
const VPS = { 'smartphone compact 320': [320, 640], 'smartphone 390': [390, 844], 'smartphone large 430': [430, 932], 'tablette 820': [820, 1180], 'portable 1366': [1366, 768], 'desktop 1920': [1920, 1080], 'grand écran 2560': [2560, 1440] };
const b = await chromium.launch(); let fails = 0;
for (const p of PAGES) {
  const pg = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage(), errs = [];
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/status of 5\d\d|status of 404/.test(m.text())) errs.push(m.text()); });
  await pg.goto(`${base}/${p}.html`, { waitUntil: 'networkidle' }); await pg.addScriptTag({ content: axeSrc });
  const r = await pg.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
  const out = r.violations.map((v) => `${v.impact} ${v.id} ×${v.nodes.length}`);
  for (const [name, [w, h]] of Object.entries(VPS)) {
    await pg.setViewportSize({ width: w, height: h }); await pg.waitForTimeout(120);
    const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 1) out.push(`débordement horizontal ${o}px à ${name}`);
  }
  if (errs.length) out.push('erreurs JS : ' + errs.join(' | '));
  console.log(`${out.length ? 'FAIL' : 'OK  '} ${p}${out.length ? ' — ' + out.join(' ; ') : ''}`); if (out.length) fails++;
  await pg.context().close();
}
await b.close(); process.exit(fails ? 1 : 0);
