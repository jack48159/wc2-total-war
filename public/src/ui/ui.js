// Shared UI helpers, common components and the base Page used by all menu screens.
import { E } from '../core/index.js';
import { dockLayout, cornerLayout, drawDock } from './corner_plate.js';
import { contentPoint } from './menu_scroll_math.mjs';
E.U = 1.4; // standard UI sprite scale on the 1600x900 design canvas

E.strings = {};
E.loadStrings = async () => {
  if (!Object.keys(E.strings).length) {
    const raw = await E.json('assets/strings_cn.json');
    for (const k in raw) raw[k] = raw[k].split('\\n').join('\n');
    E.strings = raw;
  }
  return E.strings;
};

// Cream label with dark outline, like the original bitmap fonts.
E.label = (s, x, y, size = 36, o = {}) => E.text(s, x, y, Object.assign({ size, bold: true, color: '#f8ecc4', stroke: '#3b2510', strokeW: Math.max(4, size / 6) }, o));

E.wrap = (s, maxW, size, bold) => {
  const c = E.ctx; c.save(); c.font = `${bold ? 'bold ' : ''}${size}px ${E.FONT}`;
  const lines = [];
  for (const para of String(s).split('\n')) {
    let cur = '';
    for (const ch of para) { if (c.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
    lines.push(cur);
  }
  c.restore(); return lines;
};

E.panel = (x, y, w, h, o = {}) => E.layout.region('ui/ui.js/panel', {x,y,w,h}, () => {
  const c = E.ctx; c.save();
  c.fillStyle = o.fill || 'rgba(38,22,10,0.88)'; c.strokeStyle = o.stroke || '#c9a464'; c.lineWidth = o.lineWidth || 3;
  E.layout.canvas(c, 'ui/ui.js:33').beginPath(); E.layout.canvas(c, 'ui/ui.js:33').roundRect(x, y, w, h, o.r == null ? 14 : o.r); E.layout.canvas(c, 'ui/ui.js:33').fill(); if (o.stroke !== null) E.layout.canvas(c, 'ui/ui.js:33').stroke(); c.restore();
});

// Parchment board stretched so its leather frame spans the full (adaptive) window width.
E.drawBoard = img => {
  const w = (E.W - 50) / 0.9258, x = 25 - 37 * w / 1024;
  E.layout.canvas(E.ctx, 'ui/ui.js:39').drawImage(img, x, E.oy - 3, w, 790);
};

E.INK = { paper: '#d9c79f', ink: '#2a1608', gold: '#c9a464', cream: '#f4e7c3', leather: '#3a2414', rule: 'rgba(60,44,20,0.55)' };

E.drawParchment = (x, y, w, h, o = {}) => {
  const c = E.ctx;
  c.save();
  c.fillStyle = o.fill || '#d9c79f';
  c.strokeStyle = o.stroke === null ? 'transparent' : (o.stroke || '#6b4a22');
  c.lineWidth = o.lineWidth || 4;
  c.shadowColor = o.shadow || 'rgba(0,0,0,0.28)';
  c.shadowBlur = o.shadowBlur == null ? 12 : o.shadowBlur;
  c.shadowOffsetY = 4;
  E.layout.canvas(c, 'ui/ui.js:53').beginPath();
  E.layout.canvas(c, 'ui/ui.js:54').roundRect(x, y, w, h, o.r == null ? 10 : o.r);
  E.layout.canvas(c, 'ui/ui.js:55').fill();
  if (o.stroke !== null) E.layout.canvas(c, 'ui/ui.js:56').stroke();
  c.shadowColor = 'transparent';
  c.strokeStyle = 'rgba(255,236,196,0.35)';
  c.lineWidth = 2;
  E.layout.canvas(c, 'ui/ui.js:60').beginPath();
  E.layout.canvas(c, 'ui/ui.js:61').roundRect(x + 7, y + 7, w - 14, h - 14, Math.max(4, (o.r == null ? 10 : o.r) - 4));
  E.layout.canvas(c, 'ui/ui.js:62').stroke();
  c.restore();
};

E.drawInkRule = (x1, y, x2, color) => {
  const c = E.ctx;
  c.save();
  c.strokeStyle = color || E.INK.rule;
  c.lineWidth = 3;
  E.layout.canvas(c, 'ui/ui.js:71').beginPath();
  E.layout.canvas(c, 'ui/ui.js:72').moveTo(x1, y);
  E.layout.canvas(c, 'ui/ui.js:73').lineTo(x2, y);
  E.layout.canvas(c, 'ui/ui.js:74').stroke();
  c.restore();
};


E.drawLeatherFrame = (x, y, w, h, o = {}) => {
  const c = E.ctx;
  c.save();
  c.fillStyle = o.fill || 'rgba(28,16,8,0.92)';
  c.strokeStyle = o.stroke || '#c9a464';
  c.lineWidth = o.lineWidth || 5;
  E.layout.canvas(c, 'ui/ui.js:85').beginPath();
  E.layout.canvas(c, 'ui/ui.js:86').roundRect(x, y, w, h, o.r == null ? 8 : o.r);
  E.layout.canvas(c, 'ui/ui.js:87').fill();
  E.layout.canvas(c, 'ui/ui.js:88').stroke();
  c.strokeStyle = 'rgba(80,52,24,0.9)';
  c.lineWidth = 2;
  E.layout.canvas(c, 'ui/ui.js:91').beginPath();
  E.layout.canvas(c, 'ui/ui.js:92').roundRect(x + 8, y + 8, w - 16, h - 16, 4);
  E.layout.canvas(c, 'ui/ui.js:93').stroke();
  c.restore();
};


// ---------------- base page ----------------
class Page {
  constructor() { this.widgets = []; this.dialog = null; this.hasOk = false; this.showMedals = false; this.showBack = true; }
  async load() {
    if (this._loaded) return;
    // Concurrent navigation to the same page must await its entire initialization.
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const [ui1, ui2] = await Promise.all([E.atlas('ui1_hd'), E.atlas('ui2_hd'), E.loadStrings()]);
      this.ui1 = ui1; this.ui2 = ui2;
      const U = E.U;
      this.back = new E.Button({ w: 71 * U + 26, h: 58 * U + 22, edge: true, sfx: 'cancel.wav', label: '返回', onClick: () => this.onBack() });
      this.ok = new E.Button({ w: 71 * U + 26, h: 58 * U + 22, edge: true, label: '确认', onClick: () => this.onOk && this.onOk() });
      if (this.init) await this.init();
      this._loaded = true;
    })();
    try { await this._loading; }
    finally { this._loading = null; }
  }
  onBack() { E.go('home'); }
  focusables() {
    const l = [];
    if (this.showBack) l.push(this.back);
    if (this.hasOk) l.push(this.ok);
    return l.concat((this.widgets || []).filter(b => b.enabled && b.visible));
  }
  // --- input ---
  // Content widgets live in 1600-wide design space (centered); edge buttons and dialogs use real coordinates.
  cp(p) { return contentPoint(p, E.ox, E.oy); }
  pointerDown(p) {
    if (this.dialog) { this.dialog.down(p); return; }
    const c = this.cp(p);
    const hit = this.focusables().some(b => b.down(b.edge ? p : c));
    if (!hit && this.onDown) this.onDown(c);
  }
  pointerMove(p) { if (!this.dialog && this.onMove) this.onMove(this.cp(p)); }
  pointerUp(p) {
    if (this.dialog) { this.dialog.up(p); return; }
    const c = this.cp(p);
    this.focusables().forEach(b => b.up(b.edge ? p : c));
    if (this.onUp) this.onUp(c);
  }
  key(e) {
    if (this.dialog) { if (this.dialog.key) this.dialog.key(e); return; }
    const list = this.focusables();
    const idx = list.indexOf(E.focus);
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); this.onBack(); return; }
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
      e.preventDefault(); E.keyboard = true;
      const dir = (e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      E.focus = list[(idx + dir + list.length * 2) % list.length] || list[0];
    } else if ((e.key === 'Enter' || e.key === ' ') && E.focus && idx >= 0) { e.preventDefault(); E.focus.click(); }
  }
  // --- drawing ---
  draw() {
    const c = E.ctx;
    if (this.renderBg) this.renderBg();
    c.save(); c.translate(E.ox, E.oy); this.render(); c.restore();
    this.drawChrome();
    this.bleedEdges();
  }
  // 贴着屏幕左/右边的按钮页签：把底色延伸到屏幕边缘(触屏安全区外)，图标文字仍在安全区内；桌面没有安全区，什么也不做
  bleedEdges() {
    if (!E.bleed || !E.view || !(E.view.il > 0.5 || E.view.ir > 0.5)) return;
    const edgeOf = (r, bottom) => {
      const sides = {};
      if (r.x + r.w >= E.W - 3) sides.right = true;
      if (r.x <= 3) sides.left = true;
      if (bottom) sides.bottom = true;
      if (sides.left || sides.right) E.bleed(r, sides);
    };
    if (this.dialog) return;
    for (const w of this.widgets || []) {
      if (!w || w.visible === false || !(w.w > 0) || !(w.h > 0) || w.edge) continue;
      edgeOf({ x: w.x + E.ox, y: w.y + E.oy, w: w.w, h: w.h });
    }
    if (this.showBack) edgeOf({ x: 0, y: E.H - this.back.h, w: this.back.w, h: this.back.h }, true);
    // 确认按钮的图比它的矩形偏出 26px，按矩形取样会取到空白，不做延伸
  }
  drawChrome() {
    const U = E.U, u = this.ui1, u2 = this.ui2;
    if (this.showBack && E.platform?.isTouch) {
      // 触屏圆角屏：返回按钮用角落形状贴合屏幕左下角(原有的灰色按钮板和返回图标)
      const b = this.back, L = dockLayout(u.buttonboard_gray, 'bl'); Object.assign(b, { x: L.x0, y: L.y0, w: L.w, h: L.h });
      drawDock(u.buttonboard_gray, 'bl', { layout: L, pressed: b.pressed, filter: E.fx(b).filter, icon: u.buttontext_back, iconPress: u.buttontext_back_press });
    } else if (this.showBack) {
      const b = this.back, L = cornerLayout(u.buttonboard_gray, 'bl', U);
      Object.assign(b, { x: L.x0, y: L.y0, w: L.w, h: L.h });
      drawDock(u.buttonboard_gray, 'bl', { layout: L, clip: false, pressed: b.pressed, filter: E.fx(b).filter, icon: u.buttontext_back, iconPress: u.buttontext_back_press });
    }
    if (this.hasOk && E.platform?.isTouch) {
      const b = this.ok, L = dockLayout(u.buttonboard_green, 'br'); Object.assign(b, { x: L.x0, y: L.y0, w: L.w, h: L.h });
      drawDock(u.buttonboard_green, 'br', { layout: L, pressed: b.pressed, filter: E.fx(b).filter, icon: u.buttontext_ok, iconPress: u.buttontext_ok_press });
    } else if (this.hasOk) {
      const b = this.ok, L = cornerLayout(u.buttonboard_green, 'br', U);
      Object.assign(b, { x: L.x0, y: L.y0, w: L.w, h: L.h });
      drawDock(u.buttonboard_green, 'br', { layout: L, clip: false, pressed: b.pressed, filter: E.fx(b).filter, icon: u.buttontext_ok, iconPress: u.buttontext_ok_press });
    }
    if (this.showMedals) this.drawMedalHUD();
    const foc = E.keyboard && E.focus; if (foc && this.focusables().includes(foc) && !this.dialog) { E.ctx.save(); if (!foc.edge) E.ctx.translate(E.ox, E.oy); E.focusRing(foc); E.ctx.restore(); }
    if (this.dialog) this.dialog.draw();
  }
  // Medal balance + buy entry, bottom-left after the back button.
  drawMedalHUD() {
    const c = E.ctx, top = E.H - 64, u2 = this.ui2;
    // beige strip (x 118..360) with the medal icon and the balance
    c.save(); c.fillStyle = '#f3e7c6'; E.layout.canvas(c, 'ui/ui.js:175').fillRect(118, top, 216, 64);
    const g = c.createLinearGradient(118, 0, 334, 0); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(120,90,40,0.18)'); c.fillStyle = g; E.layout.canvas(c, 'ui/ui.js:176').fillRect(118, top, 216, 64);
    c.restore();
    E.drawFrame(u2.medal, 145, top + 5, { scale: 1.2, noRef: true });
    E.text(String(E.state.medals), 306, top + 34, { size: 50, bold: true, color: '#ffffff', stroke: '#2a1608', strokeW: 9, font: E.NUM, align: 'right' });
  }

  // --- dialogs ---
  notice(msg, o = {}) { this.dialog = new PaperNotice(this, msg, o); E.playSfx('pop.wav'); }
  lockHint(msg) { this.dialog = new LockHint(this, msg); E.playSfx('pop.wav'); }
  closeDialog() { this.dialog = null; }
}

