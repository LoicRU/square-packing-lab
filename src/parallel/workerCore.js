/**
 * Cœur d'un worker (isomorphe) : reçoit des tâches, exécute un Cycle de façon coopérative, émet
 *  started / progress / improve / preview / snapshot / result / error.
 * Protocole entrant : task{taskId,spec,knownS} · known{S} · stop · suspend · resume · watch{on} · ping
 * On n'envoie PAS chaque déplacement : progress ≤ 2/s, preview ≤ 1/previewMs, snapshot (détail) ≤ 4/s seulement si observé.
 */
import { Cycle } from './task.js';

export function createWorkerCore(post, { previewMs = 1500, progressMs = 500, improveMs = 400, now = () => performance.now() } = {}) {
  let cycle = null, taskId = null, knownS = Infinity, postedS = Infinity, suspended = false, watch = false, tProg = 0, tPrev = 0, tSnap = 0, tImp = 0;
  const finish = () => {
    if (!cycle) return; const c = cycle; cycle = null;
    try { const f = c.finalize ? c.finalize() : { sol: c.best(), gain: 0 }; post({ type: 'result', taskId, sol: f.sol, stats: { iterations: c.iterations, ms: c.elapsed(), stopReason: c.stopReason, startS: Number.isFinite(c.startS) ? c.startS : null, polishGain: f.gain } }); }
    catch (e) { post({ type: 'error', taskId, message: String(e && e.message || e) }); }
  };
  return {
    get busy() { return !!cycle && !suspended; },
    get hasTask() { return !!cycle; },
    onMessage(m) {
      switch (m.type) {
        case 'task':
          try { cycle = new Cycle(m.spec, now); taskId = m.taskId; knownS = m.knownS ?? Infinity; postedS = Infinity; tProg = tPrev = tSnap = tImp = now(); suspended = false; post({ type: 'started', taskId }); }
          catch (e) { cycle = null; post({ type: 'error', taskId: m.taskId, message: String(e && e.message || e) }); }
          break;
        case 'known': knownS = Math.min(knownS, m.S); break;
        case 'stop': if (cycle) { cycle.stop(); finish(); } break;
        case 'suspend': suspended = true; break;
        case 'resume': suspended = false; break;
        case 'watch': watch = !!m.on; tSnap = 0; break;
        case 'ping': post({ type: 'pong', t: m.t }); break;
        default: break;
      }
    },
    /** Un pas de travail (≤ ~8 ms) ; retourne true s'il reste du travail. */
    tick() {
      if (!cycle || suspended) return false;
      try {
        cycle.step(8); const t = now(), S = cycle.S;
        if (S < postedS - 1e-9 && S < knownS - 1e-9 && t - tImp > improveMs) { tImp = t; postedS = S; post({ type: 'improve', taskId, sol: cycle.best() }); }
        if (t - tProg > progressMs) { tProg = t; post({ type: 'progress', taskId, it: cycle.iterations, S, elapsed: cycle.elapsed(), budget: cycle.spec.budgetMs }); }
        if (watch ? t - tSnap > 250 : t - tPrev > previewMs) { if (watch) tSnap = t; tPrev = t; post({ type: watch ? 'snapshot' : 'preview', taskId, frame: cycle.frame(watch) }); }
        if (cycle.done) finish();
      } catch (e) { post({ type: 'error', taskId, message: String(e && e.stack || e) }); cycle = null; }
      return !!cycle;
    },
  };
}
