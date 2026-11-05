/**
 * Serveur Parallel Packing Lab — HTTP + SSE, zéro dépendance.
 *  Variables : PPL_PORT (8787) · PPL_HOST (127.0.0.1) · PPL_TOKEN (obligatoire si l'hôte n'est pas local) · PPL_DB (data/ppl.sqlite)
 *              PPL_MAX_WORKERS · PPL_MAX_RUNNING · PPL_WORKER_MB · PPL_ORIGIN (CORS) · PPL_STATIC (dist) · PPL_AUTORESUME (1)
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { SqliteStore } from './store.js';
import { SearchManager } from './manager.js';
import { judge } from '../src/parallel/authority.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const hostOnly = (h) => (h || '').replace(/^\[|\]?(:\d+)?$/g, '').toLowerCase();

export function createServer(opts = {}) {
  const env = process.env, host = opts.host ?? env.PPL_HOST ?? '127.0.0.1', token = opts.token ?? env.PPL_TOKEN ?? '', port = opts.port ?? +(env.PPL_PORT || 8787);
  if (!LOOPBACK.has(host) && !token) throw new Error('PPL_TOKEN est obligatoire quand le serveur écoute hors de localhost');
  const store = opts.store || new SqliteStore(opts.db ?? env.PPL_DB ?? 'data/ppl.sqlite');
  const manager = opts.manager || new SearchManager({ store, maxWorkers: +(env.PPL_MAX_WORKERS || 0) || undefined, maxRunning: +(env.PPL_MAX_RUNNING || 0) || undefined, workerMemMB: +(env.PPL_WORKER_MB || 0) || undefined, autoResume: env.PPL_AUTORESUME !== '0', tickMs: opts.tickMs });
  const staticDir = opts.staticDir ?? env.PPL_STATIC ?? 'dist', origin = opts.origin ?? env.PPL_ORIGIN ?? '';
  const trustProxy = opts.trustProxy ?? env.PPL_TRUST_PROXY === '1', hsts = opts.hsts ?? env.PPL_HSTS === '1';
  const extraHosts = new Set((opts.hosts ?? env.PPL_HOSTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const csp = `default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'${origin ? '' : ''}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const secure = (res) => { res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'strict-origin-when-cross-origin'); res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('x-frame-options', 'DENY'); res.setHeader('cross-origin-opener-policy', 'same-origin'); res.setHeader('content-security-policy', csp); if (hsts) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains'); };
  const buckets = new Map(), failures = new Map();
  const tooManyFailures = (ip) => { const f = failures.get(ip); return f && Date.now() - f.t < 60000 && f.n >= 20; };
  const noteFailure = (ip) => { const t = Date.now(), f = failures.get(ip); if (!f || t - f.t > 60000) failures.set(ip, { n: 1, t }); else f.n++; };
  const limited = (ip) => { const t = Date.now(), b = buckets.get(ip) || { n: 0, t }; if (t - b.t > 10000) { b.n = 0; b.t = t; } b.n++; buckets.set(ip, b); return b.n > 400; };
  setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.t > 60000) buckets.delete(k); for (const [k, f] of failures) if (t - f.t > 60000) failures.delete(k); }, 60000).unref();
  const authed = (req, url) => {
    if (!token) return true;
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (url.pathname.endsWith('/events') ? url.searchParams.get('token') : '') || '';
    const a = Buffer.from(given), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b);
  };
  const send = (res, code, body, headers = {}) => { const s = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(s); };
  const readBody = (req, max = 2_000_000) => new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('corps trop volumineux'), { code: 413 })); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch { reject(Object.assign(new Error('JSON invalide'), { code: 400 })); } }); req.on('error', reject); });
  const idOk = (s) => /^[a-f0-9]{10}$/.test(s);

  /** Anti-CSRF et anti DNS-rebinding : actif pour tout accès par navigateur. */
  function guard(req) {
    const h = hostOnly(req.headers.host);
    if (LOOPBACK.has(host) && !LOOPBACK.has(h) && !extraHosts.has(h)) return [421, 'hôte non autorisé (PPL_HOSTS)'];
    const o = req.headers.origin, same = o && (() => { try { return new URL(o).host.toLowerCase() === (req.headers.host || '').toLowerCase(); } catch { return false; } })();
    const allowed = !o || same || (origin && o === origin);
    if (!allowed) return [403, 'origine non autorisée'];
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!allowed) return [403, 'origine non autorisée'];
      const sfs = req.headers['sec-fetch-site']; if (sfs === 'cross-site' && !(origin && o === origin)) return [403, 'requête inter-sites refusée'];
      if (/^(POST|PATCH|PUT)$/.test(req.method) && req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !/^application\/json/i.test(req.headers['content-type'] || '')) return [415, 'content-type application/json requis'];
    }
    return null;
  }

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1), m = req.method;
    if (parts[0] === 'health') return send(res, 200, { ok: true, version: 1, time: Date.now() });
    if (!authed(req, url)) { noteFailure(req.socket.remoteAddress || '?'); return send(res, 401, { error: 'authentification requise' }, { 'www-authenticate': 'Bearer' }); }
    if (parts[0] === 'resources' && m === 'GET') return send(res, 200, manager.resources());
    if (parts[0] === 'records' && m === 'GET') {
      const byN = new Map();
      for (const b of store.bestPerSearch().sort((a, c) => a.S - c.S)) {
        const cur = byN.get(b.n) || { n: b.n, searches: 0, best: null }; cur.searches++;
        if (!cur.best) { const sol = store.getSolution(b.searchId, b.id), j = sol && judge(sol.solution, { n: b.n }); if (j && j.ok) cur.best = { searchId: b.searchId, solutionId: b.id, S: j.S, size: j.size, fill: j.fill, status: b.status, createdAt: b.createdAt }; }
        byN.set(b.n, cur);
      }
      return send(res, 200, { records: [...byN.values()].sort((a, c) => a.n - c.n) });
    }
    if (parts[0] === 'stop-all' && m === 'POST') { const n = await manager.stopAll(); return send(res, 200, { ok: true, stopped: n }); }
    if (parts[0] === 'searches') {
      if (parts.length === 1 && m === 'GET') return send(res, 200, { searches: manager.list() });
      if (parts.length === 1 && m === 'DELETE') { if (url.searchParams.get('confirm') !== 'yes') return send(res, 400, { error: 'confirmation requise (?confirm=yes)' }); return send(res, 200, { ok: true, deleted: await manager.removeAll() }); }
      if (parts.length === 1 && m === 'POST') { const body = await readBody(req); const r = manager.create(body.params || body); if (!r.ok) return send(res, r.code || 400, { error: r.errors.join(' ; ') }); return send(res, 201, { id: r.id, summary: r.coordinator.summary() }); }
      const id = parts[1]; if (!idOk(id)) return send(res, 400, { error: 'identifiant invalide' });
      const c = manager.get(id) || manager.load(id); if (!c) return send(res, 404, { error: 'recherche introuvable' });
      const sub = parts[2];
      if (!sub && m === 'GET') return send(res, 200, c.summary({ previews: url.searchParams.get('previews') === '1' }));
      if (!sub && m === 'DELETE') { await manager.remove(id); return send(res, 200, { ok: true }); }
      if (sub === 'start' && m === 'POST') { if (c.status !== 'running' && manager.running().length >= manager.maxRunning) return send(res, 429, { error: 'limite de recherches simultanées atteinte' }); if (c.status === 'paused') c.resume(); else if (c.status === 'stopped') { c.status = 'created'; for (const s of c.slots) if (s.state === 'done') s.state = 'init'; c.start(); } else c.start(); return send(res, 200, c.summary()); }
      if (sub === 'pause' && m === 'POST') { c.pause(); return send(res, 200, c.summary()); }
      if (sub === 'resume' && m === 'POST') { c.resume(); return send(res, 200, c.summary()); }
      if (sub === 'stop' && m === 'POST') { await c.stop(); return send(res, 200, c.summary()); }
      if (sub === 'params' && m === 'PATCH') {
        const b = await readBody(req), p = { ...c.params };
        for (const k of ['maxWorkers', 'cycleMs', 'effort', 'strategies', 'mode']) if (b[k] !== undefined) p[k] = b[k];
        if (b.sims !== undefined) { if (+b.sims < c.params.sims) return send(res, 400, { error: 'le nombre de simulations ne peut qu\'augmenter pendant une recherche' }); p.sims = b.sims; }
        const { validateParams } = await import('../src/parallel/coordinator.js'); const v = validateParams(p); if (!v.ok) return send(res, 400, { error: v.errors.join(' ; ') });
        if (v.params.sims > c.params.sims) for (let i = c.params.sims; i < v.params.sims; i++) c.slots.push({ ...c.newSlot(i), state: c.status === 'running' ? 'waiting' : 'init' });
        Object.assign(c.params, { ...v.params, n: c.params.n, seed: c.params.seed }); store.saveParams(id, c.params); return send(res, 200, c.summary());
      }
      if (sub === 'watch' && m === 'POST') { const b = await readBody(req); c.watch(Number.isInteger(b.slot) ? b.slot : null, !!b.on); return send(res, 200, { ok: true }); }
      if (sub === 'solutions') {
        if (parts.length === 3 && m === 'GET') return send(res, 200, { solutions: c.listSolutions() });
        if (parts.length === 3 && m === 'POST') { const b = await readBody(req, 4_000_000), j = judge(b.solution || b, { n: c.params.n }); if (!j.ok) return send(res, 422, { error: 'solution rejetée par l\'autorité de validation', reasons: j.reasons }); const r = c.importSolution(b.solution || b, { note: 'import' }); return send(res, 200, { status: r.status, id: r.entry?.id ?? null }); }
        if (parts.length === 4 && m === 'GET') { const s = c.getSolution(parts[3]) || store.getSolution(id, +parts[3]); return s ? send(res, 200, s) : send(res, 404, { error: 'solution introuvable' }); }
      }
      if (sub === 'history' && m === 'GET') return send(res, 200, { history: store.history(id), strategies: c.summary().bandits });
      if (sub === 'events' && m === 'GET') return sse(req, res, id, c);
    }
    return send(res, 404, { error: 'route inconnue' });
  }

  function sse(req, res, id, c) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (e) => res.write(`id: ${e.seq ?? ''}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const last = +(req.headers['last-event-id'] || 0);
    res.write(`retry: 2000\n\n`);
    write({ seq: c.seq, type: 'state', summary: c.summary({ previews: true }) }); // synchronisation complète à la (re)connexion
    for (const e of c.events) if (e.seq > last && last > 0) write(e); // rattrapage des événements manqués
    const off = manager.subscribe(id, write);
    const tm = setInterval(() => write({ seq: c.seq, type: 'summary', summary: c.summary({ previews: true }) }), 1000), ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { off(); clearInterval(tm); clearInterval(ka); });
  }

  function serveStatic(req, res, url) {
    const root = join(process.cwd(), staticDir); if (!existsSync(root)) return send(res, 404, 'Frontend non construit (npm run build) — utilisez Vite en développement.');
    let p; try { p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''); } catch { return send(res, 400, 'chemin invalide'); } if (p.includes('..') || p.includes('\0') || p.split(/[/\\]/).some((x) => x.startsWith('.'))) return send(res, 400, 'chemin invalide');
    let f = join(root, p || 'index.html'); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html'); if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
    if (!existsSync(f)) return send(res, 404, 'introuvable');
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': f.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' }); res.end(readFileSync(f));
  }

  const server = http.createServer(async (req, res) => {
    try {
      secure(res);
      const url = new URL(req.url, 'http://x'), ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
      const g = guard(req); if (g) return send(res, g[0], { error: g[1] });
      if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-headers', 'authorization,content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE'); if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } }
      if (limited(ip) || tooManyFailures(ip)) return send(res, 429, { error: 'trop de requêtes' });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) { const code = e.code === 413 ? 413 : e.code === 400 ? 400 : 500; if (!res.headersSent) send(res, code, { error: code === 500 ? 'erreur interne' : e.message }); if (code === 500) console.error(e); }
  });
  return {
    server, store, manager, token, host,
    listen: () => new Promise((resolve) => { server.listen(port, host, () => { resolve(server.address().port); }); }),
    async close() { await manager.shutdown(); await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); store.close(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createServer(); const recovered = app.manager.recover();
  app.listen().then((port) => console.log(`Parallel Packing Lab : http://${app.host}:${port} — ${recovered.filter((r) => r.resumed).length} recherche(s) reprise(s) depuis les checkpoints`));
  const bye = async () => { await app.close(); process.exit(0); }; process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