// Dark translucent hint with a lock icon (locked campaign / stage). Any click dismisses it.
class LockHint {
  constructor(page, msg) { this.page = page; this.msg = msg; this.armed = false; }
  down() { this.armed = true; }
  up() { if (this.armed) this.page.closeDialog(); }
  key(e) { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.page.closeDialog(); } }
  draw() {
    const c = E.ctx; c.fillStyle = 'rgba(0,0,0,0.25)'; E.layout.canvas(c, 'ui/ui.js:195').fillRect(0, 0, E.W, E.H);
    const w = 750, h = 365, x = (E.W - w) / 2, y = (E.H - h) / 2 - 20;
    E.panel(x, y, w, h, { fill: 'rgba(22,20,20,0.88)', stroke: 'rgba(255,255,255,0.55)', lineWidth: 5, r: 28 });
    E.drawFrame(this.page.ui2.mark_locked, E.W / 2, y + 60, { scale: 1.5, noRef: false });
    const lines = String(this.msg).split('\n');
    lines.forEach((ln, i) => E.text(ln, E.W / 2, y + 200 + i * 48, { size: 34, align: 'center', color: '#f4f0e6' }));
  }
}

// Paper style modal with a single green confirm button.
class PaperNotice {
  constructor(page, msg, o) {
    this.page = page; this.msg = msg; this.title = o.title || '';
    this.btn = new E.Button({ w: 180, h: 80, edge: true, onClick: () => { if (o.onOk) o.onOk(); page.closeDialog(); } });
  }
  down(p) { this.btn.down(p); }
  up(p) { this.btn.up(p); }
  key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); this.btn.click(); } }
  draw() {
    const c = E.ctx; c.fillStyle = 'rgba(0,0,0,0.55)'; E.layout.canvas(c, 'ui/ui.js:214').fillRect(0, 0, E.W, E.H);
    const w = 900, x = (E.W - w) / 2, lines = E.wrap(this.msg, w - 120, 34), h = 210 + lines.length * 48, y = (E.H - h) / 2 - 30;
    E.panel(x, y, w, h, { fill: '#d9c79f', stroke: '#6b4a22', r: 8, lineWidth: 5 });
    if (this.title) E.text(this.title, E.W / 2, y + 60, { size: 44, bold: true, align: 'center', color: '#2f2110' });
    lines.forEach((ln, i) => E.text(ln, E.W / 2, y + (this.title ? 130 : 90) + i * 48, { size: 34, align: 'center', color: '#3b2a14' }));
    const b = this.btn; b.x = E.W / 2 - 90; b.y = y + h - 40; const f = E.fx(b);
    E.drawFrame(this.page.ui1.green_normal, b.x - 20, b.y - 12 + f.dy, { scale: 1.45, filter: f.filter });
    E.drawFrame(this.page.ui1.buttontext_ok, b.x - 20, b.y - 12 + f.dy, { scale: 1.45, filter: f.filter });
    if (E.keyboard) E.focusRing(b);
  }
}

export { Page };
