// Save screen (not in the original game - designed here).
//   30 slots, 15 per side. Each side scrolls on its own (whichever side the finger / wheel is on).
//   tap = select, long press = rename, horizontal drag = pick a slot up and drop it on another position.
//   OK writes the current battle into the selected slot.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { SaveStore, SLOT_COUNT } from '../game/savestore.js';
const COUNT = SLOT_COUNT, PER_SIDE = 15;
const X = [110, 1025], Y0 = 68, W = 465, H = 228, PITCH = 258, VIEW_TOP = 8, FOOTER_H = 112;
const CENTER = { x: 658, y: 165, w: 285, h: 529 };
const LONG_PRESS = 0.6;

const Store = SaveStore;

const fmt = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return { time: `${p(d.getHours())}:${p(d.getMinutes())}`, date: `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}` }; };

class SaveScreen extends Page {
  constructor(battle, mode = 'save', returnTo = null) {
    super(); this.battle = battle; this.mode = mode; this.returnTo = returnTo; this.route = mode; this.hasOk = true;
    this.data = Store.load(); this.scroll = [0, 0]; this.sel = mode === 'load' ? -2 : -1; this.g = null; this.input = null;
  }
  async init() { this.bg = await E.image('assets/commonbg@2x.png'); this.army = await E.atlas('army_hd'); this.flags = await E.atlas('selcountry_hd'); }
  onBack() {
    this.dispose();
    if (this.mode === 'load') {
      E.go(this.returnTo || 'campaign');
    } else {
      E.go(this.battle);
    }
  }
  dispose() { if (this.input) { this.input.el.remove(); this.input = null; } }
  get viewBottom() { return Math.max(VIEW_TOP, E.H - FOOTER_H); }
  get viewHeight() { return this.viewBottom - VIEW_TOP; }
  get maxScroll() { return Math.max(0, Y0 + (PER_SIDE - 1) * PITCH + H - this.viewBottom); }
  rect(pos) { const side = pos < PER_SIDE ? 0 : 1; return { x: X[side], y: Y0 + (pos % PER_SIDE) * PITCH - this.scroll[side], w: W, h: H, side }; }
  slotAt(p) {
    for (let pos = 0; pos < COUNT; pos++) { const r = this.rect(pos); if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && p.y >= VIEW_TOP && p.y <= this.viewBottom) return pos; }
    return -1;
  }
  id(pos) { return this.data.order[pos]; }
  slot(pos) { return this.data.slots[this.id(pos)]; }

  // ---- gestures ----
  onDown(p) {
    if (p.x >= CENTER.x && p.x <= CENTER.x + CENTER.w && p.y >= CENTER.y && p.y <= CENTER.y + CENTER.h) {
      this.sel = -2; E.playSfx('select.wav'); return;
    }
    const pos = this.slotAt(p);
    if (pos >= 0) {
      const r = this.rect(pos);
      const lx = p.x - r.x, ly = p.y - r.y;
      // The save name is aligned to the right top strip: x + W - 46, y + 46 (size 34)
      const isNameArea = (lx >= W - 240 && ly <= 80);
      this.g = { pos, x: p.x, y: p.y, side: pos < PER_SIDE ? 0 : 1, s0: this.scroll[pos < PER_SIDE ? 0 : 1], mode: null, t: 0, at: p, isNameArea };
    }
  }
  onMove(p) {
    const g = this.g; if (!g) return;
    g.at = p; const dx = p.x - g.x, dy = p.y - g.y;
    if (!g.mode && Math.hypot(dx, dy) > 12) {
      // If not already in drag mode via long press, dragging scrolls the list
      g.mode = 'scroll';
    }
    if (g.mode === 'scroll') this.scroll[g.side] = E.clamp(g.s0 - dy, 0, this.maxScroll);
  }
  onUp(p) {
    const g = this.g; this.g = null; if (!g) return;
    if (g.mode === 'drag') {
      const to = this.slotAt(p);
      if (to >= 0 && to !== g.pos) { const [id] = this.data.order.splice(g.pos, 1); this.data.order.splice(to, 0, id); Store.save(this.data); this.sel = to; E.playSfx('select.wav'); }
    } else if (!g.mode && !g.consumed) { this.sel = g.pos; E.playSfx('select.wav'); }
  }
  update(dt) {
    const g = this.g;
    if (g && !g.mode && !g.consumed) {
      g.t += dt;
      if (g.t >= LONG_PRESS) {
        g.consumed = true;
        this.sel = g.pos;
        if (g.isNameArea) {
          this.rename(g.pos);
        } else {
          // Long press on non-name area enters full drag mode (supports vertical and horizontal movement to any slot)
          g.mode = 'drag';
          E.playSfx('select.wav');
        }
      }
    }
  }
  wheel(dy) { const side = E.pointerC.x < 800 ? 0 : 1; this.scroll[side] = E.clamp(this.scroll[side] + dy, 0, this.maxScroll); }
  // pressing the same 存档 hotkey again exits back to the battle, same as Escape (open/close on one key)
  key(e) { if (this.input) return; if (E.hotkeys.match(e) === 'save') { this.onBack(); return; } super.key(e); }

  // ---- rename (HTML input over the slot) ----
  rename(pos) {
    this.dispose();
    const r = this.rect(pos), id = this.id(pos), k = E.view.scale / E.view.dpr, box = E.logicalRect(), cur = (this.data.slots[id] || {}).name || '';
    const el = document.createElement('input');
    el.type = 'text'; el.value = cur; el.maxLength = 16; el.placeholder = '输入名称'; el.spellcheck = false;
    Object.assign(el.style, { position: 'fixed', left: box.left + (r.x + 30 + E.ox) * k + 'px', top: box.top + (r.y + 24 + E.oy) * k + 'px', width: (r.w - 100) * k + 'px', height: 54 * k + 'px',
      boxSizing: 'border-box', font: `${Math.round(34 * k)}px "Microsoft YaHei",sans-serif`, padding: `0 ${Math.round(14 * k)}px`, background: '#fff8e1', color: '#2b1a08',
      border: '3px solid #e6a33a', borderRadius: '8px', outline: 'none', zIndex: 10 });
    const done = ok => {
      if (!this.input) return; const v = el.value.trim(); this.input = null; el.remove();
      if (ok) { const s = this.data.slots[id]; if (s) s.name = v; else if (v) this.data.slots[id] = { name: v, empty: true }; Store.save(this.data); }
    };
    el.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    el.addEventListener('blur', () => done(true));
    document.body.appendChild(el); el.focus(); el.select();
    this.input = { el };
  }

  // ---- save / load ----
  onOk() {
    if (this.sel === -2) {
      const saved = Store.load().autosave;
      if (!saved?.snap) { this.notice('还没有自动存档。'); return; }
      this.dispose(); E.go('battle', saved.stage, saved.snap); return;
    }
    if (this.sel < 0) { this.notice('请先选择一个存档位。'); return; }
    const id = this.id(this.sel), old = this.data.slots[id];
    if (this.mode === 'load') {
      if (!old || !old.snap) {
        this.notice('该存档位是空的，没有可读取的存档。');
        return;
      }
      this.dispose();
      E.go('battle', old.stage, old.snap);
      return;
    }
    const write = async () => {
      const g = this.battle.game, snap = g.snapshot(), name = (old && old.name) || '';
      this.data.slots[id] = { name, snap, time: Date.now(), stage: g.name, flag: g.playerInfo.flag, title: g.info ? g.info.name : '' };
      this.notice(await Store.save(this.data) ? '存档成功。' : '存档失败：本地存储不可用。');
    };
    if (old && old.snap) this.notice('该存档位已有存档，覆盖吗？', { title: '覆盖存档', onOk: write }); else write();
  }

  // ---- drawing ----
  renderBg() { E.cover(this.bg); }
  drawCard(pos, x, y, alpha) {
    return E.layout.region('scenes/save_screen/slot/' + pos, { x, y, w: W, h: H, label: '存档位 ' + (pos + 1) }, () => this.drawCardContents(pos, x, y, alpha), 'button');
  }
  drawCardContents(pos, x, y, alpha) {
    const c = E.ctx, s = this.slot(pos), id = this.id(pos), img = this.ui2.btnsaveback1, sel = this.sel === pos;
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha;
    E.drawFrame(img, x, y, { scale: 1.25, filter: sel ? 'brightness(1.08) saturate(1.15)' : 'none' });
    const name = (s && s.name) || `存档位 ${pos + 1}`;
    // name: top strip, right part. flag: the teal block at the top-left. info: cream area, kept clear of the printed emblem / bottom rules.
    if (name) E.text(name, x + W - 46, y + 46, { size: 34, bold: true, align: 'right', color: '#f4f0dc', stroke: '#2f4a44', strokeW: 5 });
    if (s && s.snap) {
      const t = fmt(s.time), fl = this.flags['sflag_' + s.flag];
      if (fl) E.drawFrameCentered(fl, x + 84, y + 57.5, { scale: 1.5 });
      E.text(`${s.title || s.stage}   第 ${s.snap.round} 回合`, x + 46, y + 128, { size: 28, color: '#2f4a44', bold: true });
      E.text(`${t.time}   ${t.date}`, x + 46, y + 162, { size: 26, color: '#3f5f57', bold: true });
    }
    if (sel) { c.strokeStyle = '#ffe9a6'; c.lineWidth = 6; E.layout.canvas(c, 'scenes/save_screen.js/original').beginPath(); E.layout.canvas(c, 'scenes/save_screen.js/original').roundRect(x + 4, y + 4, W - 8, H - 8, 12); E.layout.canvas(c, 'scenes/save_screen.js/original').stroke(); }
    c.restore();
  }
  render() {
    const c = E.ctx, g = this.g;
    for (let side = 0; side < 2; side++) {
      c.save(); E.layout.canvas(c, 'scenes/save_screen.js/original').beginPath(); E.layout.canvas(c, 'scenes/save_screen.js/original').rect(X[side] - 20, VIEW_TOP, W + 40, this.viewHeight); E.layout.canvas(c, 'scenes/save_screen.js/original').clip();
      for (let i = 0; i < PER_SIDE; i++) {
        const pos = side * PER_SIDE + i, r = this.rect(pos);
        if (r.y + H < VIEW_TOP || r.y > this.viewBottom) continue;
        if (g && g.mode === 'drag' && g.pos === pos) { this.drawCard(pos, r.x, r.y, 0.35); continue; }
        this.drawCard(pos, r.x, r.y);
      }
      c.restore();
    }
    // centre panel: the selected slot (layout matching original/mockup: name at top, flag in middle, title/stage below flag, time & date at bottom)
    const cp = CENTER, s = Store.load().autosave;
    E.drawFrame(this.ui2.btnsaveback2, cp.x, cp.y, { scale: 1.25 });
    const midX = cp.x + cp.w / 2;
    E.text('自动存档', midX, cp.y + 35, { size: 32, bold: true, align: 'center', color: '#f4f0dc', stroke: '#2f4a44', strokeW: 5 });
    if (this.sel === -2) {
      c.save(); c.strokeStyle = '#ffe9a6'; c.lineWidth = 4;
      c.strokeRect(cp.x + 4, cp.y + 4, cp.w - 8, cp.h - 8); c.restore();
    }
    if (s && s.snap) {
      const fl = this.flags['sflag_' + s.flag];
      const t = fmt(s.time);
      // Small horizontal flag centered in the middle block
      if (fl) E.drawFrameCentered(fl, midX, cp.y + 138, { scale: 1.9 });
      // Stage / title & round
      const detailStyle = { size: 26, bold: true, align: 'center', color: '#f4f0dc', stroke: '#2f4a44', strokeW: 4 };
      const lines = text => E.wrap(text, cp.w - 36, 26, true);
      if (s.name) lines(s.name).slice(0, 2).forEach((line, i) => E.text(line, midX, cp.y + 73 + i * 29, detailStyle));
      lines(s.title || s.stage || '未知关卡').slice(0, 3).forEach((line, i) => E.text(line, midX, cp.y + 208 + i * 30, detailStyle));
      E.text(`第 ${s.snap.round ?? 1} 回合`, midX, cp.y + 307, detailStyle);
      // Time & Date at bottom (greenish shade #3e6b61)
      E.text(t.time, midX, cp.y + 366, { size: 36, bold: true, align: 'center', color: '#3e6b61' });
      E.text(t.date, midX, cp.y + 419, { size: 34, bold: true, align: 'center', color: '#3e6b61' });
    }
    E.text(this.mode === 'load' ? '中间为自动存档 · 选择后点击右下角读取' : this.sel === -2 ? '点击右下角读取自动存档' : '长按名字重命名 · 中间自动存档每分钟更新', 800, 868, { size: 24, align: 'center', color: 'rgba(255,240,200,0.7)' });
    // the picked-up slot follows the finger
    if (g && g.mode === 'drag') this.drawCard(g.pos, g.at.x - W / 2, g.at.y - H / 2, 0.9);
  }
}

export { SaveScreen };
