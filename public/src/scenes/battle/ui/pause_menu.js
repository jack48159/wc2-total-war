// Pause menu dialog: the original menubox with a SCROLLABLE list of long buttons.
//   - scroll: mouse wheel, or drag the list up / down (a drag that starts on a button scrolls, it does not click)
//   - long press (about half a second, without moving) on a button, then drag: reorder the list; the order is remembered (E.state.pauseOrder)
//   - keyboard: Up / Down select, Enter / Space activate, the pause hotkey (default Esc) resumes
// actions: { resume, save, options, mode, decorate, photo, replay, restart, quit } - each a callback. opts.label(id) may return a text for an item
// (the 2D / 3D switch shows the mode it will switch to), opts.enabled(id) may disable one.
import { E } from '../../../core/index.js';

// board: the long button art, text: its label art in the text atlas (or `label`, drawn as text where there is no art)
const DEFS = {
  resume: { board: 'longgreen_normal', text: 'buttontext_resume', sfx: 'cancel.wav' },
  save: { board: 'longgreen_normal', text: 'buttontext_save' },
  options: { board: 'longgreen_normal', text: 'buttontext_options' },
  mode: { board: 'longgreen_normal', label: '切换 2D / 3D' },
  allFlags: { board: 'longgreen_normal', label: '全旗帜' },
  decorate: { board: 'longgreen_normal', label: '摆件' },
  photo: { board: 'longgreen_normal', label: '摄影模式' },
  replay: { board: 'longgreen_normal', label: '看海模式' },
  multiplayerInfo: { board: 'longgreen_normal', label: '联机信息' },
  multiplayerPause: { board: 'longgreen_normal', label: '暂停联机' },
  restart: { board: 'longred_normal', text: 'buttontext_restart' },
  quit: { board: 'longred_normal', text: 'buttontext_quit' },
};
export const PAUSE_ITEMS = Object.keys(DEFS).filter(id => id !== 'multiplayerInfo' && id !== 'multiplayerPause');
const ONLINE_ITEMS = new Set(['multiplayerInfo', 'multiplayerPause']);
const PITCH = 88, LONG_PRESS = 0.45, MOVE_SLOP = 9, KB = 1.1, K = 1.34;

export class PauseMenu {
  constructor(ui1, txt, actions, opts = {}) {
    this.ui1 = ui1; this.txt = txt; this.actions = actions; this.opts = opts;
    const allowed = id => DEFS[id] && (!ONLINE_ITEMS.has(id) || (opts.online && opts.extraItems?.includes(id)));
    const saved = Array.isArray(E.state.pauseOrder) ? E.state.pauseOrder.filter(allowed) : [];
    this.order = [...saved, ...PAUSE_ITEMS.filter(id => !saved.includes(id))];      // saved order first, new items at the end
    for (const id of opts.extraItems || []) if (allowed(id) && !this.order.includes(id)) this.order.push(id);
    if (opts.items) this.order = opts.items.filter(allowed);
    this.order = this.order.filter(id => id !== 'resume');                        // user: no 回到游戏 button (Esc / click outside / pause key still resume)
    this.y = Object.fromEntries(this.order.map((id, i) => [id, i * PITCH]));         // displayed offset of each item (eases toward its slot)
    this.scroll = 0; this.g = null; this.focus = 0;
    E.keyboard = false; this.ownTouch = true;
  }

  // ---- geometry ----
  geom() {
    const box = this.ui1.menubox, bw = box.w * K, bh = box.h * K, bx = (E.W - bw) / 2, by = (E.H - bh) / 2, bd = this.ui1.longgreen_normal;
    const w = bd.w * KB, h = bd.h * KB, top = by + bh * 0.235 - h / 2, vt = top - 10, vb = by + bh * 0.935;
    return { box, bw, bh, bx, by, w, h, top, vt, vb, x: E.W / 2 - w / 2 };
  }
  get maxScroll() { const g = this.geom(); return Math.max(0, this.order.length * PITCH - (g.vb - g.top)); }
  clampScroll() { this.scroll = E.clamp(this.scroll, 0, this.maxScroll); }
  rectOf(id, g = this.geom()) { return { x: g.x, y: g.top + this.y[id] - this.scroll, w: g.w, h: g.h }; }
  itemAt(p) {
    const g = this.geom();
    if (p.x < g.bx || p.x > g.bx + g.bw || p.y < g.vt || p.y > g.vb) return null;
    return this.order.find(id => { const r = this.rectOf(id, g); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }) || null;
  }
  enabled(id) { return this.opts.enabled ? this.opts.enabled(id) !== false : true; }
  fire(id) {
    const fn = this.actions[id]; if (!fn || !this.enabled(id)) { E.playSfx('cancel.wav'); return; }
    E.playSfx(DEFS[id].sfx || 'btn.wav'); fn();
  }

