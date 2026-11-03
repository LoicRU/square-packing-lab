/**
 * Rendu Canvas 2D de la scène (conteneur, carrés, cercles, collisions, vides,
 * grille, coordonnées, zoom/déplacement/plein écran). Aucune logique
 * mathématique ici : il ne fait que dessiner les données du moteur.
 * Rendu à la demande (requestAnimationFrame coalescé) pour économiser l'énergie.
 *
 * Format des tampons : carrés = stride 6 [id,x,y,côté,θ,drapeau], cercles = stride 4 [id,x,y,r].
 */
const TAU = Math.PI * 2;
const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 144, 141], [93, 200, 99], [253, 231, 37]];

export function sizeColor(t, alpha = 0.78) {
  t = Math.min(1, Math.max(0, t)); const k = t * (VIRIDIS.length - 1), i = Math.min(VIRIDIS.length - 2, Math.floor(k)), f = k - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return `rgba(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)},${alpha})`;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

export class SceneRenderer {
  constructor(canvas, wrap, { onCoords } = {}) {
    this.canvas = canvas; this.wrap = wrap; this.onCoords = onCoords;
    this.W = 10; this.H = 10; this.minSide = 0; this.maxSide = 1;
    this.sq = null; this.circ = null; this.morph = 0; this.flagsOn = true; this.circFlags = null; this.overlay = null;
    this.opts = { grid: true, voids: false, labels: true, collisions: true, coords: true, showCircles: true, showSquares: true, trails: true, free: true, labelMode: 'side', colorBy: 'size' };
    this.vp = { z: 1, px: 0, py: 0 }; this.pending = false; this.pointers = new Map(); this.layer = document.createElement('canvas');
    this.ghost = null; // dispositions de comparaison (lecture seule)
    this.bind();
    new ResizeObserver(() => this.requestRender()).observe(canvas);
  }
  setInstance({ W, H, minSide, maxSide }) { this.W = W; this.H = H; this.minSide = minSide; this.maxSide = maxSide; this.fit(); }
  setScene({ sq = null, circ = null, morph = 0, circFlags = null, overlay = null }) { this.sq = sq; this.circ = circ; this.morph = morph; this.circFlags = circFlags; this.overlay = overlay; this.requestRender(); }
  setOptions(o) { Object.assign(this.opts, o); this.requestRender(); }
  fit() { this.vp = { z: 1, px: 0, py: 0 }; this.requestRender(); }
  requestRender() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.render(); }); }

  /* ---------- transformation monde ↔ écran (pixels CSS) ---------- */
  xf() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, pad = 34;
    const k = Math.max(1e-6, Math.min((w - 2 * pad) / this.W, (h - 2 * pad) / this.H)) * this.vp.z;
    return { k, tx: w / 2 + this.vp.px - (k * this.W) / 2, ty: h / 2 + this.vp.py - (k * this.H) / 2, w, h };
  }
  toWorld(sx, sy) { const t = this.xf(); return [(sx - t.tx) / t.k, (sy - t.ty) / t.k]; }
  zoomAt(f, sx, sy) {
    const t = this.xf(), wx = (sx - t.tx) / t.k, wy = (sy - t.ty) / t.k;
    this.vp.z = Math.min(400, Math.max(0.3, this.vp.z * f));
    const t2 = this.xf(); this.vp.px += sx - (t2.tx + wx * t2.k); this.vp.py += sy - (t2.ty + wy * t2.k);
    this.requestRender();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); c.classList.add('drag'); this.pinch = null; });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (this.onCoords && this.opts.coords) { const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top); this.onCoords(wx, wy); }
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (this.pointers.size === 1) { this.vp.px += e.clientX - p.x; this.vp.py += e.clientY - p.y; }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2) { // pincement tactile
        const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomAt(d / this.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.pinch = d;
      }
      this.requestRender();
    });
    const up = (e) => { this.pointers.delete(e.pointerId); this.pinch = null; if (!this.pointers.size) c.classList.remove('drag'); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => this.fit());
    c.addEventListener('pointerleave', () => this.onCoords && this.onCoords(null));
  }
  toggleFullscreen() {
    const el = this.wrap;
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
    setTimeout(() => this.requestRender(), 150);
  }
  toBlob(cb) { this.render(); this.canvas.toBlob(cb, 'image/png'); }

  /* ---------- dessin ---------- */
  trace(ctx, s, i) {
    const x = s[i + 1], y = s[i + 2], h = s[i + 3] / 2, th = s[i + 4], c = Math.cos(th), n = Math.sin(th);
    ctx.moveTo(x - h * c + h * n, y - h * n - h * c); ctx.lineTo(x + h * c + h * n, y + h * n - h * c);
    ctx.lineTo(x + h * c - h * n, y + h * n + h * c); ctx.lineTo(x - h * c - h * n, y - h * n + h * c); ctx.closePath();
  }
  traceMorph(ctx, cx, cy, r, s, i, t) {
    const N = 36, h = s[i + 3] / 2, th = s[i + 4], x = s[i + 1], y = s[i + 2];
    for (let k = 0; k <= N; k++) {
      const phi = (k / N) * TAU, u = phi - th, rho = (1 - t) * r + t * (h / Math.max(Math.abs(Math.cos(u)), Math.abs(Math.sin(u))));
      const px = cx + (x - cx) * t + rho * Math.cos(phi), py = cy + (y - cy) * t + rho * Math.sin(phi);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  colorFor(side, theta = 0) {
    if (this.opts.colorBy === 'angle') { const q = Math.PI / 2, f = (((theta % q) + q) % q) / q; return sizeColor(2 * Math.min(f, 1 - f), 0.82); } // 0 = aligné, 1 = 45°
    const span = this.maxSide - this.minSide; return sizeColor(span > 1e-9 ? (side - this.minSide) / span : 0.55); }

  render() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1, t = this.xf();
    const W = Math.max(2, Math.round(t.w * dpr)), H = Math.max(2, Math.round(t.h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d'), k = t.k * dpr, tx = t.tx * dpr, ty = t.ty * dpr;
    const set = (g) => g.setTransform(k, 0, 0, k, tx, ty);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#07080b'; ctx.fillRect(0, 0, W, H);
    set(ctx);
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, this.W, this.H);
    const px = 1 / k; // 1 pixel appareil en unités monde

    // grille adaptative (1-2-5)
    if (this.opts.grid) {
      const step = niceStep(60 / t.k); ctx.strokeStyle = 'rgba(236,231,220,.07)'; ctx.lineWidth = px; ctx.beginPath();
      for (let x = step; x < this.W - 1e-9; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, this.H); }
      for (let y = step; y < this.H - 1e-9; y += step) { ctx.moveTo(0, y); ctx.lineTo(this.W, y); }
      ctx.stroke();
    }
    const sq = this.opts.showSquares === false ? null : this.sq, circ = this.opts.showCircles === false ? null : this.circ, morphing = sq && circ && this.morph > 0 && this.morph < 1;
    const nSq = sq ? sq.length / 6 : 0, nCirc = circ ? circ.length / 4 : 0;

    // espaces inutilisés : teinte du conteneur, trouée par chaque objet
    if (this.opts.voids && (sq || circ)) {
      const L = this.layer; if (L.width !== W || L.height !== H) { L.width = W; L.height = H; }
      const g = L.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H);
      set(g); g.fillStyle = 'rgba(240,168,48,.20)'; g.fillRect(0, 0, this.W, this.H);
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath();
      if (circ && (!sq || this.morph < 0.5)) for (let i = 0; i < circ.length; i += 4) { g.moveTo(circ[i + 1] + circ[i + 3], circ[i + 2]); g.arc(circ[i + 1], circ[i + 2], circ[i + 3], 0, TAU); }
      else if (sq) for (let i = 0; i < sq.length; i += 6) this.trace(g, sq, i);
      g.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L, 0, 0); set(ctx);
    }

    // cercles seuls (phase Circle Packing) ou cercles fantômes pendant la transformation
    if (circ && !morphing && !(sq && this.morph >= 1)) {
      ctx.lineWidth = 1.3 * px;
      for (let i = 0; i < circ.length; i += 4) {
        ctx.beginPath(); ctx.arc(circ[i + 1], circ[i + 2], circ[i + 3], 0, TAU);
        const bad = this.opts.collisions && this.circFlags && this.circFlags[i / 4];
        ctx.fillStyle = bad ? 'rgba(255,82,98,.40)' : 'rgba(122,168,255,.16)'; ctx.fill(); ctx.strokeStyle = bad ? '#ff5262' : 'rgba(150,190,255,.85)'; ctx.stroke();
      }
    }
    // carrés (ou morphing cercle → carré)
    if (sq && !(circ && this.morph <= 0 && !sq.length)) {
      const cmap = new Map(); if (morphing) for (let i = 0; i < circ.length; i += 4) cmap.set(circ[i], i);
      const showCol = this.opts.collisions;
      ctx.lineJoin = 'round';
      for (let i = 0; i < sq.length; i += 6) {
        const bad = showCol && sq[i + 5] && !morphing;
        ctx.beginPath();
        if (morphing && cmap.has(sq[i])) { const j = cmap.get(sq[i]); this.traceMorph(ctx, circ[j + 1], circ[j + 2], circ[j + 3], sq, i, this.morph); } else this.trace(ctx, sq, i);
        ctx.fillStyle = bad ? 'rgba(255,82,98,.62)' : this.colorFor(sq[i + 3], sq[i + 4]); ctx.fill();
        ctx.lineWidth = (bad ? 2.2 : 1.1) * px; ctx.strokeStyle = bad ? '#ff5262' : 'rgba(255,255,255,.45)'; ctx.stroke();
      }
      // étiquettes de dimension
      if (this.opts.labels && !morphing && nSq <= 400) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < sq.length; i += 6) {
          const pxSide = sq[i + 3] * t.k, ang = this.opts.labelMode === 'angle'; if (pxSide < (ang ? 24 : 30)) continue;
          ctx.font = `${Math.min(13, pxSide * (ang ? 0.3 : 0.28))}px ui-monospace,SFMono-Regular,Menlo,monospace`;
          const deg = ((((sq[i + 4] * 180) / Math.PI) % 90) + 90) % 90, txt = ang ? `${deg.toFixed(pxSide > 48 ? 1 : 0)}°` : +sq[i + 3].toFixed(2);
          ctx.fillText(txt, t.tx + sq[i + 1] * t.k, t.ty + sq[i + 2] * t.k);
        }
        set(ctx);
      }
    }
    // surcouches : trajectoires, zones libres (NFP), plus grand trou
    const ov = this.overlay;
    if (ov) {
      if (ov.trails && this.opts.trails) {
        ctx.lineWidth = 1.4 * px; ctx.lineJoin = 'round';
        for (const tr of ov.trails) { if (tr.length < 4) continue; ctx.beginPath(); ctx.moveTo(tr[0], tr[1]); for (let q = 2; q < tr.length; q += 2) ctx.lineTo(tr[q], tr[q + 1]); ctx.strokeStyle = 'rgba(120,230,200,.55)'; ctx.stroke(); }
      }
      if (ov.free && this.opts.free) {
        if (ov.free.hole) { const h = ov.free.hole; ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.theta); ctx.setLineDash([6 * px, 4 * px]); ctx.lineWidth = 1.8 * px; ctx.strokeStyle = '#f0a830'; ctx.fillStyle = 'rgba(240,168,48,.18)'; ctx.beginPath(); ctx.rect(-h.side / 2, -h.side / 2, h.side, h.side); ctx.fill(); ctx.stroke(); ctx.restore(); }
        ctx.fillStyle = 'rgba(240,168,48,.85)'; for (const p of ov.free.spots || []) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.2 * px, 0, TAU); ctx.fill(); }
      }
    }
    // limites du conteneur + cotes
    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.strokeStyle = '#ece7dc'; ctx.lineWidth = 1.6 * px; ctx.strokeRect(0, 0, this.W, this.H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#8d8a80'; ctx.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center'; ctx.fillText(`W = ${+this.W.toFixed(3)}`, t.tx + (this.W * t.k) / 2, t.ty - 8);
    ctx.save(); ctx.translate(t.tx - 10, t.ty + (this.H * t.k) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`H = ${+this.H.toFixed(3)}`, 0, 0); ctx.restore();
  }
}
