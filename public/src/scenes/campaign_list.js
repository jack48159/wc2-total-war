// Campaign stage select: world map with flags / arrows / date, right-hand stage list, info dialog.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import '../ui/worldmap.js';
import { drawScroll } from '../ui/original_menu_controls.js';
const ANCHOR = { x: 846, y: 481 };
const PANEL_W = 460;

// Paper dialog with the stage briefing and victory conditions.
class BattleInfo {
  constructor(page, faction, b) {
    this.page = page; this.f = faction; this.b = b;
    this.btn = new E.Button({ w: 190, h: 90, edge: true, onClick: () => page.closeDialog() });
  }
  down(p) { this.btn.down(p); }
  up(p) { this.btn.up(p); }
  key(e) { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') this.btn.click(); }
  draw() {
    const c = E.ctx, pg = this.page, lab = pg.data.labels, b = this.b;
    c.fillStyle = 'rgba(0,0,0,0.55)'; E.layout.canvas(c, 'scenes/campaign_list.js/original').fillRect(0, 0, E.W, E.H);
    const w = Math.min(1133, E.W - 120), h = 675, x = (E.W - w) / 2, y = (E.H - h) / 2 - 40, cx = E.W / 2;
    E.layout.canvas(c, 'scenes/campaign_list.js/original').drawImage(pg.paper, x, y, w, h);
    E.text(b.name, cx, y + 68, { size: 58, bold: true, align: 'center', color: '#241608' });
    c.save(); c.strokeStyle = 'rgba(60,44,20,0.55)'; c.lineWidth = 3;
    E.layout.canvas(c, 'scenes/campaign_list.js/original').beginPath(); E.layout.canvas(c, 'scenes/campaign_list.js/original').moveTo(x + 60, y + 108); E.layout.canvas(c, 'scenes/campaign_list.js/original').lineTo(x + w - 60, y + 108); E.layout.canvas(c, 'scenes/campaign_list.js/original').stroke();
    E.layout.canvas(c, 'scenes/campaign_list.js/original').beginPath(); E.layout.canvas(c, 'scenes/campaign_list.js/original').moveTo(x + 60, y + 150); E.layout.canvas(c, 'scenes/campaign_list.js/original').lineTo(cx - 90, y + 150); E.layout.canvas(c, 'scenes/campaign_list.js/original').moveTo(cx + 90, y + 150); E.layout.canvas(c, 'scenes/campaign_list.js/original').lineTo(x + w - 60, y + 150); E.layout.canvas(c, 'scenes/campaign_list.js/original').stroke(); c.restore();
    E.text(b.age, cx, y + 150, { size: 40, bold: true, font: E.SERIF, align: 'center', color: '#241608' });
    E.wrap(b.intro, w - 190, 36).forEach((ln, i) => E.text(ln, x + 100, y + 205 + i * 44, { size: 36, color: '#2b1c0c' }));
    // victory conditions
    const hy = y + 470;
    c.save(); c.strokeStyle = 'rgba(60,44,20,0.55)'; c.lineWidth = 3; E.layout.canvas(c, 'scenes/campaign_list.js/original').beginPath(); E.layout.canvas(c, 'scenes/campaign_list.js/original').moveTo(x + 220, hy); E.layout.canvas(c, 'scenes/campaign_list.js/original').lineTo(cx - 90, hy); E.layout.canvas(c, 'scenes/campaign_list.js/original').moveTo(cx + 90, hy); E.layout.canvas(c, 'scenes/campaign_list.js/original').lineTo(x + w - 220, hy); E.layout.canvas(c, 'scenes/campaign_list.js/original').stroke(); c.restore();
    E.text(lab.victory + '条件', cx, hy, { size: 34, bold: true, align: 'center', color: '#241608' });
    const rows = [[pg.ui2.rank_2, lab.victory, b.victory], [pg.ui2.rank_1, lab.greatVictory, b.greatVictory]];
    rows.forEach(([icon, name, days], i) => {
      const ry = hy + 65 + i * 84;
      E.drawFrameCentered(icon, cx - 190, ry, { scale: 1.35 });
      E.text(name, cx - 130, ry, { size: 40, color: '#2b1c0c' });
      E.text(`${days}${lab.within}`, cx + 110, ry, { size: 40, color: '#2b1c0c' });
    });
    const btn = this.btn; btn.x = cx - 95; btn.y = y + h - 20; const f = E.fx(btn);
    E.drawFrame(pg.ui1.green_normal, btn.x - 10, btn.y - 5 + f.dy, { scale: 1.4, filter: f.filter });
    E.drawFrame(pg.ui1.buttontext_ok, btn.x - 10, btn.y - 5 + f.dy, { scale: 1.4, filter: f.filter });
    if (E.keyboard) E.focusRing(btn);
  }
}

class CampaignList extends Page {
  constructor(fid) {
    super(); this.fid = fid || 'axis'; this.route = 'battles/' + this.fid; this.hasOk = true; this.showMedals = true; this.sel = 0;
    this.cam = null;
  }
  onBack() { E.go('campaign'); }
  startBattle() { this.onOk(); }
  onOk() {
    const b = this.battles[this.sel];
    E.go('matchSetup', this, 'battle_' + b.id.replace('-', ''), { commanderLevel: Math.max(0, (E.state.rank || 1) - 1) }, b.name); // e.g. axis-1 -> battle_axis1
  }
  get unlockedCount() { return this.battles.length; }
  async init() {
    this.data = await E.json('data/campaigns.json');
    this.faction = this.data.factions.find(f => f.id === this.fid);
    this.battles = this.faction.battles;
    this.sb = await E.atlas('selbattle_hd');
    await E.WorldMap.load();
    this.leather = await E.image('assets/board_selbattle@2x.webp');
    this.paper = await E.image('assets/board_paper@2x.webp');
    this.list = new E.ScrollList({ w: PANEL_W, h: 900, itemH: 127, count: this.battles.length });
    this.infoBtn = new E.Button({ x: 4, y: 0, w: 112, h: 78, edge: true, label: '关卡说明', onClick: () => { this.dialog = new BattleInfo(this, this.faction, this.battles[this.sel]); E.playSfx('pop.wav'); } });
    this.widgets = [this.infoBtn];
    this.cam = { x: this.battles[0].center[0], y: this.battles[0].center[1] };
  }
  pick(i) {
    if (i < 0 || i >= this.battles.length) return;
    if (i >= this.unlockedCount) { this.lockHint('完成上一关战役后\n可以进行这一关。'); return; }
    if (i !== this.sel) { this.sel = i; this.list.ensureVisible(i); E.playSfx('select.wav'); }
  }
  onDown(p) { this.list.down(p); }
  onMove(p) { this.list.move(p); }
  onUp(p) { const i = this.list.up(p); if (i >= 0) this.pick(i); }
  wheel(dy) { this.list.wheel(dy); }
  key(e) {
    if (!this.dialog && e.key === 'Enter') { e.preventDefault(); this.startBattle(); return; }
    if (!this.dialog && ['PageDown','PageUp','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && !E.keyboardNav) {
      e.preventDefault(); this.pick(E.clamp(this.sel + (['PageDown','ArrowDown','ArrowRight'].includes(e.key) ? 1 : -1), 0, this.battles.length - 1)); this.list.ensureVisible(this.sel); return;
    }
    super.key(e);
  }

  update(dt) {
    const t = this.battles[this.sel].center, k = 1 - Math.pow(0.0015, dt);
    this.cam.x += (t[0] - this.cam.x) * k; this.cam.y += (t[1] - this.cam.y) * k;
  }
  renderBg() { E.WorldMap.draw([this.cam.x, this.cam.y], ANCHOR); }
  render() {
    const c = E.ctx, U = E.U, b = this.battles[this.sel], cen = [this.cam.x, this.cam.y], WM = E.WorldMap;
    // flags + arrows of the selected stage
    for (const a of b.arrows) {
      const p = WM.toScreen(a.x, a.y, cen, ANCHOR), fr = this.sb['maparrow_' + a.id.replace('_', '_')] || this.sb['maparrow_' + a.id];
      if (!fr) continue;
      c.save(); c.translate(p.x, p.y); c.rotate(a.rot * Math.PI / 180); E.drawFrame(fr, 0, 0, { scale: U * a.scale, alpha: 0.92 }); c.restore();
    }
    for (const f of b.flags) {
      const p = WM.toScreen(f.x, f.y, cen, ANCHOR), fr = this.sb['sflag_' + f.id]; if (!fr) continue;
      c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 8; c.shadowOffsetY = 3;
      E.drawFrameCentered(fr, p.x, p.y, { scale: U * f.scale }); c.restore();
    }
    const ap = WM.toScreen(b.agePos[0], b.agePos[1], cen, ANCHOR);
    E.text(b.age, ap.x, ap.y + 8, { size: 66, bold: true, font: E.NUM, align: 'center', color: '#ffffff', stroke: '#3a2412', strokeW: 10 });
    // faction emblem (top center of the map area)
    E.drawFrame(this.ui2[this.faction.emblem], 598, -6, { scale: U });
    // right-hand stage list
    const L = E.panelLeft(PANEL_W);
    E.drawLeather(this.leather, PANEL_W);
    this.list.x = L; this.list.y = -E.oy; this.list.pad = 22 + E.oy; this.list.w = PANEL_W; this.list.h = E.H; this.list.scroll = E.clamp(this.list.scroll, 0, this.list.max);   // full panel height, as in the original (shows as many cards as fit)
    c.save(); E.layout.canvas(c, 'scenes/campaign_list.js/original').beginPath(); E.layout.canvas(c, 'scenes/campaign_list.js/original').rect(L - 70, -E.oy, PANEL_W + 170, E.H); E.layout.canvas(c, 'scenes/campaign_list.js/original').clip();   // the selected card sticks out to the left of the leather
    this.battles.forEach((bt, i) => {
      const y = 22 + i * 127 - this.list.scroll, on = i === this.sel, locked = i >= this.unlockedCount;
      const x = on ? L - 38 : L + 34, fr = this.sb[bt.card];
      E.drawFrame(fr, x, on ? y - 6 : y, { sx: on ? 1.7 : U, sy: on ? 1.5 : U, filter: on ? 'brightness(1.05)' : 'brightness(0.95)' });
      if (locked) E.drawFrameCentered(this.ui2.mark_locked, L + 282, y + 64, { scale: 1.15 });
      if (on) E.text(bt.name, Math.min(x + fr.w * 1.7 - 64, L + PANEL_W - 40), y + 72, { size: 42, bold: true, font: E.SERIF, align: 'right', color: '#f4e7c3', stroke: '#3a1c0c', strokeW: 7 });   // right-aligned, last character fully inside the card
    });
    c.restore();
    drawScroll(this);
    // "i" button (real coordinates, top-left)
    const ib = this.infoBtn, f = E.fx(ib), ix = ib.x - E.ox, iy = -E.oy;
    c.save(); c.translate(0, f.dy);
    const gr = c.createLinearGradient(0, iy, 0, iy + 76); gr.addColorStop(0, b.hover ? '#d23c1c' : '#c22c14'); gr.addColorStop(1, '#8a1208');
    c.fillStyle = f.filter === 'none' ? gr : (ib.pressed ? '#7a1006' : gr); c.strokeStyle = '#e8d9b0'; c.lineWidth = 4;
    E.layout.canvas(c, 'scenes/campaign_list.js/original').beginPath(); E.layout.canvas(c, 'scenes/campaign_list.js/original').roundRect(ix + 2, iy - 20, 108, 96, [0, 0, 20, 0]); E.layout.canvas(c, 'scenes/campaign_list.js/original').fill(); E.layout.canvas(c, 'scenes/campaign_list.js/original').stroke();
    c.restore();
    E.text('i', ix + 56, iy + 40 + f.dy, { size: 66, bold: true, font: E.SERIF, align: 'center', color: '#fff8ea' });
  }
}

export { CampaignList };
