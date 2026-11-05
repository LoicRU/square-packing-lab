import { BEST, PROVEN } from '../engine/known.js';
const body = document.querySelector('#knownTable tbody');
body.innerHTML = Object.keys(BEST).map((k) => {
  const proven = PROVEN.has(+k), v = BEST[k], exact = Number.isInteger(v);
  return `<tr><td>${k}</td><td>${exact ? v : v.toFixed(4)}</td><td>${proven ? 'optimal prouvé' : 'meilleur connu'}</td></tr>`;
}).join('');
