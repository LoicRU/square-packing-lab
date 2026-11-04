/** Graphiques interactifs légers (Canvas 2D) pour l'historique : courbes en escalier + barres, infobulle au survol. */
export function drawChart(canvas, { series, bars = false, xFormat = (v) => v, yFormat = (v) => v.toFixed(3), yMin = null, step = true, colors = ['#ff6a3d', '#6ab0ff', '#7bd88f', '#f0a830'] }) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const mL = 52, mR = 10, mT = 10, mB = 22, pw = w - mL - mR, ph = h - mT - mB, all = series.flatMap((s) => s.points);
  if (!all.length) { g.fillStyle = '#8a877d'; g.font = '12px ui-monospace,monospace'; g.fillText('aucune donnée pour le moment', mL + 6, mT + 20); canvas._pts = null; return; }
  let x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x)); if (x1 === x0) x1 = x0 + 1;
  let y0 = yMin ?? Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y)); if (bars) y0 = 0; if (y1 === y0) y1 = y0 + 1; const pad = bars ? 0 : (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (v) => mL + ((v - x0) / (x1 - x0)) * pw, Y = (v) => mT + ph - ((v - y0) / (y1 - y0)) * ph;
  g.strokeStyle = '#23262e'; g.fillStyle = '#8a877d'; g.font = '11px ui-monospace,monospace'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, y = Y(v); g.beginPath(); g.moveTo(mL, y); g.lineTo(w - mR, y); g.stroke(); g.textAlign = 'right'; g.fillText(yFormat(v), mL - 5, y + 4); }
  g.textAlign = 'center'; for (let i = 0; i <= 4; i++) { const v = x0 + ((x1 - x0) * i) / 4; g.fillText(xFormat(v), X(v), h - 6); }
  series.forEach((s, k) => {
    g.strokeStyle = g.fillStyle = s.color || colors[k % colors.length]; g.lineWidth = 1.8;
    if (bars) { const bw = Math.max(2, Math.min(40, pw / s.points.length - 4)); for (const p of s.points) g.fillRect(X(p.x) - bw / 2, Y(p.y), bw, Y(0) - Y(p.y)); return; }
    g.beginPath(); s.points.forEach((p, i) => { const x = X(p.x), y = Y(p.y); if (i === 0) g.moveTo(x, y); else { if (step) g.lineTo(x, Y(s.points[i - 1].y)); g.lineTo(x, y); } }); if (step) g.lineTo(X(x1), Y(s.points[s.points.length - 1].y)); g.stroke();
    for (const p of s.points) { g.beginPath(); g.arc(X(p.x), Y(p.y), 2.4, 0, 7); g.fill(); }
  });
  canvas._pts = { all: series.flatMap((s, k) => s.points.map((p) => ({ ...p, name: s.name, sx: X(p.x), sy: Y(p.y) }))), xFormat, yFormat };
  if (!canvas._hover) { canvas._hover = true; const tip = document.createElement('div'); tip.className = 'ptip'; tip.hidden = true; canvas.parentElement.style.position = 'relative'; canvas.parentElement.appendChild(tip);
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, P = canvas._pts; if (!P) return; let b = null, bd = 28; for (const p of P.all) { const d = Math.hypot(p.sx - mx, p.sy - my); if (d < bd) { bd = d; b = p; } } if (!b) { tip.hidden = true; return; } tip.hidden = false; tip.style.left = `${Math.min(r.width - 150, b.sx + 8)}px`; tip.style.top = `${Math.max(0, b.sy - 34)}px`; tip.textContent = `${b.name ? b.name + ' · ' : ''}${P.xFormat(b.x)} → ${P.yFormat(b.y)}`; });
    canvas.addEventListener('mouseleave', () => { tip.hidden = true; }); }
}

/** Dessine une disposition { S, xyt: [x,y,θ…] | {x,y,th}, flags? } dans un canvas (carrés orientés colorés par angle). */
export function drawLayout(canvas, lay, { labels = false, free = null, margin = 6 } = {}) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0d0f14'; g.fillRect(0, 0, w, h);
  if (!lay) return;
  const S = lay.container || lay.S, k = (Math.min(w, h) - 2 * margin) / S, ox = (w - S * k) / 2, oy = (h - S * k) / 2, n = lay.n ?? (lay.xyt ? lay.xyt.length / 3 : lay.x.length);
  g.strokeStyle = '#ece7dc'; g.lineWidth = 1.4; g.strokeRect(ox, oy, S * k, S * k);
  const get = (i) => (lay.xyt ? [lay.xyt[i * 3], lay.xyt[i * 3 + 1], lay.xyt[i * 3 + 2]] : [lay.x[i], lay.y[i], lay.th[i]]);
  for (let i = 0; i < n; i++) {
    const [x, y, t] = get(i), f = Math.min(((t % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2), Math.PI / 2 - (((t % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2))) / (Math.PI / 4), bad = lay.flags && lay.flags[i];
    g.save(); g.translate(ox + x * k, oy + y * k); g.rotate(t); const s = k;
    g.fillStyle = bad ? 'rgba(255,82,98,.65)' : `rgb(${Math.round(255 + (106 - 255) * f)},${Math.round(106 + (176 - 106) * f)},${Math.round(61 + (255 - 61) * f)})`; g.strokeStyle = bad ? '#ff5262' : 'rgba(255,255,255,.5)'; g.lineWidth = 1;
    g.beginPath(); g.rect(-s / 2, -s / 2, s, s); g.fill(); g.stroke(); g.restore();
    if (labels && k > 26) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `${Math.min(12, k * 0.3)}px ui-monospace,monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${(((t * 180) / Math.PI) % 90 + 90) % 90 | 0}°`, ox + x * k, oy + y * k); }
  }
  if (free) { g.fillStyle = 'rgba(240,168,48,.9)'; for (const p of free) { g.beginPath(); g.arc(ox + p[0] * k, oy + p[1] * k, 2.2, 0, 7); g.fill(); } }
}
