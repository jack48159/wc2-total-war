// Decision dialog: presents branching scenario decisions with multiple selectable options.
import { E } from '../../../core/index.js';

export class DecisionDialog {
  constructor(game, event, hooks = {}) {
    this.game = game;
    this.event = event;
    this.hooks = hooks;
    this.selectedChoice = null;
    this.hoverChoice = null;
    this.portrait = null;
    this.board = null;
    E.image('assets/board_result@2x.webp').then(img => { this.board = img; }).catch(() => {});
    if (event.image) {
      E.image(`assets/${event.image}`).then(img => { this.portrait = img; }).catch(() => {});
    }
  }

  geom() {
    const W = E.W, H = E.H;
    const u = 1 / (E.view?.scale || 1);
    const w = Math.min(760 * u, W - 40 * u), h = Math.min(520 * u, H - 40 * u);
    const x = (W - w) / 2, y = (H - h) / 2;
    return { x, y, w, h };
  }

  choiceRects(g = this.geom()) {
    const choices = this.event.choices || [], k = Math.min(g.w / 760, g.h / 520);
    const gap = 10 * k, top = g.y + 240 * k;
    const h = Math.max(44 / (E.view?.scale || 1), Math.min(64 * k, (g.y + g.h - 22 * k - top - Math.max(0, choices.length - 1) * gap) / Math.max(1, choices.length)));
    return choices.map((_, i) => ({ x: g.x + 34 * k, y: top + i * (h + gap), w: g.w - 68 * k, h }));
  }

  pick(choiceId) {
    E.playSfx('btn.wav');
    const result = this.hooks.onChoice ? this.hooks.onChoice(choiceId) : this.game.apply({
      type: 'resolveEventDecision',
      country: this.game.player,
      eventId: this.event.id,
      choiceId,
    });
    if (result?.ok === false) {
      this.errorText = '\u51b3\u7b56\u672a\u63d0\u4ea4\uff1a' + (result.reason || '\u8bf7\u91cd\u8bd5');
      return;
    }
    this.errorText = '';
    if (this.hooks.close) this.hooks.close();
  }

  down(p) {
    const g = this.geom();
    const choices = this.event.choices || [];
    const rects = this.choiceRects(g);
    for (let i = 0; i < choices.length; i++) {
      const r = rects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        this.pick(choices[i].id);
        return;
      }
    }
  }

  up(p) {}
  move(p) {
    const g = this.geom();
    const choices = this.event.choices || [];
    const rects = this.choiceRects(g);
    this.hoverChoice = null;
    for (let i = 0; i < choices.length; i++) {
      const r = rects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        this.hoverChoice = choices[i].id;
        break;
      }
    }
  }

  key(e) {
    const choices = this.event.choices || [];
    if (e.key === 'Escape') { const safe = choices.find(c => c.id === 'reject' || c.id === 'decline' || c.id === 'cancel'); if (safe) this.pick(safe.id); return; }
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && num <= choices.length) {
      this.pick(choices[num - 1].id);
    }
  }
  update(dt) {}

  draw() {
    const c = E.ctx, g = this.geom();
    const ev = this.event;
    const choices = ev.choices || [];
    const k = Math.min(g.w / 760, g.h / 520), rects = this.choiceRects(g);
    c.fillStyle = 'rgba(9,12,10,.72)'; c.fillRect(0, 0, E.W, E.H);
    c.save();
    c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 22 * k; c.shadowOffsetY = 9 * k;
    if (this.board) c.drawImage(this.board, g.x, g.y, g.w, g.h);
    else E.drawParchment(g.x, g.y, g.w, g.h, { fill: '#d9c49a', stroke: '#382719', lineWidth: 5 * k });
    c.restore();
    E.text(ev.id?.startsWith('offer_') ? '外交提议 · 玩家决断' : '事件决策 · 玩家决断', g.x + 38 * k, g.y + 25 * k,
      { size: 18 * k, color: '#f0dcae', font: E.CJK_SERIF, bold: true });
    E.text(ev.title || '战略会议决策', g.x + 38 * k, g.y + 86 * k,
      { size: 29 * k, color: '#302417', font: E.CJK_SERIF, bold: true });
    c.save();
    c.fillStyle = 'rgba(91,63,33,.11)'; c.fillRect(g.x + 34 * k, g.y + 116 * k, g.w - 68 * k, 106 * k);
    c.strokeStyle = 'rgba(111,78,42,.45)'; c.lineWidth = k; c.strokeRect(g.x + 34 * k, g.y + 116 * k, g.w - 68 * k, 106 * k);
    c.restore();
    const lines = E.wrap(ev.body || '', g.w - 92 * k, 19 * k);
    lines.slice(0, 3).forEach((line, i) => E.text(line, g.x + 46 * k, g.y + (141 + i * 27) * k,
      { size: 19 * k, color: '#3c2d1e', font: E.CJK_SERIF }));
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i], r = rects[i];
      const isHover = this.hoverChoice === choice.id;
      E.layout.region('battle/decision_dialog/'+choice.id,{...r,label:choice.text},()=>{
      c.save();
      c.fillStyle = isHover ? 'rgba(98,110,64,.30)' : 'rgba(246,230,191,.32)';
      c.strokeStyle = isHover ? '#53653c' : '#80643d'; c.lineWidth = 2 * k;
      c.fillRect(r.x, r.y, r.w, r.h); c.strokeRect(r.x, r.y, r.w, r.h);
      c.fillStyle = isHover ? '#566e3d' : '#5c4930'; c.fillRect(r.x, r.y, 7 * k, r.h);
      c.restore();
      E.text(String(i + 1).padStart(2, '0'), r.x + 25 * k, r.y + r.h / 2,
        { size: 21 * k, color: '#61472b', font: E.NUM, bold: true });
      E.text(choice.text, r.x + 58 * k, r.y + (choice.description ? r.h * .38 : r.h / 2),
        { size: 21 * k, color: '#302417', font: E.CJK_SERIF, bold: true });
      if (choice.description) E.text(choice.description, r.x + 58 * k, r.y + r.h * .72,
        { size: 15 * k, color: '#635038', font: E.CJK_SERIF });
      },'button');
    }
    E.text(ev.id?.startsWith('offer_') ? 'Esc 拒绝；无默认接受' : '数字键选择；无默认选项',
      g.x + g.w / 2, g.y + g.h - 21 * k, { size: 14 * k, align: 'center', color: '#5b4931' });
  }
}
