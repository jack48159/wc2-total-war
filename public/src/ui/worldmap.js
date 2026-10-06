// Shared map + list helpers for the campaign / conquest selection pages.
import { E } from '../core/index.js';
import { clampScroll, dragScroll, scrollMax } from './menu_scroll_math.mjs';

// World overview map. World coordinates (battlelist / conquestlist units) map linearly onto the overview
// image: ov = (AX + K*x, AY + K*y). Constants were fitted against real-device screenshots (image registration).
const WM = E.WorldMap = {
  K: 2.87, AX: 46, AY: 31, S: 0.98, img: null,
  async load() {
    if (this.meta) return;
    return this.loading || (this.loading = E.json('assets/map/ov/index.json').then(meta => {
      this.tiles = []; this.requests = new Map(); this.queue = []; this.activeLoads = 0;
      this.meta = meta;
    }).catch(error => { this.loading = null; throw error; }));
  },
  requestTile(cx, cy) {
    const index = cy * this.meta.cols + cx;
    if (this.tiles[index] || this.requests.has(index)) return;
    this.requests.set(index, true); this.queue.push({ cx, cy, index });
    this.pumpTiles();
  },
  pumpTiles() {
    while (this.activeLoads < 4 && this.queue.length) {
      const { cx, cy, index } = this.queue.shift();
      this.activeLoads++;
      E.image(`assets/map/ov/${cx}_${cy}.webp`).then(image => { this.tiles[index] = image; })
        .catch(() => { setTimeout(() => this.requests.delete(index), 5000); })
        .finally(() => { this.activeLoads--; this.pumpTiles(); });
    }
  },
  // Screen offset (real coords) of the overview's top-left so that world point `center` lands on `anchor`,
  // clamped so the map always covers the whole window (no empty sea/void past the map edge).
  off(center, anchor) {
    const s = this.S, m = this.meta;
    let dx = anchor.x + E.ox - (this.AX + this.K * center[0]) * s, dy = anchor.y + E.oy - (this.AY + this.K * center[1]) * s;
    // 地图要盖住整个屏幕(含触屏安全区外的刘海/圆角区域)；桌面没有安全区，l/r/t/b 都是 0，行为不变
    const g = this.bleed();
    dx = Math.min(-g.l, Math.max(dx, E.W + g.r - m.w * s)); dy = Math.min(-g.t, Math.max(dy, E.H + g.b - m.h * s));
    return { dx, dy };
  },
  bleed() { const v = E.view || {}, k = v.scale || 1; return { l: (v.il || 0) / k, r: (v.ir || 0) / k, t: (v.it || 0) / k, b: (v.ib || 0) / k }; },
  // Draw only the visible 512px tiles.
  draw(center, anchor) {
    const c = E.ctx, s = this.S, m = this.meta, T = m.t, { dx, dy } = this.off(center, anchor);
    const g = this.bleed();
    c.fillStyle = '#1d2c44'; E.layout.canvas(c, 'ui/worldmap.js:28').fillRect(-g.l, -g.t, E.W + g.l + g.r, E.H + g.t + g.b);
    const x0 = Math.max(0, Math.floor((-g.l - dx) / s / T)), x1 = Math.min(m.cols - 1, Math.floor((E.W + g.r - dx) / s / T));
    const y0 = Math.max(0, Math.floor((-g.t - dy) / s / T)), y1 = Math.min(m.rows - 1, Math.floor((E.H + g.b - dy) / s / T));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const t = this.tiles[cy * m.cols + cx];
      if (!t) { this.requestTile(cx, cy); continue; }
      E.layout.canvas(c, 'ui/worldmap.js:33').drawImage(t, Math.floor(dx + cx * T * s), Math.floor(dy + cy * T * s), Math.ceil(t.width * s) + 1, Math.ceil(t.height * s) + 1);
    }
  },
  // World point -> content-space screen position (same clamped offset as draw()).
  toScreen(x, y, center, anchor) {
    const { dx, dy } = this.off(center, anchor), s = this.S;
    return { x: dx + (this.AX + this.K * x) * s - E.ox, y: dy + (this.AY + this.K * y) * s - E.oy };
  },
};

// Vertical scroll list: drag or wheel; a tap (no drag) resolves to an item index.
E.ScrollList = class {
  constructor(o) { Object.assign(this, { scroll: 0, drag: null, x: 0, y: 0, w: 100, h: 100, itemH: 100, count: 0 }, o); }
  get max() { return scrollMax(this.count, this.itemH, this.h); }
  contains(p) { return p.x >= this.x && p.x <= this.x + this.w && p.y >= this.y && p.y <= this.y + this.h; }
  down(p) { if (!this.contains(p)) return false; this.drag = { y: p.y, s: this.scroll, moved: false }; return true; }
  move(p) {
    if (!this.drag) return;
    if (Math.abs(p.y - this.drag.y) > 8) this.drag.moved = true;
    if (this.drag.moved) this.scroll = dragScroll(this.drag.s, this.drag.y, p.y, this.max);
  }
  up(p) {
    const d = this.drag; this.drag = null;
    if (!d || d.moved || !this.contains(p)) return -1;
    const i = Math.floor((p.y - this.y - (this.pad || 0) + this.scroll) / this.itemH);
    return i >= 0 && i < this.count ? i : -1;
  }
  wheel(dy) { this.scroll = clampScroll(this.scroll, dy, this.max); }
  ensureVisible(i) {
    const top = i * this.itemH, bottom = top + this.itemH;
    if (top < this.scroll) this.scroll = top; else if (bottom > this.scroll + this.h) this.scroll = bottom - this.h;
    this.scroll = E.clamp(this.scroll, 0, this.max);
  }
};

// Right-anchored leather side panel of width w (content-space x of its left edge = 1600 + ox - w).
E.panelLeft = w => 1600 + E.ox - w - (E.reserveR || 0);   // 触屏灵动岛在右侧时，右边的竖列让出岛的宽度
E.drawLeather = (img, w) => E.layout.canvas(E.ctx, 'ui/worldmap.js:70').drawImage(img, E.panelLeft(w), -E.oy, w, E.H);
