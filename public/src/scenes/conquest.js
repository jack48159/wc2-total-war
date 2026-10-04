// Conquest: scenario grid (2 columns x 4 rows).
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import '../ui/keyart.js';

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
  constructor() { super(); this.route = 'conquest'; }
  async init() {
    await E.loadKeyArt(this);
    this.cn = await E.atlas('mui_cn_hd');
    const m = { mui_hd: await E.atlas('mui_hd'), mui2_hd: await E.atlas('mui2_hd') };
    this.data = await E.json('data/conquests.json');
    const official = this.data.filter(q => !q.test);
    this.cards = official.map((q, i) => Object.assign(new E.Button({ w: 515, h: 148, label: q.name, onClick: () => E.go('countrySelect', q.id) }),
      { q, img: withoutEnglish(m[q.atlas][q.card], i), cx: 132 + (i % 2) * 764, cy: 243 + Math.floor(i / 2) * 165 }));
    // test maps (e.g. the symmetric mirror map used to benchmark the AI) are not scenario cards: a text link at the bottom right
    this.tests = this.data.filter(q => q.test).map((q, i) => Object.assign(new E.Button({ w: 470, h: 56, label: q.name, onClick: () => E.go('countrySelect', q.id) }), { q, tx: 1000, ty: 96 + i * 60 }));
    this.widgets = [...this.cards, ...this.tests];
  }
  renderBg() { E.cover(this.bg); }
  render() {
    E.drawKeyArt(this);
    for (const c of this.cards) {
      c.x = c.cx; c.y = c.cy;
      E.layout.group(c, 'scenes/conquest/scenario', () => {
        // the original card is stretched wider than the atlas frame (x1.18 / y1.09 of the base scale)
        const f = E.fx(c, false), frame = c.img, U = E.U, SX = U * 1.18, SY = U * 1.09;
        E.drawFrame(frame, c.x + 3, c.y + 3 + f.dy, { sx: SX, sy: SY, filter: f.filter });
        if (!frame) return;
        const x = c.x + 3 - frame.rx * SX, y = c.y + 3 - frame.ry * SY + f.dy;
        // Match the original two-line hierarchy: small "征服模式", large "欧洲 1939", both straight on the card art.
        E.ctx.save();
        E.ctx.filter = f.filter;
        E.label('征服模式', x + 12 * SX, y + 48 * SY, 18 * U * 1.1,
          { font: E.CJK_SERIF, strokeW: 2 * U });
        E.label(c.q.name, x + 12 * SX, y + 77 * SY, 24 * U * 1.1,
          { font: E.CJK_SERIF, strokeW: 2.5 * U });
        E.ctx.restore();
      });
    }
    for (const t of this.tests) {
      t.x = t.tx; t.y = t.ty;
      E.layout.group(t, 'scenes/conquest/test-map', () => {
        const f = E.fx(t, false), hot = t.hover || t.focused;
        E.ctx.save(); E.ctx.filter = f.filter;
        E.label('测试地图 · ' + t.q.name, t.x + 8, t.y + 18 + f.dy, 22, { font: E.CJK_SERIF, strokeW: 2 });
        E.label(t.q.subtitle || '', t.x + 8, t.y + 46 + f.dy, 17, { font: E.CJK_SERIF, strokeW: 1.5 });
        if (hot) { E.ctx.fillStyle = '#ffe17c'; E.ctx.fillRect(t.x + 8, t.y + 56 + f.dy, 300, 2); }
        E.ctx.restore();
      });
    }
  }
}

export { Conquest };
