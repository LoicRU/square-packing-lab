/** Petits graphiques en courbes (Canvas 2D) : séries multiples, échelle auto, HiDPI. */
export class LineChart {
  constructor(canvas, { series, yFormat = (v) => v.toFixed(1), yMin = 0, yMax = null, xLabel = 'itérations', log = false }) {
    this.canvas = canvas; this.series = series; this.yFormat = yFormat; this.yMin = yMin; this.yMaxFixed = yMax; this.xLabel = xLabel; this.log = log;
    this.data = []; this.pending = false;
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  clear() { this.data = []; this.draw(); }
  push(x, values) {
    const d = this.data, last = d[d.length - 1];
    if (last && x < last.x) this.data = [];
    this.data.push({ x, ...values });
    if (this.data.length > 2400) this.data = this.data.filter((_, i) => i % 2 === 0);
    this.request();
  }
  /** Définit la valeur d'une série à l'abscisse x (lignes triées, fusionnées par x). */
  set(x, key, value) {
    let row = this.data.find((r) => r.x === x);
    if (!row) { row = { x }; this.data.push(row); this.data.sort((a, b) => a.x - b.x); }
    row[key] = value; this.request();
  }
  request() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.draw(); }); }
  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const mL = 38, mR = 8, mT = 8, mB = 18, pw = w - mL - mR, ph = h - mT - mB, d = this.data;
    let xMax = 1, yMax = this.yMaxFixed ?? 1e-9;
    for (const p of d) { xMax = Math.max(xMax, p.x); if (this.yMaxFixed === null) for (const s of this.series) yMax = Math.max(yMax, p[s.key] ?? 0); }
    if (this.yMaxFixed === null) yMax *= 1.1;
    const tr = (v) => (this.log ? Math.log10(1 + Math.max(0, v)) : v), top = tr(yMax), bot = tr(this.yMin);
    const X = (x) => mL + (x / xMax) * pw, Y = (v) => mT + ph - ((tr(v) - bot) / (top - bot || 1)) * ph;
    g.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace'; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.strokeStyle = 'rgba(236,231,220,.08)'; g.fillStyle = '#8d8a80'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const f = i / 3, v = this.log ? Math.pow(10, bot + (top - bot) * f) - 1 : this.yMin + (yMax - this.yMin) * f, y = mT + ph - f * ph;
      g.beginPath(); g.moveTo(mL, y); g.lineTo(w - mR, y); g.stroke(); g.fillText(this.yFormat(v), mL - 5, y);
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText('0', mL, h - 4); g.textAlign = 'right'; g.fillText(`${Math.round(xMax)} ${this.xLabel}`, w - mR, h - 4);
    for (const s of this.series) {
      if (d.length < 1) break;
      g.beginPath(); g.strokeStyle = s.color; g.lineWidth = 1.8;
      let started = false;
      d.forEach((p) => { if (p[s.key] === undefined) return; const x = X(p.x), y = Y(p[s.key]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; });
      g.stroke();
      if (d.filter((p) => p[s.key] !== undefined).length < 40) { g.fillStyle = s.color; for (const p of d) if (p[s.key] !== undefined) { g.beginPath(); g.arc(X(p.x), Y(p[s.key]), 2.4, 0, 7); g.fill(); } g.fillStyle = '#8d8a80'; }
    }
  }
}
