/** Store en mémoire (tests, mode sans persistance) : même interface que le store SQLite du serveur. */
export class MemoryStore {
  constructor() { this.solutions = new Map(); this.archived = []; this.history = []; this.checkpoints = new Map(); this.state = new Map(); }
  saveSolution(sid, e) { this.solutions.set(`${sid}:${e.id}`, { id: e.id, S: e.S, category: e.category, meta: e.meta, solution: JSON.parse(JSON.stringify(e.sol)) }); }
  archiveSolution(sid, e) { this.solutions.delete(`${sid}:${e.id}`); this.archived.push(e.id); }
  saveHistory(sid, p) { this.history.push(p); }
  saveCheckpoint(sid, c) { this.checkpoints.set(sid, JSON.parse(JSON.stringify(c))); }
  saveSearchState(sid, st) { this.state.set(sid, st); }
  load(sid) { return { checkpoint: this.checkpoints.get(sid) || null, solutions: [...this.solutions.entries()].filter(([k]) => k.startsWith(`${sid}:`)).map(([, v]) => v), history: this.history }; }
}