  // ---- input ----
  down(p) {
    const id = this.itemAt(p);
    if (id) this.g = { type: 'pending', id, x: p.x, y: p.y, t0: performance.now(), scroll0: this.scroll };
    else if (this.geomHit(p)) this.g = { type: 'scroll', x: p.x, y: p.y, scroll0: this.scroll };     // empty part of the list: drag to scroll
    else if (!this.inBox(p)) this.g = { type: 'outside' };                                            // outside the menu: a click there resumes the game
  }
  inBox(p) { const g = this.geom(); return p.x >= g.bx && p.x <= g.bx + g.bw && p.y >= g.by && p.y <= g.by + g.bh; }
  geomHit(p) { const g = this.geom(); return p.x >= g.bx && p.x <= g.bx + g.bw && p.y >= g.vt && p.y <= g.vb; }
  move(p) {
    const g = this.g; if (!g) return;
    if (g.type === 'pending' && Math.hypot(p.x - g.x, p.y - g.y) > MOVE_SLOP) { g.type = 'scroll'; }           // moved before the long press: it is a scroll
    if (g.type === 'scroll') { this.scroll = g.scroll0 - (p.y - g.y); this.clampScroll(); }
    else if (g.type === 'reorder') this.dragTo(p);
  }
  // the dragged item follows the pointer; the list order follows the item's position
  dragTo(p) {
    const g = this.g, geo = this.geom();
    g.dragY = p.y - g.off;
    const t = E.clamp(Math.round((g.dragY - geo.top + this.scroll) / PITCH), 0, this.order.length - 1), cur = this.order.indexOf(g.id);
    if (t !== cur) { this.order.splice(cur, 1); this.order.splice(t, 0, g.id); E.playSfx('select.wav'); }
  }
  up(p) {
    const g = this.g; this.g = null; if (!g) return;
    if (g.type === 'outside') { if (!this.inBox(p)) { E.playSfx('cancel.wav'); this.actions.resume(); } return; }
    if (g.type === 'pending') { if (this.itemAt(p) === g.id) this.fire(g.id); }
    else if (g.type === 'reorder') { E.state.pauseOrder = [...this.order]; E.saveState(); E.playSfx('pop.wav'); }
  }
  wheel(dy) { this.scroll += dy > 0 ? 66 : -66; this.clampScroll(); }
  key(e) {
    const hk = E.hotkeys && E.hotkeys.match(e);
    if (e.key === 'Escape' || hk === 'pause') { this.actions.resume(); return; }
    const n = this.order.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); E.keyboard = true; this.focus = (this.focus + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      const g = this.geom(), y = this.focus * PITCH;                                   // scroll the focused item into view
      if (y < this.scroll) this.scroll = y; else if (y + PITCH > this.scroll + (g.vb - g.top)) this.scroll = y + PITCH - (g.vb - g.top);
      this.clampScroll();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.fire(this.order[this.focus]); }
  }
  update(dt) {
    const g = this.g, geo = this.geom();
    if (g && g.type === 'pending' && !this.opts.items) {                                                   // held still long enough: lift the button
      if (performance.now() - g.t0 >= LONG_PRESS * 1000) {                          // real time: a slow frame rate must not stretch the long press
        g.type = 'reorder'; g.off = E.pointer.y - this.rectOf(g.id, geo).y; g.dragY = E.pointer.y - g.off; E.playSfx('select.wav');
      }
    }
    if (g && g.type === 'reorder') {                                                   // near the top / bottom of the list: scroll by itself
      const py = E.pointer.y;
      if (py < geo.vt + 46) this.scroll -= 320 * dt; else if (py > geo.vb - 46) this.scroll += 320 * dt;
      this.clampScroll(); this.dragTo(E.pointer);
    }
    const k = 1 - Math.exp(-18 * dt);
    this.order.forEach((id, i) => { if (!(g && g.type === 'reorder' && g.id === id)) this.y[id] += (i * PITCH - this.y[id]) * k; });
  }

  // ---- drawing ----
  drawItem(id, r, lifted) {
    return E.layout.region('battle/pause_menu/'+id, {...r,label:DEFS[id].label},()=>this.drawItemContents(id,r,lifted),'button');
  }
  drawItemContents(id, r, lifted) {
    const c = E.ctx, u = this.ui1, T = this.txt, d = DEFS[id], bd = u[d.board], on = this.enabled(id);
    const hover = !lifted && on && !E.pointer.touch && !E.pointer.down && E.pointer.x >= r.x && E.pointer.x <= r.x + r.w && E.pointer.y >= r.y && E.pointer.y <= r.y + r.h && this.itemAt(E.pointer) === id;
    const pressed = !lifted && this.g && this.g.type === 'pending' && this.g.id === id && this.itemAt(E.pointer) === id;
    const filter = !on ? 'grayscale(0.85) brightness(0.8)' : lifted ? 'brightness(1.15)' : pressed ? 'brightness(0.78)' : hover ? 'brightness(1.12)' : 'none', dy = pressed ? 2 : 0;
    const s = lifted ? KB * 1.06 : KB, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const ox = cx - bd.w * s / 2 + bd.rx * s, oy = cy - bd.h * s / 2 + bd.ry * s + dy;
    c.save();
    if (lifted) { c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 22; c.shadowOffsetY = 8; }
    E.drawFrame(bd, ox, oy, { scale: s, filter });
    c.restore();
    const label = (this.opts.label && this.opts.label(id)) || d.label;
    if (d.text && !(this.opts.label && this.opts.label(id))) {
      const t = pressed && T[d.text + '_press'] ? T[d.text + '_press'] : T[d.text];
      if (t) E.drawFrame(t, ox, oy, { scale: s, filter });
    } else if (label) {                                                              // no art for this label: drawn in the style of the original text art
      // (cream sans-serif with a thick dark outline and a soft shadow; a two-character label is spread out like 选　项 / 保　存)
      const red = d.board === 'longred_normal', chars = [...label], txt = chars.length === 2 ? chars.join('　') : label;
      E.text(txt, cx, cy - 2 + dy, { size: 38, bold: false, color: on ? '#f4ecd6' : '#c9c4b4', stroke: red ? '#4a1e14' : '#25501f', strokeW: 8, shadow: 'rgba(0,0,0,.5)', align: 'center' });
    }
    if (E.keyboard && this.order[this.focus] === id && !lifted) E.focusRing({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  draw() {
    const c = E.ctx, g = this.geom();
    c.fillStyle = 'rgba(0,0,0,0.55)'; E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js:135').fillRect(0, 0, E.W, E.H);
    E.drawFrame(g.box, g.bx + g.box.rx * K, g.by + g.box.ry * K, { scale: K });
    this.clampScroll();
    // the list is clipped to its window
    c.save(); E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js:139').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js:139').rect(g.bx + 6, g.vt, g.bw - 12, g.vb - g.vt); E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js/clip').clip();
    const lifted = this.g && this.g.type === 'reorder' ? this.g.id : null;
    for (const id of this.order) if (id !== lifted) this.drawItem(id, this.rectOf(id, g), false);
    if (lifted) this.drawItem(lifted, { x: g.x, y: this.g.dragY, w: g.w, h: g.h }, true);       // the dragged one on top, at the pointer
    c.restore();
    const max = this.maxScroll;
    if (max > 0) {                                                                                 // more above / below: arrows and a thin scroll bar
      const ax = g.bx + g.bw / 2;
      if (this.scroll > 2) E.text('▲', ax, g.vt + 2, { size: 22, color: '#f1d68a', stroke: 'rgba(0,0,0,.7)', strokeW: 4, align: 'center' });
      if (this.scroll < max - 2) E.text('▼', ax, g.vb - 2, { size: 22, color: '#f1d68a', stroke: 'rgba(0,0,0,.7)', strokeW: 4, align: 'center' });
      const th = (g.vb - g.vt) * (g.vb - g.top) / (this.order.length * PITCH), ty = g.vt + (g.vb - g.vt - th) * (this.scroll / max);
      c.save(); c.fillStyle = 'rgba(0,0,0,.28)'; E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js:150').fillRect(g.bx + g.bw - 34, g.vt, 5, g.vb - g.vt); c.fillStyle = 'rgba(241,214,138,.9)'; E.layout.canvas(c, 'scenes/battle/ui/pause_menu.js:150').fillRect(g.bx + g.bw - 34, ty, 5, th); c.restore();
    }
    E.text(this.opts.items ? '点击菜单外继续看海' : '长按按钮可拖动排序；点击菜单外回到游戏', E.W / 2, g.by + g.bh - 26, { size: 16, color: 'rgba(60,35,10,.75)', align: 'center' });
  }
}
