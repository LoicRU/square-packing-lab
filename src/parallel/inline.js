/** Worker « en processus » (tests, repli sans threads) : même protocole qu'un worker_thread, exécution coopérative. */
import { createWorkerCore } from './workerCore.js';

export class InlineWorker {
  constructor(opts = {}) {
    this.h = { message: [], error: [], exit: [] }; this.alive = true; this.timer = null; this.crashNext = false;
    this.core = createWorkerCore((m) => queueMicrotask(() => this.alive && this.h.message.forEach((f) => f(m))), opts);
    queueMicrotask(() => this.alive && this.h.message.forEach((f) => f({ type: 'ready' })));
  }
  on(e, f) { this.h[e].push(f); return this; }
  postMessage(m) { if (!this.alive) return; if (this.crashNext && m.type === 'task') { this.crash(); return; } this.core.onMessage(m); this.pump(); }
  pump() { if (this.timer || !this.alive) return; this.timer = setImmediate(() => { this.timer = null; if (!this.alive) return; if (this.core.tick()) this.pump(); }); }
  crash(msg = 'crash simulé') { this.alive = false; clearImmediate(this.timer); this.h.error.forEach((f) => f(new Error(msg))); this.h.exit.forEach((f) => f(1)); }
  terminate() { this.alive = false; clearImmediate(this.timer); return Promise.resolve(); }
}
