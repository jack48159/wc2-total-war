// Conquest country select: world map with flags + right-hand flag list, both driving one selection.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import '../ui/worldmap.js';
import { drawScroll } from '../ui/original_menu_controls.js';
const ANCHOR = { x: 781, y: 480 };
const PANEL_W = 235;

class CountrySelect extends Page {
  constructor(id) { super(); this.cid = id || 1; this.route = 'countries/' + this.cid; this.hasOk = true; this.showMedals = true; this.sel = 0; }
  onBack() { E.go('conquest'); }
  async init() {
    const [all, names, sc, , leather] = await Promise.all([
      E.json('data/conquests.json'), E.json('data/countries.json'),
      E.atlas('selcountry_hd'), E.WorldMap.load(), E.image('assets/board_selbattle@2x.webp'),
    ]);
    this.q = all.find(x => x.id === this.cid) || all[0];
    this.names = names; this.sc = sc; this.leather = leather;
    this.countries = this.q.countries;
    if (this.q.mapPreview) this.mapPreview = await E.image(this.q.mapPreview);
    this.list = new E.ScrollList({ w: PANEL_W, h: 900, itemH: 127, count: this.countries.length });
    // map flags: only countries that can actually be picked are buttons
    this.flagBtns = [];
    for (const f of this.q.flags) {
      const idx = this.countries.findIndex(c => c.id === f.id);
      if (idx < 0) continue;
      this.flagBtns.push(Object.assign(new E.Button({ label: this.nameOf(f.id), sfx: null, onClick: () => this.select(idx, true) }), { f, idx }));
    }
    this.widgets = [...this.flagBtns];
  }
  nameOf(id) { return (this.names[id] && this.names[id].name) || id; }
  select(i, fromMap) {
    if (i < 0 || i >= this.countries.length || i === this.sel) return;
    this.sel = i; E.playSfx('select.wav'); this.list.ensureVisible(i);
  }
  startBattle() { this.onOk(); }
  onOk() {
    const c = this.countries[this.sel];
    E.go('matchSetup', this, this.q.stage || 'conquest_' + this.q.id, { player: c.id, commanderLevel: Math.max(0, (E.state.rank || 1) - 1), historicalDiplomacy: true }, this.q.name + ' · ' + this.nameOf(c.id));
  }
  onDown(p) { this.list.down(p); }
  onMove(p) { this.list.move(p); }
  onUp(p) { const i = this.list.up(p); if (i >= 0) this.select(i, false); }
  wheel(dy) { this.list.wheel(dy); }
  key(e) {
    if (!this.dialog && e.key === 'Enter') { e.preventDefault(); this.startBattle(); return; }
    if (!this.dialog && ['PageDown','PageUp','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && !E.keyboardNav) {
      e.preventDefault(); this.select(E.clamp(this.sel + (['PageDown','ArrowDown','ArrowRight'].includes(e.key) ? 1 : -1), 0, this.countries.length - 1)); this.list.ensureVisible(this.sel); return;
    }
    super.key(e);
  }

  theatreMapRect() {
    const roomW=E.panelLeft(PANEL_W)-70,roomH=E.H-235;
    const scale=Math.min(roomW/this.q.mapSize[0],roomH/this.q.mapSize[1]);
    return {x:35+(roomW-this.q.mapSize[0]*scale)/2,y:145,w:this.q.mapSize[0]*scale,h:this.q.mapSize[1]*scale,scale};
  }
  renderBg() {
    if (!this.mapPreview) { E.WorldMap.draw(this.q.center, ANCHOR); return; }
    E.cover(this.leather);const r=this.theatreMapRect();
    E.ctx.drawImage(this.mapPreview,r.x,r.y,r.w,r.h);
  }
  render() {
    const c = E.ctx, U = E.U, WM = E.WorldMap, cen = this.q.center, cur = this.countries[this.sel].id;
    if (this.mapPreview) {
      E.text(this.q.name+' · 1939年9月',45,60,{size:32,color:'#f4e7c3',font:E.CJK_SERIF});
      const lines=E.wrap(this.q.objectiveDescriptions?.[cur]||'',E.panelLeft(PANEL_W)-110,22);
      lines.forEach((line,i)=>E.text(line,45,98+i*28,{size:22,color:'#f4e7c3'}));
    }
    // all flags on the map; pickable ones are buttons
    for (const f of this.q.flags) {
      const fr = this.sc['sflag_' + (f.frame || f.id)]; if (!fr) continue;
      const r=this.mapPreview?this.theatreMapRect():null;
      const p = r?{x:r.x+f.x*r.scale,y:r.y+f.y*r.scale}:WM.toScreen(f.x, f.y, cen, ANCHOR), s = U * f.scale, on = f.id === cur;
      const btn = this.flagBtns.find(b => b.f === f);
      const w = fr.w * s, h = fr.h * s;
      if (btn) { btn.visible = p.x < E.panelLeft(PANEL_W) - 36 && p.y < E.H - E.oy - 112; btn.w = Math.max(w, 72); btn.h = Math.max(h, 72); btn.x = p.x - btn.w / 2; btn.y = p.y - btn.h / 2; }
      if (btn) E.layout.button(btn, 'scenes/country_select/map-flag');
      c.save(); c.shadowColor = on ? 'rgba(255,220,90,0.95)' : 'rgba(0,0,0,0.5)'; c.shadowBlur = on ? 22 : 8; c.shadowOffsetY = on ? 0 : 3;
      const k = on ? 1.14 : (btn && btn.hover ? 1.06 : 1);
      E.drawFrameCentered(fr, p.x, p.y, { scale: s * k, filter: btn && !on ? 'brightness(0.92)' : 'none' });
      if (on) { c.strokeStyle = '#ffe27a'; c.lineWidth = 4; E.layout.canvas(c, 'scenes/country_select.js/original').strokeRect(p.x - w * k / 2 - 3, p.y - h * k / 2 - 3, w * k + 6, h * k + 6); }
      c.restore();
    }
    // right-hand country list
    const L = E.panelLeft(PANEL_W);
    E.drawLeather(this.leather, PANEL_W);
    this.list.x = L; this.list.y = -E.oy; this.list.pad = 14 + E.oy + (E.platform?.isTouch ? 24 * E.view.dpr / E.view.scale : 0); this.list.w = PANEL_W; this.list.h = E.H - (E.platform?.isTouch ? 76 * E.view.dpr / E.view.scale : 0);   // 触屏：顶部避开屏幕圆角，底部给右下角确认按钮留位置 this.list.scroll = E.clamp(this.list.scroll, 0, this.list.max);   // full panel height, as in the original (shows as many cards as fit)
    c.save(); E.layout.canvas(c, 'scenes/country_select.js/original').beginPath(); E.layout.canvas(c, 'scenes/country_select.js/original').rect(L - 30, -E.oy, PANEL_W + 130, E.H); E.layout.canvas(c, 'scenes/country_select.js/original').clip();
    this.countries.forEach((co, i) => {
      // 顶部偏移与 list.pad(点击换算)一致
      const y = this.list.pad - E.oy + i * 127 - this.list.scroll, on = i === this.sel, fr = this.sc['button_' + (co.frame || co.id)];
      if (!fr) return;
      if (y + fr.h * U * 1.05 < -E.oy || y > E.H - E.oy) return;
      E.drawFrame(fr, on ? L - 6 : L + 14, y, { scale: on ? U * 1.05 : U, filter: on ? 'brightness(1.12)' : 'brightness(0.85)' });
    });
    c.restore();
    drawScroll(this);
  }
}

export { CountrySelect };
