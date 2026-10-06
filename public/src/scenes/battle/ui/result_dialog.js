// Presentation only: the game rule has already set phase/result and emitted
// GAME_OVER. This dialog cannot change the outcome.
import { E } from '../../../core/index.js';

export class ResultDialog {
  constructor(ui1, result, actions) {
    this.ui1 = ui1;
    this.result = result;
    this.actions = actions;
    this.hideHud = true;
    this.ownTouch = true;
  }

  buttons() {
    const w = 300, h = 62, x = E.W / 2 - w / 2;
    return [
      { x, y: E.H / 2 + 30, w, h, action: this.actions.review },
      { x, y: E.H / 2 + 104, w, h, action: this.actions.replay },
      { x, y: E.H / 2 + 178, w, h, action: this.actions.next || this.actions.quit },
    ];
  }

  down() {}
  move() {}
  up(p) {
    const button = this.buttons().find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (button) { E.playSfx('btn.wav'); button.action(); }
  }
  key(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); this.actions.review();
    }
  }

  draw() {
    const c = E.ctx, box = this.ui1.menubox, scale = 1.25;
    c.fillStyle = 'rgba(0,0,0,.6)'; E.layout.canvas(c, 'scenes/battle/ui/result_dialog.js:37').fillRect(0, 0, E.W, E.H);
    const bx = (E.W - box.w * scale) / 2, by = (E.H - box.h * scale) / 2;
    E.drawFrame(box, bx + box.rx * scale, by + box.ry * scale, { scale });
    const won = this.result.result !== 'defeat';
    const title = won ? (this.result.stars === 5 ? '重大胜利' : '胜利') : '失败';
    E.text(title, E.W / 2, E.H / 2 - 115, { size: 48, bold: true, color: '#3b2610', align: 'center' });
    E.text(won && this.result.stars != null ? `${this.result.stars} 星 · 第 ${this.result.round} 回合` : `第 ${this.result.round} 回合`,
      E.W / 2, E.H / 2 - 43, { size: 30, color: '#4b321d', align: 'center' });
    const buttons = this.buttons();
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i], frame = this.ui1[i < 2 ? 'longgreen_normal' : 'longred_normal'];
      E.layout.group({...b,layoutInput:true,label:['查看战场','看海模式',this.actions.next?'下一章':'返回主页'][i]}, 'battle/result_dialog/button', () => {
      const s = Math.min(b.w / frame.w, b.h / frame.h);
      E.drawFrame(frame, b.x + (b.w - frame.w * s) / 2 + frame.rx * s,
        b.y + (b.h - frame.h * s) / 2 + frame.ry * s, { scale: s });
      E.text(['查看战场', '看海模式', this.actions.next?'下一章':'返回主页'][i], b.x + b.w / 2, b.y + b.h / 2,
        { size: 30, color: '#f4ecd6', stroke: '#342214', strokeW: 5, align: 'center' });
      });
    }
  }
}
