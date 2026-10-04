// "摆件" mode (Pause menu > 摆件): a display case of the accessories at the bottom; drag a piece onto the desk / map, drag a
// placed piece to move it, drag it back onto the case to put it away. Works as a Battle dialog (input + draw hooks) that
// leaves the world visible and drives the camera itself. All placement rules live in accessories.js (META).
import { E } from '../../../core/index.js';
import { Library, CATEGORIES, categoryOf, scaleOf, metaOf, ROT_TAG, LIMIT_DEG, SCALE_RANGE } from '../render/accessories.js';

const CELL_W = 148, CELL_H = 170, GAP = 14, PAD_X = 22, TRAY_H = 222, HANDLE_R = 15;
const BRASS = '#c9a45c';

export class Decorator {
  constructor({ cam, layer, ui1, done }) {
    this.cam = cam; this.layer = layer; this.ui1 = ui1; this.done = done;
    this.hideHud = true; this.ownTouch = true;
    this.tab = 'prop'; this.scroll = 0; this.g = null; this.sel = null; this.note = null;
    this.btn = new E.Button({ edge: true, label: 'done', onClick: () => this.finish() });
    E.focus = this.btn;
    Library.loadAll();
  }

  pinch(scale, cx, cy, dx, dy) { this.cam.pinch(scale, cx, cy, dx, dy); }                  // two fingers: zoom / pan the map
  cancelGesture() { this.g = null; this.layer.held = null; }                              // a second finger arrived: drop the one-finger gesture
  finish() { this.layer.held = null; this.layer.save(); this.done(); }
  say(text) { this.note = { text, until: performance.now() + 1800 }; }

