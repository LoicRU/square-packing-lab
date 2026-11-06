// Intégration : vrais worker_threads + SQLite + HTTP + SSE + redémarrage du serveur.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer } from '../server/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(100); } };
const api = (base, token) => async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, body: j }; };

describe('serveur Parallel Packing Lab', () => {
  it('sécurité : refuse un hôte public sans token ; 401 sans token ; validation des paramètres ; entrées malformées', async () => {
    expect(() => createServer({ host: '0.0.0.0', db: ':memory:' })).toThrow(/PPL_TOKEN/);
    const app = createServer({ db: ':memory:', token: 'secret-token-123', tickMs: 50, port: 0 }); const port = await app.listen(), call = api(`http://127.0.0.1:${port}`, 'secret-token-123'), anon = api(`http://127.0.0.1:${port}`);
    expect((await anon('GET', '/api/health')).status).toBe(200);
    expect((await anon('GET', '/api/searches')).status).toBe(401);
    expect((await api(`http://127.0.0.1:${port}`, 'mauvais')('GET', '/api/searches')).status).toBe(401);
    expect((await call('POST', '/api/searches', { params: { n: 0, sims: 4 } })).status).toBe(400);
    expect((await call('POST', '/api/searches', { params: { n: 17, sims: 9999 } })).status).toBe(400);
    expect((await call('GET', '/api/searches/../../etc')).status).toBe(404);
    expect((await call('GET', '/api/searches/zzzz')).status).toBe(400);
    const bad = await fetch(`http://127.0.0.1:${port}/api/searches`, { method: 'POST', headers: { authorization: 'Bearer secret-token-123', 'content-type': 'application/json' }, body: '{pas du json' }); expect(bad.status).toBe(400);
    expect((await call('GET', '/../../etc/passwd')).status).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it('recherche réelle en threads : workers en parallèle, solutions valides, import rejeté/accepté, arrêt, reprise après redémarrage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppl-')), db = join(dir, 'ppl.sqlite');
    try {
      let app = createServer({ db, tickMs: 50, port: 0 }); let port = await app.listen(); let call = api(`http://127.0.0.1:${port}`);
      const created = await call('POST', '/api/searches', { params: { n: 10, sims: 3, seed: 5, cycleMs: 1500, checkpointMs: 2000 } }); expect(created.status).toBe(201); const id = created.body.id;
      let maxActive = 0;
      const s1 = await until(async () => { const s = (await call('GET', `/api/searches/${id}`)).body; maxActive = Math.max(maxActive, s.resources.active); return s.counters.cycles >= 4 && s.best ? s : null; });
      expect(maxActive).toBeGreaterThanOrEqual(2); expect(s1.best.S).toBeLessThanOrEqual(Math.ceil(Math.sqrt(10)) + 1e-9);
      const sols = (await call('GET', `/api/searches/${id}/solutions`)).body.solutions; expect(sols.length).toBeGreaterThan(0);
      const one = (await call('GET', `/api/searches/${id}/solutions/${sols[0].id}`)).body; expect(one.solution.x).toHaveLength(10);
      // import : falsifié rejeté, valide accepté
      expect((await call('POST', `/api/searches/${id}/solutions`, { solution: { ...one.solution, x: one.solution.x.map(() => 1) } })).status).toBe(422);
      expect((await call('POST', `/api/searches/${id}/solutions`, { solution: one.solution })).status).toBe(200);
      // SSE : synchronisation complète à la connexion
      const ev = await fetch(`http://127.0.0.1:${port}/api/searches/${id}/events`); const rd = ev.body.getReader(); let txt = ''; const t0 = Date.now(); while (!txt.includes('event: state') && Date.now() - t0 < 5000) txt += new TextDecoder().decode((await rd.read()).value); await rd.cancel(); expect(txt).toContain('event: state');
      const pause = await call('POST', `/api/searches/${id}/pause`); expect(pause.body.status).toBe('paused');
      await call('POST', `/api/searches/${id}/resume`);
      await sleep(2500); // laisse un checkpoint s'écrire
      const bestBefore = (await call('GET', `/api/searches/${id}`)).body.best.S;
      // « crash » serveur : on ferme brutalement SANS shutdown propre (le statut reste « running » en base)
      app.manager.shutdown = async () => {}; clearInterval(app.manager.lagTimer);
      for (const c of app.manager.searches.values()) { clearTimeout(c.timer); for (const w of c.workers) await w.handle.terminate(); }
      await new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }); app.store.close();
      // redémarrage
      app = createServer({ db, tickMs: 50, port: 0 }); const rec = app.manager.recover(); expect(rec).toEqual([{ id, resumed: true }]); port = await app.listen(); call = api(`http://127.0.0.1:${port}`);
      const s2 = (await call('GET', `/api/searches/${id}`)).body; expect(s2.best.S).toBeLessThanOrEqual(bestBefore + 1e-9); expect(s2.counters.cycles).toBeGreaterThanOrEqual(1);
      const c0 = s2.counters.cycles; await until(async () => (await call('GET', `/api/searches/${id}`)).body.counters.cycles >= c0 + 2);
      const st = await call('POST', `/api/searches/${id}/stop`); expect(st.body.status).toBe('stopped');
      const h = (await call('GET', `/api/searches/${id}/history`)).body.history; expect(h.length).toBeGreaterThan(0); for (let i = 1; i < h.length; i++) expect(h[i].S).toBeLessThanOrEqual(h[i - 1].S + 1e-12);
      const final = (await call('GET', `/api/searches/${id}`)).body; expect(final.best.S).toBeLessThanOrEqual(bestBefore + 1e-9);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
  it('tout arrêter : stoppe toutes les recherches (running et paused), garde les résultats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppl-')), db = join(dir, 'ppl.sqlite');
    try {
      const app = createServer({ db, tickMs: 50, port: 0 }); const port = await app.listen(); const call = api(`http://127.0.0.1:${port}`);
      const ids = [];
      for (const seed of [1, 2]) { const c = await call('POST', '/api/searches', { params: { n: 10, sims: 2, seed, cycleMs: 1500 } }); ids.push(c.body.id); }
      await until(async () => (await call('GET', `/api/searches/${ids[0]}`)).body.counters.cycles >= 1);
      await call('POST', `/api/searches/${ids[1]}/pause`);
      const r = await call('POST', '/api/stop-all'); expect(r.status).toBe(200); expect(r.body.stopped).toBe(2);
      for (const id of ids) { const s = (await call('GET', `/api/searches/${id}`)).body; expect(s.status).toBe('stopped'); expect(s.resources.active).toBe(0); }
      expect((await call('GET', `/api/searches/${ids[0]}/solutions`)).body.solutions.length).toBeGreaterThan(0);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
  it('records par N : meilleur résultat revalidé pour chaque nombre de carrés', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppl-')), db = join(dir, 'ppl.sqlite');
    try {
      const app = createServer({ db, tickMs: 50, port: 0 }); const port = await app.listen(); const call = api(`http://127.0.0.1:${port}`);
      for (const n of [5, 10]) await call('POST', '/api/searches', { params: { n, sims: 1, seed: 3, cycleMs: 1000 } });
      const rec = await until(async () => { const r = (await call('GET', '/api/records')).body.records; return r.length === 2 ? r : null; });
      expect(rec.map((r) => r.n)).toEqual([5, 10]);
      for (const r of rec) { expect(r.best.S).toBeGreaterThanOrEqual(Math.sqrt(r.n) - 1e-9); expect(r.best.fill).toBeLessThanOrEqual(1); expect(r.best.searchId).toBeTruthy(); }
      await call('POST', '/api/stop-all'); await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
  it('tout supprimer : exige la confirmation, efface recherches et solutions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppl-')), db = join(dir, 'ppl.sqlite');
    try {
      const app = createServer({ db, tickMs: 50, port: 0 }); const port = await app.listen(); const call = api(`http://127.0.0.1:${port}`);
      const ids = []; for (const seed of [1, 2]) ids.push((await call('POST', '/api/searches', { params: { n: 5, sims: 1, seed, cycleMs: 1000 } })).body.id);
      await until(async () => (await call('GET', `/api/searches/${ids[0]}`)).body.counters.cycles >= 1);
      expect((await call('DELETE', '/api/searches')).status).toBe(400);
      expect((await call('GET', '/api/searches')).body.searches).toHaveLength(2);
      const r = await call('DELETE', '/api/searches?confirm=yes'); expect(r.status).toBe(200); expect(r.body.deleted).toBe(2);
      expect((await call('GET', '/api/searches')).body.searches).toHaveLength(0);
      expect((await call('GET', `/api/searches/${ids[0]}`)).status).toBe(404);
      expect((await call('GET', '/api/records')).body.records).toHaveLength(0);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
  it('sécurité navigateur : CSRF, DNS rebinding, content-type, en-têtes, jeton en query limité au flux SSE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppl-')), db = join(dir, 'ppl.sqlite');
    try {
      const app = createServer({ db, tickMs: 50, port: 0 }); const port = await app.listen(); const base = `http://127.0.0.1:${port}`;
      const post = (headers, body = '{}') => fetch(base + '/api/searches', { method: 'POST', headers, body });
      // site tiers : Origin étranger → refusé, même en requête « simple »
      expect((await post({ 'content-type': 'text/plain', origin: 'https://evil.example' })).status).toBe(403);
      expect((await post({ 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403);
      expect((await fetch(base + '/api/stop-all', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
      // content-type non JSON (requête simple sans preflight) → refusé
      expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
      // DNS rebinding : Host étranger sur un serveur local
      expect(await new Promise((resolve) => { http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); }); })).toBe(421);
      // en-têtes de sécurité sur API et pages statiques
      const h = await fetch(base + '/api/health'); for (const k of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) expect(h.headers.get(k)).toBeTruthy();
      expect(h.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      // chemins malveillants
      expect((await fetch(base + '/%E0%A4%A')).status).toBe(400);
      expect((await fetch(base + '/.env')).status).toBeGreaterThanOrEqual(400);
      await app.close();
      const app2 = createServer({ db, tickMs: 50, port: 0, token: 'secret-token-123' }); const p2 = await app2.listen(); const b2 = `http://127.0.0.1:${p2}`;
      expect((await fetch(b2 + '/api/searches?token=secret-token-123')).status).toBe(401); // query refusée hors SSE
      expect((await fetch(b2 + '/api/searches', { headers: { authorization: 'Bearer secret-token-123' } })).status).toBe(200);
      for (let i = 0; i < 22; i++) await fetch(b2 + '/api/searches', { headers: { authorization: 'Bearer faux' } });
      expect((await fetch(b2 + '/api/searches', { headers: { authorization: 'Bearer secret-token-123' } })).status).toBe(429); // brute force freiné
      await app2.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
