// Conquest: vertically scrollable scenario cards in two columns.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import '../ui/keyart.js';
import '../ui/worldmap.js';

// Neither mui_hd nor mui2_hd contains text-free scenario cards.
// Atlas-pixel bounds include the outlines of BOTH English lines; North America
// and Energy Crisis need wider patches than the other six cards.
const titleRight = [194, 194, 194, 184, 246, 151, 194, 225];
function withoutEnglish(frame, index) {
  if (!frame) return frame;
  const cv = document.createElement('canvas');
  cv.width = frame.w; cv.height = frame.h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(frame.img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  // Sample this card's clean left background above and below the lettering.
  // Average small strips so individual scanlines do not produce a visible band.
  // Inpaint the lettering column by column: every column is blended vertically between the clean rows above and below the
  // text block, so the card's own tint / map texture flows through (no flat coloured bar, no hard edge on the right).
  const left = 9, right = titleRight[index], fade = 14, y0 = 30, y1 = 93, W = right + fade - left;
  const src = ctx.getImageData(left, 0, W, frame.h), dst = ctx.getImageData(left, 0, W, frame.h);
  // The clean band above the lettering (rows 9..28) is mirror-tiled downwards: real card grain, no smoothing / blur.
  // Plain tinted columns (low vertical variance above the text) use the mirrored grain; columns that already show map relief
  // use a soft vertical blend between the clean rows above and below (mirroring would draw visible zig-zag coastlines).
  const at = (x, y, ch) => src.data[(y * W + x) * 4 + ch];
  const reliefRaw = Array.from({ length: W }, (_, x) => {
    let sd = 0;
    for (let ch = 0; ch < 3; ch++) { let mean = 0; for (let y = 12; y < 28; y++) mean += at(x, y, ch); mean /= 16; let v = 0; for (let y = 12; y < 28; y++) v += (at(x, y, ch) - mean) ** 2; sd = Math.max(sd, Math.sqrt(v / 16)); }
    return Math.max(0, Math.min(1, (sd - 3) / 9));
  });
  const wide = (x, y, ch) => { let s = 0, n = 0; for (let xx = Math.max(0, x - 7); xx <= Math.min(W - 1, x + 7); xx++) { s += at(xx, y, ch); n++; } return s / n; };
  for (let x = 0; x < W; x++) {
    const xa = x / W > (right - left) / W ? 1 - (x - (right - left)) / fade : 1;       // horizontal feather beyond the lettering
    let relief = 0, rn = 0;
    for (let xx = Math.max(0, x - 10); xx <= Math.min(W - 1, x + 10); xx++) { relief += reliefRaw[xx]; rn++; }
    relief /= rn;
    for (let y = y0; y < y1; y++) {
      const m = (y - y0) % 40, ys = 9 + (m < 20 ? m : 39 - m), a = Math.max(0, Math.min(1, xa, (y - y0 + 1) / 3, (y1 - y) / 3)), t = (y - y0) / (y1 - y0 - 1);
      for (let ch = 0; ch < 3; ch++) {
        const i = (y * W + x) * 4 + ch, mirror = at(x, ys, ch);
        const soft = (wide(x, 25, ch) * (1 - t) + wide(x, 96, ch) * t);
        dst.data[i] = Math.round(src.data[i] * (1 - a) + (mirror * (1 - relief) + soft * relief) * a);
      }
    }
  }
  ctx.putImageData(dst, left, 0);
  // A private frame keeps the shared atlas untouched and lets drawFrame apply
  // scaling, layout overrides and hover/press filters to the patch as well.
  return { ...frame, cv };
}

class Conquest extends Page {
  constructor() { super(); this.route = 'conquest'; this.ownTouch = true; }
  async init() {
    const [, cn, mui, mui2, data] = await Promise.all([E.loadKeyArt(this), E.atlas('mui_cn_hd'), E.atlas('mui_hd'), E.atlas('mui2_hd'), E.json('data/conquests.json')]);
    this.cn = cn;
    const m = { mui_hd: mui, mui2_hd: mui2 }, official = data.filter(q => !q.test && !q.featured);
    const scenarios = [...official, ...data.filter(q => q.featured), ...data.filter(q => q.test)];
    this.cards = scenarios.map(q => Object.assign(new E.Button({ w: 515, h: 148, label: q.name, onClick: () => E.go('countrySelect', q.id) }),
      { q, img: withoutEnglish(m[q.atlas][q.card], Math.max(0, official.indexOf(q))) }));
    this.list = new E.ScrollList({ x: 100, y: 170, w: 1400, h: 630, itemH: 165, count: Math.ceil(this.cards.length / 2) });
    this.widgets = this.cards;
    this.layoutCards();
  }
  layoutCards() {
    this.list.h = Math.max(165, E.H - E.oy - this.list.y - 96);
    this.list.scroll = E.clamp(this.list.scroll, 0, this.list.max);
    this.cards.forEach((card, i) => {
      card.x = 132 + (i % 2) * 764;
      card.y = this.list.y + Math.floor(i / 2) * this.list.itemH - this.list.scroll;
      card.visible = card.y + card.h > this.list.y && card.y < this.list.y + this.list.h;
    });
  }
  pointerDown(p) {
    if (this.dialog) return super.pointerDown(p);
    this.layoutCards();
    const point = this.cp(p);
    if (!this.list.down(point)) return super.pointerDown(p);
    this.cardPress = this.cards.find(card => card.down(point)) || null;
  }
  pointerMove(p) {
    if (!this.list.drag || this.dialog) return super.pointerMove(p);
    this.list.move(this.cp(p));
    if (this.list.drag.moved && this.cardPress) { this.cardPress._armed = false; this.cardPress = null; }
    this.layoutCards();
  }
  pointerUp(p) {
    if (!this.list.drag || this.dialog) return super.pointerUp(p);
    const point = this.cp(p), card = this.cardPress;
    const tap = this.list.up(point) >= 0;
    this.cardPress = null;
    if (card) { if (tap) card.up(point); else card._armed = false; }
  }
  wheel(dy) {
    if (this.dialog) return;
    if (this.cardPress) this.cardPress._armed = false;
    this.cardPress = null;
    this.list.wheel(dy); this.layoutCards();
  }
  key(e) {
    if (!this.dialog && ['PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      this.list.scroll = e.key === 'Home' ? 0 : e.key === 'End' ? this.list.max : E.clamp(this.list.scroll + (e.key === 'PageDown' ? 1 : -1) * this.list.h, 0, this.list.max);
      this.layoutCards(); return;
    }
    super.key(e);
  }
  renderBg() { E.cover(this.bg); }
  render() {
    this.layoutCards();
    E.drawKeyArt(this);
    E.label('征服战场', 132, 108, 32, { font: E.CJK_SERIF });
    E.label('上下滑动选择战场', 132, 145, 21, { font: E.CJK_SERIF, strokeW: 2 });
    const ctx = E.ctx;
    ctx.save(); ctx.beginPath(); ctx.rect(this.list.x, this.list.y, this.list.w, this.list.h); ctx.clip();
    for (const card of this.cards) {
      if (!card.visible) continue;
      E.layout.group(card, 'scenes/conquest/scenario', () => {
        const f = E.fx(card, false), frame = card.img, U = E.U, SX = U * 1.18, SY = U * 1.09;
        E.drawFrame(frame, card.x + 3, card.y + 3 + f.dy, { sx: SX, sy: SY, filter: f.filter });
        if (!frame) return;
        const x = card.x + 3 - frame.rx * SX, y = card.y + 3 - frame.ry * SY + f.dy;
        ctx.save(); ctx.filter = f.filter;
        E.label(card.q.featured ? '九月战役 · 1939' : card.q.test ? '测试地图 · 对称兵力' : '征服模式', x + 12 * SX, y + 48 * SY, 18 * U * 1.1, { font: E.CJK_SERIF, strokeW: 2 * U });
        const name = card.q.featured ? '测试-德国与波兰' : card.q.test ? '德国 vs 德国' : card.q.name;
        E.label(name, x + 12 * SX, y + 77 * SY, 24 * U * 1.1, { font: E.CJK_SERIF, strokeW: 2.5 * U });
        ctx.restore();
      });
    }
    ctx.restore();
    if (this.list.max > 0) {
      const h = Math.max(44, this.list.h * this.list.h / (this.list.count * this.list.itemH));
      const y = this.list.y + (this.list.h - h) * this.list.scroll / this.list.max;
      ctx.fillStyle = 'rgba(35,24,14,.6)'; ctx.fillRect(1518, this.list.y, 6, this.list.h);
      ctx.fillStyle = '#d7b577'; ctx.fillRect(1518, y, 6, h);
    }
  }
}

export { Conquest };
