/**
 * Client du worker : API promise/événements. Le moteur est dans le worker ;
 * ici on ne fait que relayer les messages (pas de logique mathématique).
 */
export class EngineClient {
  constructor() {
    this.handlers = {};
    this.worker = new Worker(new URL('../worker/engine.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => { const h = this.handlers[e.data.type]; if (h) h(e.data); if (this.handlers['*']) this.handlers['*'](e.data); };
    this.worker.onerror = (e) => { const h = this.handlers.error; if (h) h({ type: 'error', message: e.message || 'Erreur du worker' }); };
  }
  on(type, fn) { this.handlers[type] = fn; return this; }
  send(cmd, payload = {}) { this.worker.postMessage({ cmd, ...payload }); }
  init(config) { this.send('init', { config }); }
  play(speed) { this.send('play', { speed }); }
  pause() { this.send('pause'); }
  step(count = 1) { this.send('step', { count }); }
  setSpeed(value) { this.send('speed', { value }); }
  setParams(params) { this.send('params', { params }); }
  free(sq, W, S, id) { this.send('free', { sq, W, S, id }); }
  stop() { this.send('stop'); }
  cancel() { this.send('cancel'); }
  compare(config, algorithms, maxMs) { this.send('compare', { config, algorithms, maxMs }); }
  scaling(config, algorithms, ns, density, maxMs) { this.send('scaling', { config, algorithms, ns, density, maxMs }); }
  attempts(config, runs, maxMs) { this.send('attempts', { config, runs, maxMs }); }
  c2sStudy(config, maxMs) { this.send('c2sStudy', { config, maxMs }); }
  terminate() { this.worker.terminate(); }
}