  // ---- geometry ----
  get tray() { const w = Math.min(E.W - 32, 1560); return { x: (E.W - w) / 2, y: E.H - TRAY_H - 16, w, h: TRAY_H }; }
  get ids() { return Library.ids.filter(id => categoryOf(id) === this.tab); }
  get maxScroll() { const t = this.tray; return Math.max(0, this.ids.length * (CELL_W + GAP) - GAP - (t.w - 2 * PAD_X)); }
  cellRect(i) { const t = this.tray; return { x: t.x + PAD_X + i * (CELL_W + GAP) - this.scroll, y: t.y + 34, w: CELL_W, h: CELL_H }; }
  tabRect(i) { const t = this.tray; return { x: t.x + 20 + i * 124, y: t.y - 36, w: 116, h: 40 }; }
  inTray(p) { const t = this.tray; return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y - 2 && p.y <= t.y + t.h; }
  cellAt(p) {
    const t = this.tray; if (p.y < t.y + 34 || p.y > t.y + 34 + CELL_H || p.x < t.x + 8 || p.x > t.x + t.w - 8) return -1;
    return this.ids.findIndex((_, i) => { const r = this.cellRect(i); return p.x >= r.x && p.x <= r.x + r.w; });
  }
  // the desk point under a screen point (pieces live on the 3D desk, which is seen in perspective; the map itself stays flat)
  world(p) { return this.cam.desk3d ? this.cam.toWorld3(p.x, p.y) : this.cam.toWorld(p.x, p.y); }
  // screen position of the selected piece's handles
  handles() {
    const it = this.sel, e = it && this.layer.entry(it); if (!e) return null;
    const cam = this.cam, L = this.layer, canRotate = metaOf(it.id).rot !== 'none';
    if (cam.desk3d) {                                                     // 3D desk: the piece is on the desk (or standing upright on it), so project it
      if (L.isUpright(it)) {                                              // billboard: an upright box, no rotating
        const b = L.billboard(it), hw = e.bbox.w * b.kp / 2, hh = e.bbox.h * b.kp / 2, c = { x: b.x0 + e.cx * b.kp, y: b.y0 + e.cy * b.kp };
        return { c, halfW: hw, halfH: hh, upright: true, canRotate: false, rot: c, del: { x: c.x + hw + 8, y: c.y - hh - 8 } };
      }
      const p = L.pos(it), k = L.k(it), hw = e.bbox.w * k / 2, hh = e.bbox.h * k / 2, r = it.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
      const at = (lx, ly) => cam.toScreen3(p.x + lx * cos - ly * sin, p.y + lx * sin + ly * cos), sc = cam.scale3(p.x, p.y);
      return { c: cam.toScreen3(p.x, p.y), poly: [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)], canRotate, rot: at(0, -hh - 44 / sc), del: at(hw + 10 / sc, -hh - 10 / sc), halfW: hw * sc, halfH: hh * sc };
    }
    const c = cam.toScreen(L.pos(it).x, L.pos(it).y), z = cam.zoom, k = L.k(it) * z;
    const halfH = e.bbox.h * k / 2, halfW = e.bbox.w * k / 2, r = it.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    const at = (lx, ly) => ({ x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos });
    return { c, k, halfW, halfH, rot: at(0, -halfH - 34), del: at(halfW + 8, -halfH - 8), canRotate };
  }
  // is the screen point p on the selected piece?
  hitSel(p) {
    const w = this.world(p), L = this.layer;
    return this.cam.desk3d && L.isUpright(this.sel) ? L.hitUpright(this.sel, p.x, p.y) : L.hit(this.sel, w.x, w.y, 10 / (this.cam.desk3d ? this.cam.scale3(w.x, w.y) : this.cam.zoom));
  }

  // ---- input ----
  down(p) {
    if (this.btn.down(p)) return;
    for (let i = 0; i < 2; i++) { const r = this.sizeBtn(i); if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { this.resize(i ? 1.1 : 1 / 1.1); E.playSfx('btn.wav'); return; } }
    const t = this.tray;
    for (let i = 0; i < CATEGORIES.length; i++) { const r = this.tabRect(i); if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { this.tab = CATEGORIES[i][0]; this.scroll = 0; E.playSfx('btn.wav'); return; } }
    if (this.inTray(p)) {
      const i = this.cellAt(p);
      this.g = { type: 'tray', x: p.x, y: p.y, id: i >= 0 ? this.ids[i] : null, scroll0: this.scroll };
      return;
    }
    const hd = this.handles();
    if (hd) {
      const d = (a) => Math.hypot(p.x - a.x, p.y - a.y);
      if (d(this.flipPos(hd)) < HANDLE_R + 4) { this.layer.flip(this.sel); this.layer.save(); E.playSfx('btn.wav'); return; }
      if (d(hd.del) < HANDLE_R + 4) { this.layer.remove(this.sel); this.sel = null; this.layer.save(); E.playSfx('cancel.wav'); return; }
      if (hd.canRotate && d(hd.rot) < HANDLE_R + 6) { this.g = { type: 'rotate' }; return; }
    }
    const w = this.world(p), hit = this.layer.hitTest(w.x, w.y, 10 / (this.cam.desk3d ? this.cam.scale3(w.x, w.y) : this.cam.zoom), p);
    if (hit) {
      this.sel = hit; this.layer.toFront(hit);
      const q = this.layer.pos(hit); this.g = { type: 'move', it: hit, ox: w.x - q.x, oy: w.y - q.y, moved: false };
      this.layer.held = hit; E.playSfx('select.wav');
      return;
    }
    this.sel = null;
    this.g = { type: 'pan', x: p.x, y: p.y, cx: this.cam.x, cy: this.cam.y, moved: false };   // the map is flat: panning is the plain top-down drag
  }
  move(p) {
    const g = this.g; if (!g) return;
    if (g.type === 'tray') {
      const dx = p.x - g.x, dy = p.y - g.y;
      if (g.id && dy < -12 && -dy > Math.abs(dx) * 0.7) {              // pulled up out of the case: carry a new piece
        Library.load(g.id);
        const w = this.world(p), it = this.layer.add(g.id, w.x, w.y);
        this.sel = it; this.layer.held = it; this.layer.toFront(it); E.playSfx('select.wav');
        this.g = { type: 'move', it, ox: 0, oy: 0, moved: true, fresh: true };
      } else if (Math.abs(dx) > 6) { g.scrolling = true; this.scroll = E.clamp(g.scroll0 - dx, 0, this.maxScroll); }
    } else if (g.type === 'move') {
      const w = this.world(p); g.moved = true; this.layer.setPos(g.it, w.x - g.ox, w.y - g.oy);
    } else if (g.type === 'pan') {
      if (Math.abs(p.x - g.x) + Math.abs(p.y - g.y) > 4) g.moved = true;
      if (g.moved) this.cam.dragTo(g.cx - (p.x - g.x) / this.cam.zoom, g.cy - (p.y - g.y) / this.cam.zoom);
    } else if (g.type === 'rotate' && this.sel) {
      if (this.cam.desk3d) { const w = this.world(p), q = this.layer.pos(this.sel); this.layer.setRot(this.sel, Math.atan2(w.x - q.x, -(w.y - q.y)) * 180 / Math.PI); }   // angle measured on the desk
      else {
        const c = this.cam.toScreen(this.layer.pos(this.sel).x, this.layer.pos(this.sel).y);
        this.layer.setRot(this.sel, Math.atan2(p.x - c.x, -(p.y - c.y)) * 180 / Math.PI);
      }
    }
  }
  up(p) {
    if (this.btn.up(p)) return;
    const g = this.g; this.g = null; if (!g) return;
    if (g.type === 'tray') {
      if (!g.scrolling && g.id && Math.abs(p.x - g.x) + Math.abs(p.y - g.y) < 8) {   // a plain click: put one in the middle of the view
        Library.load(g.id);
        const j = (Math.random() - 0.5) * 60 / this.cam.zoom, it = this.layer.add(g.id, this.cam.x + j, this.cam.y + j);
        this.sel = it; this.layer.save(); E.playSfx('pop.wav');
      }
    } else if (g.type === 'move') {
      this.layer.held = null;
      if (this.inTray(p) && g.moved) { this.layer.remove(g.it); if (this.sel === g.it) this.sel = null; E.playSfx('cancel.wav'); }
      else if (g.moved) E.playSfx('pop.wav');
      this.layer.save();
    } else if (g.type === 'pan') { this.cam.release(); }
    else if (g.type === 'rotate') this.layer.save();
  }
  wheel(dy) {
    const p = E.pointer;
    if (this.inTray(p)) { this.scroll = E.clamp(this.scroll + dy, 0, this.maxScroll); return; }
    if (this.sel && this.hitSel(p)) { this.rotateBy(dy < 0 ? -5 : 5); return; }
    this.cam.zoomAt(p.x, p.y, dy < 0 ? 1.12 : 1 / 1.12);
  }
  flipPos(hd) { return { x: hd.del.x - 2 * HANDLE_R - 10, y: hd.del.y }; }        // the mirror handle sits left of the delete one
  rotateBy(deg) {
    const it = this.sel; if (!it) return;
    if (metaOf(it.id).rot === 'none') { this.say('「' + metaOf(it.id).name + '」只能正放，不能旋转'); return; }
    this.layer.setRot(it, it.rot + deg, false); this.layer.save();
  }
  key(e) {
    if (e.key === 'Escape' || E.hotkeys.match(e) === 'decorate') { this.finish(); return; }
    if ((e.key === 'f' || e.key === 'F') && this.sel) { this.layer.flip(this.sel); this.layer.save(); E.playSfx('btn.wav'); }
    else if (e.key === 'q' || e.key === 'Q') this.rotateBy(e.shiftKey ? -1 : -5);
    else if (e.key === 'e' || e.key === 'E') this.rotateBy(e.shiftKey ? 1 : 5);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { this.layer.remove(this.sel); this.sel = null; this.layer.save(); E.playSfx('cancel.wav'); }
    else if (e.key === '[' || e.key === ']') this.resize(e.key === ']' ? 1.1 : 1 / 1.1);
    else return;
    e.preventDefault();
  }
  // the one global scale of every accessory (see accessories.js): +/- buttons or [ ]
  // the size of the selected piece's category (else of the open tab): the soldiers scale together, independent of the other categories
  sizeCat() { return this.sel ? categoryOf(this.sel.id) : this.tab; }
  resize(f) { const cat = this.sizeCat(), m = E.state.accessoryScales || (E.state.accessoryScales = {}); m[cat] = Math.round(E.clamp(scaleOf(cat) * f, SCALE_RANGE[0], SCALE_RANGE[1]) * 100) / 100; this.layer.rev++; this.layer.save(); }
  sizeBtn(i) { return { x: E.W - 24 - (this.btn.w || 220) - 250 + i * 176, y: 34, w: 40, h: 40 }; }   // i: 0 = minus, 1 = plus
  update(dt) { this.layer.update(dt); }

  // ---- drawing (screen space) ----
  draw() {
    const c = E.ctx, t = this.tray, carrying = this.g && this.g.type === 'move' && this.g.moved, drop = carrying && this.inTray(E.pointer);
    this.drawSelection(c);
    // display case
    c.save();
    const grad = c.createLinearGradient(0, t.y, 0, t.y + t.h); grad.addColorStop(0, '#4a3220'); grad.addColorStop(1, '#251708');
    c.fillStyle = grad; c.strokeStyle = BRASS; c.lineWidth = 3; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 24;
    E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:167').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:167').roundRect(t.x, t.y, t.w, t.h, 14); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:167').fill(); c.shadowColor = 'transparent'; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:167').stroke();
    if (drop) { c.fillStyle = 'rgba(190,40,30,.35)'; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:168').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:168').roundRect(t.x, t.y, t.w, t.h, 14); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:168').fill(); }
    c.restore();
    // tabs
    CATEGORIES.forEach(([id, label], i) => {
      const r = this.tabRect(i), on = id === this.tab;
      c.save(); c.fillStyle = on ? BRASS : '#33220f'; c.strokeStyle = BRASS; c.lineWidth = 2;
      E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:174').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:174').roundRect(r.x, r.y, r.w, r.h + 6, [10, 10, 0, 0]); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:174').fill(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:174').stroke(); c.restore();
      E.text(label, r.x + r.w / 2, r.y + r.h / 2 + 2, { size: 24, bold: true, color: on ? '#2a1a08' : '#e8d3a4', align: 'center' });
    });
    // cells
    c.save(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:178').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:178').rect(t.x + 8, t.y + 2, t.w - 16, t.h - 4); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js/clip').clip();
    const hoverCell = !this.g && this.inTray(E.pointer) ? this.cellAt(E.pointer) : -1;
    this.ids.forEach((id, i) => {
      const r = this.cellRect(i); if (r.x + r.w < t.x || r.x > t.x + t.w) return;
      const meta = metaOf(id), e = Library.items.get(id), hot = i === hoverCell;
      c.fillStyle = 'rgba(8,6,3,.62)'; c.strokeStyle = hot ? '#ffd35a' : 'rgba(201,164,92,.55)'; c.lineWidth = hot ? 3 : 2;
      E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:184').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:184').roundRect(r.x, r.y, r.w, r.h, 10); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:184').fill(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:184').stroke();
      const box = { x: r.x + 10, y: r.y + 8, w: r.w - 20, h: r.h - 62 };
      if (e) {
        const b = e.bbox, s = Math.min(box.w / b.w, box.h / b.h);
        E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:188').drawImage(e.cv, b.x0, b.y0, b.w, b.h, box.x + (box.w - b.w * s) / 2, box.y + (box.h - b.h * s) / 2, b.w * s, b.h * s);
      } else E.text('…', r.x + r.w / 2, box.y + box.h / 2, { size: 30, color: '#a89060', align: 'center' });
      E.text(meta.name, r.x + r.w / 2, r.y + r.h - 38, { size: 18, bold: true, color: '#f1e2bf', align: 'center' });
      E.text(ROT_TAG[meta.rot] + ' · ' + meta.mm + 'mm', r.x + r.w / 2, r.y + r.h - 16, { size: 14, color: meta.rot === 'none' ? '#f0a070' : '#b9a67a', align: 'center' });
    });
    c.restore();
    if (!this.ids.length) E.text(Library.ids.length ? '' : '正在读取 Accessories 目录…', t.x + t.w / 2, t.y + t.h / 2, { size: 24, color: '#b9a67a', align: 'center' });
    if (drop) E.text('松开以收回展示框', t.x + t.w / 2, t.y - 20, { size: 26, bold: true, color: '#ffb0a0', stroke: 'rgba(0,0,0,.7)', align: 'center' });

    // done button
    const u = this.ui1, bd = u.green_normal, k = 1.05, b = this.btn, f = E.fx(b);
    b.w = bd.w * k; b.h = bd.h * k; b.x = E.W - b.w - 24; b.y = 20;
    E.drawFrame(bd, b.x + bd.rx * k, b.y + bd.ry * k + f.dy, { scale: k, filter: f.filter });
    E.drawFrame(u.buttontext_ok, b.x + bd.rx * k, b.y + bd.ry * k + f.dy, { scale: k, filter: f.filter });
    // global size: every piece shares this one scale
    for (let i = 0; i < 2; i++) {
      const r = this.sizeBtn(i);
      c.save(); c.fillStyle = '#33220f'; c.strokeStyle = BRASS; c.lineWidth = 2; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:205').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:205').roundRect(r.x, r.y, r.w, r.h, 8); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:205').fill(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:205').stroke(); c.restore();
      E.text(i ? '＋' : '－', r.x + r.w / 2, r.y + r.h / 2, { size: 26, bold: true, color: '#f1e2bf', align: 'center' });
    }
    const s0 = this.sizeBtn(0);
    E.text((CATEGORIES.find(c => c[0] === this.sizeCat())[1]) + '大小 ' + Math.round(scaleOf(this.sizeCat()) * 100) + '%', s0.x + 108, s0.y + 20, { size: 20, bold: true, color: '#fff', stroke: 'rgba(0,0,0,.75)', strokeW: 5, align: 'center' });
    // hint + notice
    E.text('拖出展示框放到桌面/地图上　·　滚轮 或 Q/E 旋转　·　拖回展示框收回', 24, 30, { size: 20, color: '#fff', stroke: 'rgba(0,0,0,.75)', strokeW: 5 });
    if (this.note && performance.now() < this.note.until) E.text(this.note.text, E.W / 2, 96, { size: 30, bold: true, color: '#ffd9a0', stroke: 'rgba(0,0,0,.8)', strokeW: 6, align: 'center' });
  }

  drawSelection(c) {
    const hd = this.handles(); if (!hd) return;
    const it = this.sel, rule = metaOf(it.id).rot;
    if (hd.poly) {                                                        // 3D desk: the piece's footprint on the desk, in perspective
      c.save(); c.strokeStyle = 'rgba(255,211,90,.9)'; c.lineWidth = 2; c.setLineDash([8, 6]); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:219').beginPath();
      hd.poly.forEach((q, i) => i ? E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:220').lineTo(q.x, q.y) : E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:220').moveTo(q.x, q.y)); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:220').closePath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:220').stroke(); c.restore();
    } else {
      c.save(); c.translate(hd.c.x, hd.c.y); c.rotate(hd.upright ? 0 : it.rot * Math.PI / 180);
      c.strokeStyle = 'rgba(255,211,90,.9)'; c.lineWidth = 2; c.setLineDash([8, 6]);
      E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:224').strokeRect(-hd.halfW - 6, -hd.halfH - 6, hd.halfW * 2 + 12, hd.halfH * 2 + 12);
      c.restore();
    }
    if (hd.canRotate) {                                                   // rotate handle on a stalk
      c.save(); c.strokeStyle = 'rgba(255,211,90,.9)'; c.lineWidth = 2; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:228').beginPath();
      const top = hd.c;
      E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:230').moveTo(top.x, top.y); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:230').lineTo(hd.rot.x, hd.rot.y); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:230').stroke();
      c.fillStyle = '#ffd35a'; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:231').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:231').arc(hd.rot.x, hd.rot.y, HANDLE_R, 0, Math.PI * 2); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:231').fill();
      E.text('↻', hd.rot.x, hd.rot.y + 1, { size: 22, bold: true, color: '#3a2508', align: 'center' });
      if (rule === 'limited') E.text('±' + LIMIT_DEG + '°  ' + Math.round(it.rot) + '°', hd.rot.x, hd.rot.y - 26, { size: 16, color: '#ffe9a8', stroke: 'rgba(0,0,0,.8)', strokeW: 4, align: 'center' });
      c.restore();
    } else {
      E.text('固定角度：只能正放', hd.c.x, hd.c.y + hd.halfH + 30, { size: 18, bold: true, color: '#ffc8a0', stroke: 'rgba(0,0,0,.8)', strokeW: 5, align: 'center' });
    }
    const fp = this.flipPos(hd);
    c.save(); c.fillStyle = '#2f6f9f'; c.strokeStyle = '#fff'; c.lineWidth = 2; E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:239').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:239').arc(fp.x, fp.y, HANDLE_R, 0, Math.PI * 2); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:239').fill(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:239').stroke(); c.restore();
    E.text('⇋', fp.x, fp.y + 1, { size: 20, bold: true, color: '#fff', align: 'center' });
    c.save(); c.fillStyle = '#c0392b'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:242').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:242').arc(hd.del.x, hd.del.y, HANDLE_R, 0, Math.PI * 2); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:242').fill(); E.layout.canvas(c, 'scenes/battle/ui/deco_mode.js:242').stroke(); c.restore();
    E.text('✕', hd.del.x, hd.del.y + 1, { size: 18, bold: true, color: '#fff', align: 'center' });
  }
}
