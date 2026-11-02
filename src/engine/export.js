import { validateLayout } from './validate.js';
import { corners } from './geometry.js';

/** Export SVG vectoriel d'une disposition (aucune dépendance au DOM). */
export function layoutToSvg(instance, placements, { scale = 40, showIds = false } = {}) {
  const { W, H } = instance, f = (x) => x.toFixed(4);
  const v = validateLayout(placements, W, H);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-0.5} ${-0.5} ${f(W + 1)} ${f(H + 1)}" width="${f((W + 1) * scale)}" height="${f((H + 1) * scale)}">`,
    `<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="none" stroke="#222" stroke-width="0.05"/>`];
  placements.forEach((p, i) => {
    const pts = corners(p).map((c) => `${f(c[0])},${f(c[1])}`).join(' ');
    const hue = (p.id * 137.508) % 360;
    parts.push(`<polygon points="${pts}" fill="hsl(${hue.toFixed(0)},65%,60%)" fill-opacity="0.6" stroke="${v.flags[i] ? '#d00' : '#333'}" stroke-width="0.03"/>`);
    if (showIds) parts.push(`<text x="${f(p.x)}" y="${f(p.y)}" font-size="${f(p.side * 0.3)}" text-anchor="middle" dominant-baseline="central">${p.id}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

/** Export JSON complet : configuration, graine, disposition et certificat de validation. */
export function resultToJson({ config, instance, placements, stats, classification, algorithm }) {
  const v = validateLayout(placements, instance.W, instance.H);
  return JSON.stringify({
    format: 'square-packing-lab/result@1', algorithm, config, seed: config?.seed,
    container: { W: instance.W, H: instance.H },
    placements: placements.map((p) => ({ id: p.id, x: p.x, y: p.y, side: p.side, theta: p.theta })),
    stats, classification,
    certificate: { exactSAT: true, tolerance: v.tol, valid: v.valid, collisions: v.pairs.length, outOfBounds: v.oob.length },
  }, null, 2);
}
