// A list picker in the HOI4 style: commanders, marshals, army groups. items: [{ name, sub, note, spec, disabled, tone, onPick }]
import { E } from '../../../core/index.js';
import { steel, inset, tile, portrait, label, inside, PALETTE } from './hoi.js';

const SORTS = [['', '默认顺序'], ['attack', '攻击加成'], ['counter', '反击加成'], ['defence', '减伤加成'], ['armourAttack', '装甲攻击'], ['infantryAttack', '步兵攻击'], ['artilleryAttack', '炮兵攻击'], ['navalAttack', '舰艇攻击'], ['massArmourAttack', '装甲集群攻击'], ['supportAttack', '非装甲攻击'], ['armourDefence', '装甲减伤'], ['infantryDefence', '步兵减伤'], ['navalDefence', '舰艇减伤']];

export class PickDialog {
  constructor({ title, items, portraits, close, empty = '没有可选项' }) {
    this.title = title; this.items = items; this.portraits = portraits; this.close = close; this.empty = empty; this.scroll = 0; this.hover = -1; this.rects = [];
    this.originalItems = [...items]; this.sortIndex = 0; this.sortOpen = false;
    this.sortable = items.some(it => typeof it.owned === 'boolean');
  }
  sortBy(index) {
    this.sortIndex = index; this.sortOpen = false; this.scroll = 0;
    const key = SORTS[index][0];
    this.items = [...this.originalItems].sort((a, b) => Number(!!b.owned) - Number(!!a.owned) || (key ? (b.spec?.mods?.[key] || 0) - (a.spec?.mods?.[key] || 0) : 0));
  }
  geom() { const s = E.clamp(E.H / 900, .8, 1.15), w = 560 * s, per = 7, h = (44 + (this.sortable ? 34 : 0) + per * 58 + 52) * s; return { s, w, per, h, x: (E.W - w) / 2, y: Math.max(10, (E.H - h) / 2) }; }
  draw() {
    const c = E.ctx, g = this.geom(), { s, x, y, w, h, per } = g;
    c.save(); c.fillStyle = 'rgba(0,0,0,.38)'; c.fillRect(0, 0, E.W, E.H); c.restore();
    steel(c, x, y, w, h);
    c.save(); const hg = c.createLinearGradient(0, y, 0, y + 36 * s); hg.addColorStop(0, '#3a3e35'); hg.addColorStop(1, '#22251f'); c.fillStyle = hg; c.fillRect(x + 1, y + 2, w - 2, 36 * s); c.restore();
    label(this.title, x + 14 * s, y + 20 * s, 17 * s, { bold: true, w: w - 70 * s });
    this.rects = [];
    const closeR = { x: x + w - 34 * s, y: y + 6 * s, w: 26 * s, h: 26 * s, act: () => this.close() };
    tile(c, closeR.x, closeR.y, closeR.w, closeR.h, { hover: inside(E.pointer, closeR) }); label('✕', closeR.x + closeR.w / 2, closeR.y + closeR.h / 2, 14 * s, { align: 'center' }); this.rects.push(closeR);
    if (this.sortable) {
      const r = { x: x + 10 * s, y: y + 42 * s, w: w - 20 * s, h: 28 * s, act: () => { this.sortOpen = !this.sortOpen; } };
      tile(c, r.x, r.y, r.w, r.h, { hover: inside(E.pointer, r) });
      label(`排序：${SORTS[this.sortIndex][1]} ▼    已购买优先 · 加成从高到低`, r.x + 10 * s, r.y + r.h / 2, 13 * s);
      this.rects.push(r);
    }
    const listY = y + (this.sortable ? 78 : 44) * s, rowH = 58 * s;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.items.length - per)));
    if (!this.items.length) label(this.empty, x + w / 2, listY + 40 * s, 15 * s, { align: 'center', color: PALETTE.khaki });
    this.items.slice(this.scroll, this.scroll + per).forEach((it, i) => {
      const ry = listY + i * rowH, r = { x: x + 10 * s, y: ry, w: w - 20 * s, h: rowH - 5 * s, act: it.disabled ? null : () => it.onPick() }, hov = inside(E.pointer, r) && !it.disabled;
      inset(c, r.x, r.y, r.w, r.h, hov ? { top: '#505b50', bottom: '#3b453d' } : { top: '#3d453e', bottom: '#303831' });
      if (hov) { c.save(); c.strokeStyle = PALETTE.gold; c.lineWidth = 1.5; c.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1); c.restore(); }
      c.save();
      portrait(c, this.portraits, it.spec, r.x + 6 * s, r.y + 5 * s, 42 * s, r.h - 10 * s, { empty: it.glyph });
      label(it.name, r.x + 58 * s, r.y + 17 * s, 16 * s, { bold: true, color: it.disabled ? '#d3d5c8' : PALETTE.txt, w: r.w - 70 * s });
      const mod = this.sortIndex ? (it.spec?.mods?.[SORTS[this.sortIndex][0]] || 0) : null;
      label(it.sub || '', r.x + 58 * s, r.y + 35 * s, 13 * s, { color: '#bdc5b8', w: r.w - (mod === null ? 70 : 145) * s });
      if (mod !== null) label(`${mod > 0 ? '+' : ''}${Math.round(mod * 100)}%`, r.x + r.w - 10 * s, r.y + 35 * s, 13 * s, { align: 'right', color: mod > 0 ? '#a9d29d' : mod < 0 ? '#e2a18e' : PALETTE.khaki });
      if (it.note) label(it.note, r.x + r.w - 10 * s, r.y + 17 * s, 12 * s, { align: 'right', color: it.disabled ? '#e2a18e' : '#a9d29d', w: r.w * .45 });
      c.restore();
      this.rects.push(r);
    });
    if (this.items.length > per) label(`滚轮翻页  ${this.scroll + 1}-${Math.min(this.items.length, this.scroll + per)} / ${this.items.length}`, x + w / 2, y + h - 16 * s, 12 * s, { align: 'center', color: PALETTE.khaki });
    this.bounds = { x, y, w, h };
    if (this.sortOpen) {
      const top = y + 74 * s, cellW = (w - 20 * s) / 2, cellH = 32 * s;
      steel(c, x + 10 * s, top, w - 20 * s, Math.ceil(SORTS.length / 2) * cellH);
      // The open menu captures list clicks beneath it.
      this.rects = this.rects.slice(0, 2);
      SORTS.forEach(([, text], i) => {
        const r = { x: x + 10 * s + (i % 2) * cellW, y: top + Math.floor(i / 2) * cellH, w: cellW, h: cellH, act: () => this.sortBy(i) };
        tile(c, r.x, r.y, r.w, r.h, { hover: inside(E.pointer, r) });
        label(text, r.x + 10 * s, r.y + r.h / 2, 13 * s, { color: i === this.sortIndex ? PALETTE.gold : PALETTE.txt });
        this.rects.push(r);
      });
    }
  }
  down(p) {
    const r = [...this.rects].reverse().find(q => inside(p, q));
    if (r) { if (r.act) { E.playSfx('btn.wav'); r.act(); } return; }
    if (this.sortOpen) { this.sortOpen = false; return; }
    if (this.bounds && !inside(p, this.bounds)) this.close();
  }
  up() {}
  move() {}
  wheel(dy) { if (!this.sortOpen) this.scroll += dy > 0 ? 1 : -1; }
  key(e) { if (e.key === 'Escape') { e.preventDefault(); this.close(); } }
}
