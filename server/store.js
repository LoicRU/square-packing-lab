/**
 * Persistance SQLite (module intégré node:sqlite, aucune dépendance). Données PERSISTANTES uniquement :
 * recherches, solutions (coordonnées compressées), historique du record, checkpoints. Aucune donnée temporaire
 * (aperçus, positions intermédiaires) n'est écrite. Politique : solutions archivées compactes et plafonnées
 * (jamais le record), checkpoints = 1 ligne par recherche (remplacée), nettoyage au démarrage.
 */
import { createRequire } from 'node:module';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite'); // (chargé via require : compatible Vitest)
const pack = (obj) => gzipSync(Buffer.from(JSON.stringify(obj)));
const unpack = (buf) => JSON.parse(gunzipSync(buf).toString());

export class SqliteStore {
  constructor(file = ':memory:', { maxArchived = 2000 } = {}) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file); this.maxArchived = maxArchived;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS searches(id TEXT PRIMARY KEY, params TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, search_ms REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS solutions(search_id TEXT NOT NULL, id INTEGER NOT NULL, s REAL NOT NULL, category TEXT NOT NULL, meta TEXT NOT NULL, data BLOB NOT NULL, archived INTEGER NOT NULL DEFAULT 0, found_at INTEGER NOT NULL, PRIMARY KEY(search_id,id));
      CREATE INDEX IF NOT EXISTS sol_s ON solutions(search_id, archived, s);
      CREATE TABLE IF NOT EXISTS history(search_id TEXT NOT NULL, t REAL NOT NULL, wall INTEGER NOT NULL, s REAL NOT NULL, fill REAL NOT NULL, slot INTEGER, strategy TEXT, sid INTEGER);
      CREATE INDEX IF NOT EXISTS hist_s ON history(search_id, wall);
      CREATE TABLE IF NOT EXISTS checkpoints(search_id TEXT PRIMARY KEY, data BLOB NOT NULL, saved_at INTEGER NOT NULL);`);
    this.q = {
      insSearch: this.db.prepare('INSERT OR REPLACE INTO searches(id,params,status,created_at,updated_at,search_ms) VALUES(?,?,?,?,?,?)'),
      updSearch: this.db.prepare('UPDATE searches SET status=?, search_ms=?, updated_at=? WHERE id=?'),
      updParams: this.db.prepare('UPDATE searches SET params=?, updated_at=? WHERE id=?'),
      insSol: this.db.prepare('INSERT OR REPLACE INTO solutions(search_id,id,s,category,meta,data,archived,found_at) VALUES(?,?,?,?,?,?,0,?)'),
      archSol: this.db.prepare('UPDATE solutions SET archived=1, category=\'historical\' WHERE search_id=? AND id=?'),
      insHist: this.db.prepare('INSERT INTO history(search_id,t,wall,s,fill,slot,strategy,sid) VALUES(?,?,?,?,?,?,?,?)'),
      putCk: this.db.prepare('INSERT OR REPLACE INTO checkpoints(search_id,data,saved_at) VALUES(?,?,?)'),
      getCk: this.db.prepare('SELECT data FROM checkpoints WHERE search_id=?'),
      sols: this.db.prepare('SELECT id,s,category,meta,data,found_at FROM solutions WHERE search_id=? AND archived=0 ORDER BY s ASC'),
      solOne: this.db.prepare('SELECT id,s,category,meta,data FROM solutions WHERE search_id=? AND id=?'),
      hist: this.db.prepare('SELECT t,wall,s,fill,slot,strategy,sid FROM history WHERE search_id=? ORDER BY wall ASC'),
      searches: this.db.prepare('SELECT id,params,status,created_at,updated_at,search_ms FROM searches ORDER BY created_at DESC'),
      search: this.db.prepare('SELECT id,params,status,created_at,updated_at,search_ms FROM searches WHERE id=?'),
      delSol: this.db.prepare('DELETE FROM solutions WHERE search_id=?'), delHist: this.db.prepare('DELETE FROM history WHERE search_id=?'), delCk: this.db.prepare('DELETE FROM checkpoints WHERE search_id=?'), delSearch: this.db.prepare('DELETE FROM searches WHERE id=?'),
      countArch: this.db.prepare('SELECT COUNT(*) c FROM solutions WHERE search_id=? AND archived=1'),
      pruneArch: this.db.prepare('DELETE FROM solutions WHERE rowid IN (SELECT rowid FROM solutions WHERE search_id=? AND archived=1 ORDER BY s DESC LIMIT ?)'),
    };
  }
  createSearch(id, params, now = Date.now()) { this.q.insSearch.run(id, JSON.stringify(params), 'created', now, now, 0); }
  saveSearchState(id, { status, searchMs }) { this.q.updSearch.run(status, searchMs || 0, Date.now(), id); }
  saveParams(id, params) { this.q.updParams.run(JSON.stringify(params), Date.now(), id); }
  saveSolution(sid, e) {
    const d = pack({ n: e.sol.n, S: e.sol.S, x: e.sol.x, y: e.sol.y, th: e.sol.th });
    this.q.insSol.run(sid, e.id, e.S, e.category, JSON.stringify(e.meta || {}), d, e.meta?.t || Date.now());
  }
  archiveSolution(sid, e) { this.q.archSol.run(sid, e.id); const c = this.q.countArch.get(sid).c; if (c > this.maxArchived) this.q.pruneArch.run(sid, c - this.maxArchived); }
  saveHistory(sid, p) { this.q.insHist.run(sid, p.t, p.wall, p.S, p.fill, p.slot ?? null, p.strategy ?? null, p.id ?? null); }
  saveCheckpoint(sid, c) { this.q.putCk.run(sid, pack(c), Date.now()); }
  load(sid) {
    const ck = this.q.getCk.get(sid);
    return {
      checkpoint: ck ? unpack(ck.data) : null,
      solutions: this.q.sols.all(sid).map((r) => ({ id: r.id, S: r.s, category: r.category, meta: JSON.parse(r.meta), solution: unpack(r.data) })),
      history: this.q.hist.all(sid).map((h) => ({ t: h.t, wall: h.wall, S: h.s, fill: h.fill, slot: h.slot, strategy: h.strategy, id: h.sid })),
    };
  }
  /** Meilleure solution (S minimal) de chaque recherche : [{searchId, n, id, S, searchParams}] */
  bestPerSearch() {
    const out = [];
    for (const r of this.listSearches()) { const b = this.db.prepare('SELECT id,s FROM solutions WHERE search_id=? ORDER BY s ASC, id ASC LIMIT 1').get(r.id); if (b) out.push({ searchId: r.id, n: r.params.n, id: b.id, S: b.s, status: r.status, createdAt: r.createdAt }); }
    return out;
  }
  /** Meilleure solution enregistrée (toutes recherches confondues, sauf `exceptId`) pour exactement n carrés, ou null. */
  bestSolutionForN(n, exceptId = null) {
    for (const r of this.bestPerSearch()) if (r.n === n && r.searchId !== exceptId) { const g = this.getSolution(r.searchId, r.id); if (g) return g.solution; }
    return null;
  }
  getSolution(sid, id) { const r = this.q.solOne.get(sid, id); return r ? { id: r.id, S: r.s, category: r.category, meta: JSON.parse(r.meta), solution: unpack(r.data) } : null; }
  history(sid) { return this.load(sid).history; }
  listSearches() { return this.q.searches.all().map((r) => ({ id: r.id, params: JSON.parse(r.params), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, searchMs: r.search_ms })); }
  getSearch(id) { const r = this.q.search.get(id); return r ? { id: r.id, params: JSON.parse(r.params), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, searchMs: r.search_ms } : null; }
  deleteSearch(id) { for (const k of ['delSol', 'delHist', 'delCk']) this.q[k].run(id); this.q.delSearch.run(id); }
  close() { this.db.close(); }
}
