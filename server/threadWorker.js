/** Point d'entrée d'un worker_thread : isole les calculs géométriques du serveur et de l'interface. */
import { parentPort } from 'node:worker_threads';
import { createWorkerCore } from '../src/parallel/workerCore.js';

const core = createWorkerCore((m) => parentPort.postMessage(m));
let pumping = false;
const pump = () => { if (pumping) return; pumping = true; const loop = () => { if (core.tick()) setImmediate(loop); else pumping = false; }; setImmediate(loop); };
parentPort.on('message', (m) => { core.onMessage(m); pump(); });
parentPort.postMessage({ type: 'ready' });
