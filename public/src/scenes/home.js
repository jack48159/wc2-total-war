// Original key art and wooden menu, with the expanded six-item navigation.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { requireLogin } from '../core/auth.js';
import { Updates } from '../core/updates.js';

class Home extends Page {
  constructor() { super(); this.showBack = false; this.route = 'home'; }
  async init() {
    E.user = await requireLogin();
    this.bg = await E.image('assets/mainbg-historical-v2.png');
    this.plank = (await E.atlas('mui_hd')).button_mainmenu;
    const cn = await E.atlas('mui_cn_hd');
    this.menuText = { '战役': cn.m_buttontext_campaign, '征服': cn.m_buttontext_conquest, '指挥官': cn.m_buttontext_commander, '选项': cn.m_buttontext_options };
    this.widgets = [
      ['战役', () => E.go('campaign')],
      ['征服', () => E.go('conquest')],
      ['联机', () => E.go('multiplayer')],
      ['读取', () => E.go('saveScreen', null, 'load', 'home')],
      ['指挥官', () => E.go('commander')],
      ['选项', () => E.go('options')],
    ].map(([label, onClick]) => new E.Button({ label, onClick }));
    const account = this.account = document.createElement('button');
    E.playPlaylist();
    E.playSfx('main_interface.wav');
  }
  onBack() {}
  onShow() {
    if (!this.updateButton) {
      const button = this.updateButton = document.createElement('button');
      button.textContent = '\u68c0\u67e5\u66f4\u65b0';
      Object.assign(button.style, {position:'fixed',left:'16px',top:'max(16px,env(safe-area-inset-top))',zIndex:50,padding:'8px 12px',background:'#eee7d6',color:'#302518',border:'1px solid #987c45',borderRadius:'6px'});
      button.onclick = () => { void Updates.check({force:true}); }; document.body.append(button);
    }
 void Updates.check(); }
  dispose() { this.updateButton?.remove(); this.updateButton = null; Updates.hide(); this.account?.remove(); this.account = null; }
  exitGame() {
    try { window.close(); } catch (e) {}
    if (!window.closed) this.notice('浏览器阻止了自动关闭窗口，请手动关闭此标签页。');
  }
  renderBg() {
    E.cover(this.bg);
    // Viewport coordinates keep the signature clear of the menu on every aspect ratio.
    const c = E.ctx;
    c.save();
    c.globalAlpha = 0.9;
    E.text('TOM-AKA创作', E.W - 28 - (E.reserveR || 0), 42, {
      size: 32, bold: true, font: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
      align: 'right', color: '#ffe6a3', stroke: '#302a22', strokeW: 2,
    });
    c.restore();
  }
  render() {
    // Page.draw translates by ox/oy; convert the viewport edge back to content space.
    // Keep the complete plank (including its baked shadow) inside that edge.
    const scale = 1.24, pitch = 102, pressTravel = 2;
    const w = this.plank.w * scale, h = this.plank.h * scale;
    const totalH = (this.widgets.length - 1) * pitch + h;
    const top = Math.max(20, Math.min(E.H * .64 - totalH / 2,
      E.H - totalH - 20 - pressTravel)) - E.oy;
    const right = E.W - E.ox - (E.reserveR || 0);   // 触屏灵动岛在右侧时，菜单列让出岛的宽度
    this.widgets.forEach((b, i) => {
      Object.assign(b, { x: right - w, y: top + i * pitch, w, h });
      E.layout.group(b, 'scenes/home.js/menu-button', () => {
        const f = E.fx(b, false);
        if (b.focused && !b.pressed) f.filter = 'brightness(1.12)';
        E.drawFrame(this.plank, b.x, b.y + f.dy, { scale, noRef: true, filter: f.filter });
        // Atlas text refs share the plank's original origin, not its trimmed top-left.
        const originX = b.x + this.plank.rx * scale;
        const originY = b.y + this.plank.ry * scale + f.dy;
        const bitmap = this.menuText[b.label];
        if (bitmap) { E.drawFrame(bitmap, originX, originY, { scale, filter: f.filter }); return; }
        const c = E.ctx;
        c.save(); c.filter = f.filter;
        // mui_cn_hd/commander sampled at native resolution: gold #ffe17c,
        // brown #6c4b0d -> #3e2201; about 3px of visible outer gold edging.
        const sample = this.menuText['指挥官'];
        const textX = originX + (sample.w / 2 - sample.rx) * scale;
        const textY = originY + (sample.h / 2 - sample.ry) * scale;
        const ink = c.createLinearGradient(0, textY - sample.h * scale / 2,
          0, textY + sample.h * scale / 2);
        ink.addColorStop(0, '#6c4b0d'); ink.addColorStop(1, '#3e2201');
        // the original label art spreads its characters over the plank ("战    役", "指 挥 官"); do the same
        const chars = [...b.label], span = sample.w * scale * 0.84;
        chars.forEach((ch, i) => E.text(ch, chars.length > 1 ? textX - span / 2 + i * span / (chars.length - 1) : textX, textY, {
          size: 29 * scale, bold: true, font: E.FONT, align: 'center',   // glyph height matched to the original label art
          color: ink, stroke: '#ffe17c', strokeW: 6 * scale,
        }));
        c.restore();
      });
    });
  }
  drawChrome() {
    // Page input still supplies arrow/Enter navigation; focus is painted on the plank itself.
    if (this.dialog) this.dialog.draw();
  }
}
export { Home };
