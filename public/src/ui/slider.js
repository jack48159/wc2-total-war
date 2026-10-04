// Shared options slider: keep the same track and thumb rendering in every menu.
import { E } from '../core/index.js';

export class Slider extends E.Button {
  constructor(o) {
    super(Object.assign({ w: (o.tw ?? 500) + 60, h: 100, sfx: null }, o));
    this.tw = o.tw ?? 500;
    this.drag = false;
    this.baseTy = o.ty || 340;
  }
  get x() { return this.tx - 30; } set x(v) { }
  get y() { return this.ty - 50; } set y(v) { }
  valueAt(p) { return E.clamp((p.x - this.tx) / this.tw, 0, 1); }
  down(p) { if (this.enabled !== false && this.hit(p)) { this.drag = true; this.set(this.valueAt(p)); return true; } return false; }
  up() { const was = this.drag; this.drag = false; if (was && this.onRelease) this.onRelease(); return was; }
  adjust(dir) { this.set(E.clamp(this.get() + dir * (this.step ?? 0.05), 0, 1)); if (this.onRelease) this.onRelease(); }
}

export function drawSliderTrack(s, v, source = 'scenes/options.js/original') {
  const c = E.ctx, x = s.tx, y = s.ty, w = s.tw, hx = x + w * v, r = s.drag ? 34 : s.hover ? 31 : 28;
  c.save();
  c.fillStyle = 'rgba(60,40,18,0.35)'; E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).roundRect(x - 4, y - 12, w + 8, 24, 12); E.layout.canvas(c, source).fill();
  c.fillStyle = '#3f3a30'; E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).roundRect(x, y - 8, w, 16, 8); E.layout.canvas(c, source).fill();
  if (s.steps) {
    c.fillStyle = '#f4e4be';
    for (let i = 0; i < s.steps; i++) { E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).arc(x + w * i / (s.steps - 1), y, 5, 0, Math.PI * 2); E.layout.canvas(c, source).fill(); }
  }
  const fg = c.createLinearGradient(x, 0, x + w, 0); fg.addColorStop(0, '#f2a12c'); fg.addColorStop(1, '#e2531c');
  c.fillStyle = fg; E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).roundRect(x, y - 8, Math.max(16, w * v), 16, 8); E.layout.canvas(c, source).fill();
  c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
  const tg = c.createRadialGradient(hx - 8, y - 10, 4, hx, y, r); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#e9dcc0');
  c.fillStyle = tg; c.strokeStyle = '#7a4a16'; c.lineWidth = 4; E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).arc(hx, y, r, 0, Math.PI * 2); E.layout.canvas(c, source).fill(); E.layout.canvas(c, source).stroke();
  c.shadowColor = 'transparent'; c.fillStyle = '#e2531c'; E.layout.canvas(c, source).beginPath(); E.layout.canvas(c, source).arc(hx, y, r * 0.32, 0, Math.PI * 2); E.layout.canvas(c, source).fill();
  c.restore();
}
