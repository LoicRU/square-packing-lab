/**
 * Gestion adaptative des ressources : nombre de workers ACTIFS (jamais illimité).
 * Entrées : cœurs, charge CPU (loadavg 1 min), mémoire libre, durée moyenne des cycles, retard de la boucle
 * d'événements (réactivité), limite manuelle, limite imposée par le serveur. Sortie : { target, reasons }.
 */
export const HARD_MAX_WORKERS = 64;

export function computeTarget({ requested, manualMax = 0, serverMax = HARD_MAX_WORKERS, cpus = 1, load1 = 0, freeMemMB = 1024, perWorkerMB = 120, loopLagMs = 0, avgCycleMs = 0, cycleMs = 0, current = 0 }) {
  const reasons = [], caps = [];
  const reserve = cpus >= 4 ? 1 : 0, cpuCap = Math.max(1, cpus - reserve); caps.push(cpuCap); if (reserve) reasons.push(`${reserve} cœur réservé au serveur/interface`);
  const memCap = Math.max(1, Math.floor((freeMemMB * 0.6) / perWorkerMB)); if (memCap < cpuCap) reasons.push(`mémoire libre : ${memCap} worker(s) max`); caps.push(memCap);
  if (manualMax > 0) { caps.push(manualMax); reasons.push(`limite manuelle ${manualMax}`); }
  caps.push(Math.min(serverMax, HARD_MAX_WORKERS)); if (serverMax < cpuCap) reasons.push(`limite serveur ${serverMax}`);
  let target = Math.max(1, Math.min(requested, ...caps));
  // régulation douce autour de l'état courant (hystérésis) : on ne bouge que d'un worker à la fois
  const loadPerCore = load1 / Math.max(1, cpus), overloaded = loadPerCore > 1.15 || loopLagMs > 200;
  if (overloaded && current > 1) { target = Math.min(target, current - 1); reasons.push(loopLagMs > 200 ? `boucle d'événements lente (${Math.round(loopLagMs)} ms)` : `charge CPU élevée (${loadPerCore.toFixed(2)}/cœur)`); }
  else if (current > 0 && target > current) target = Math.min(target, current + 1);
  if (avgCycleMs > 0 && cycleMs > 0 && avgCycleMs > 2.5 * cycleMs && target > 1) { target = Math.max(1, target - 1); reasons.push('cycles anormalement longs'); }
  return { target, reasons, caps: { cpu: cpuCap, memory: memCap, manual: manualMax || null, server: serverMax } };
}
