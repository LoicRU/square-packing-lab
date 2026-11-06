// Intégrité statique du site : SEO, structure HTML, liens, accessibilité de base, cohérence de la navigation.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const PAGES = ['index', 'simulator', 'algorithms', 'learn', 'about', 'parallel'];
const html = Object.fromEntries(PAGES.map((p) => [p, readFileSync(`${p}.html`, 'utf8')]));
const PATH = (p) => (p === 'index' ? '/' : `/${p}.html`);
const ids = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

describe('pages HTML', () => {
  for (const p of PAGES) {
    describe(p, () => {
      const s = html[p];
      it('métadonnées de base', () => {
        expect(s).toMatch(/<html lang="fr">/);
        const title = /<title>(.*?)<\/title>/.exec(s)?.[1] ?? ''; expect(title.length).toBeGreaterThan(15); expect(title.length).toBeLessThanOrEqual(95);
        const d = /<meta name="description" content="(.*?)">/.exec(s)?.[1] ?? ''; expect(d.length).toBeGreaterThan(50); expect(d.length).toBeLessThanOrEqual(220);
        expect(s).toContain(`<link rel="canonical" href="https://square-packing-lab.example${PATH(p)}">`);
        expect(s).toMatch(/name="viewport"/); expect(s).toMatch(/og:image" content="[^"]+og\.png"/); expect(s).toMatch(/twitter:card" content="summary_large_image"/);
        expect(s).toContain(`og:url" content="https://square-packing-lab.example${PATH(p)}"`);
      });
      it('un seul H1 et ordre des titres sans saut', () => {
        expect((s.match(/<h1[\s>]/g) || []).length).toBe(1);
        let last = 0; for (const m of s.matchAll(/<h([1-6])[\s>]/g)) { const l = +m[1]; expect(l - last).toBeLessThanOrEqual(1); last = l; }
      });
      it('aucun id dupliqué, aucun attribut id répété sur un même élément', () => {
        const all = ids(s); expect(all.length - new Set(all).size).toBe(0);
        expect(/<[a-z0-9]+\s[^>]*\sid="[^"]*"[^>]*\sid="/i.test(s)).toBe(false);
      });
      it('liens internes et ancres valides', () => {
        for (const m of s.matchAll(/href="([^"]+)"/g)) {
          const h = m[1]; if (/^(https?:|mailto:|data:)/.test(h) && !h.includes('square-packing-lab.example')) continue;
          const [path, hash] = h.replace('https://square-packing-lab.example', '').split('#');
          if (path && !/^\/src\//.test(path)) { const f = path === '/' ? 'index.html' : path.slice(1); expect(existsSync(f) || existsSync(`public/${f}`), `${p}: ${h}`).toBe(true); }
          if (hash) { const t = path && path !== PATH(p) ? readFileSync(path === '/' ? 'index.html' : path.slice(1), 'utf8') : s; expect(ids(t), `${p}: ancre #${hash}`).toContain(hash); }
        }
      });
      it('lien d’évitement, main, images avec alternative, boutons sans nom vide', () => {
        expect(s).toMatch(/class="skip" href="#/); expect(s).toMatch(/<main[\s>]/);
        for (const m of s.matchAll(/<img\b[^>]*>/g)) expect(m[0]).toMatch(/\salt="/);
        for (const m of s.matchAll(/<button\b[^>]*>\s*<\/button>/g)) expect(m[0]).toMatch(/aria-label=/);
      });
      it('navigation commune identique et page courante marquée', () => {
        const nav = /<nav class="links"[^>]*>(.*?)<\/nav>/s.exec(s)?.[1] ?? '';
        expect(nav).toContain('aria-current="page"'); expect((nav.match(/aria-current="page"/g) || []).length).toBe(1);
        const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]); expect(hrefs).toEqual(['/', '/simulator.html', '/parallel.html', '/algorithms.html', '/learn.html', '/about.html']);
      });
      it('aucun script ou style tiers (CSP stricte)', () => {
        for (const m of s.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) expect(m[1].startsWith('https://square-packing-lab.example'), m[1]).toBe(true);
        expect(s).not.toMatch(/<script(?![^>]*(?:type="module"|application\/ld\+json))[^>]*>[^<]/);
      });
    });
  }
  it('JSON-LD valide', () => { for (const p of PAGES) for (const m of html[p].matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) expect(() => JSON.parse(m[1])).not.toThrow(); });
});

describe('sitemap, robots, 404', () => {
  const sm = readFileSync('public/sitemap.xml', 'utf8'), robots = readFileSync('public/robots.txt', 'utf8');
  it('le sitemap liste exactement les pages indexables', () => {
    for (const p of PAGES) { const idx = !/name="robots" content="noindex/.test(html[p]); expect(sm.includes(`<loc>https://square-packing-lab.example${PATH(p)}</loc>`), p).toBe(idx); }
  });
  it('robots.txt référence le sitemap et protège /api/', () => { expect(robots).toContain('Sitemap: https://square-packing-lab.example/sitemap.xml'); expect(robots).toContain('Disallow: /api/'); });
  it('page 404 présente et non indexée', () => { const s = readFileSync('public/404.html', 'utf8'); expect(s).toContain('noindex'); expect(existsSync('public/og.png')).toBe(true); });
});

describe('configurations d’hébergement', () => {
  it('CSP identique et stricte dans les 3 fichiers', () => {
    const grab = (f) => /default-src[^"\n]*/.exec(readFileSync(f, 'utf8'))?.[0].trim();
    const a = grab('vercel.json'), b = grab('netlify.toml'), c = grab('public/_headers');
    expect(a).toBe(b); expect(b).toBe(c); expect(a).toContain("frame-ancestors 'none'"); expect(a).toContain("object-src 'none'"); expect(a).not.toContain('unsafe-eval'); expect(/script-src 'self'(;|$)/.test(a)).toBe(true);
  });
});
