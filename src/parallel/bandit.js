/**
 * Allocation adaptative inspirée des Multi-Armed Bandits (UCB lissé + plancher d'exploration).
 * Chaque bras garde : tirages, récompense moyenne glissante, améliorations, acceptations, temps cumulé.
 * Probabilité = (1 − K·plancher) × softmax(a priori + récompense + bonus UCB) + plancher : aucune stratégie n'est
 * jamais éliminée (plancher > 0) et l'a priori (ex. 30/30/20/20) pèse de moins en moins avec les observations.
 */
export class Bandit {
  constructor(priors, { floor = 0.06, alpha = 0.15, temperature = 0.25, ucb = 0.15, priorWeight = 6 } = {}) {
    this.arms = {}; this.floor = floor; this.alpha = alpha; this.temp = temperature; this.ucbC = ucb; this.priorWeight = priorWeight; this.total = 0;
    const sum = Object.values(priors).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(priors)) this.arms[k] = { prior: v / sum, pulls: 0, ema: 0.25, rewardSum: 0, improvements: 0, accepted: 0, records: 0, ms: 0, successes: 0 };
  }
  keys() { return Object.keys(this.arms); }
  probabilities() {
    const ks = this.keys(), K = ks.length, fl = Math.min(this.floor, 0.9 / K);
    const score = ks.map((k) => { const a = this.arms[k], w = this.priorWeight / (this.priorWeight + a.pulls), v = w * (0.25 * a.prior * K) + (1 - w) * a.ema; // l'a priori s'estompe
      return v / this.temp + (this.ucbC * Math.sqrt(Math.log(this.total + 2) / (a.pulls + 1))) / this.temp; });
    const m = Math.max(...score), ex = score.map((v) => Math.exp(v - m)), z = ex.reduce((a, b) => a + b, 0), out = {};
    ks.forEach((k, i) => { out[k] = (1 - K * fl) * (ex[i] / z) + fl; });
    return out;
  }
  choose(rng) { const p = this.probabilities(); let r = rng.next(); for (const [k, v] of Object.entries(p)) { r -= v; if (r <= 0) return k; } return this.keys()[0]; }
  /** reward ∈ [0,1] ; outcome : 'record' | 'improved' | 'accepted' | 'duplicate' | 'none' */
  update(arm, reward, { outcome = 'none', ms = 0 } = {}) {
    const a = this.arms[arm]; if (!a) return; this.total++; a.pulls++; a.rewardSum += reward; a.ms += ms; a.ema += this.alpha * (reward - a.ema);
    if (outcome === 'record') { a.records++; a.improvements++; a.successes++; } else if (outcome === 'improved') { a.improvements++; a.successes++; } else if (outcome === 'accepted') { a.accepted++; a.successes++; }
  }
  snapshot() { const p = this.probabilities(); return Object.fromEntries(this.keys().map((k) => [k, { ...this.arms[k], p: p[k], meanReward: this.arms[k].pulls ? this.arms[k].rewardSum / this.arms[k].pulls : 0 }])); }
  toJSON() { return { arms: this.arms, total: this.total }; }
  restore(j) { if (j && j.arms) { for (const k of this.keys()) if (j.arms[k]) Object.assign(this.arms[k], j.arms[k]); this.total = j.total || 0; } }
}

/** Récompense d'un résultat de cycle relativement au record courant. */
export function rewardOf(outcome, S, bestS) {
  const close = Number.isFinite(bestS) ? Math.max(0, 1 - (S - bestS) / (0.02 * bestS)) : 0;
  const base = { record: 1, improved: 0.6, accepted: 0.4, duplicate: 0.08, none: 0 }[outcome] ?? 0;
  return Math.min(1, base + 0.15 * close * (outcome === 'none' ? 0 : 1));
}
