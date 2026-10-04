// Bank: parchment loan desk opened from the round report. One loan per campaign.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { ResourceBar } from '../ui/resource_bar.js';

const LOANS = [
  { medals: 5, money: 80, industry: 0, title: '紧急拨款', blurb: '以勋章抵押，立刻补充军费。' },
  { medals: 10, money: 180, industry: 0, title: '战争公债', blurb: '发行公债，换取大笔资金。' },
  { medals: 5, money: 0, industry: 40, title: '工业援助', blurb: '勋章换取工业配额。' },
  { medals: 10, money: 0, industry: 90, title: '军工贷款', blurb: '加大工业投入，扩产军备。' },
];

class Bank extends Page {
  constructor(battle) { super(); this.battle = battle; this.route = 'bank'; this.showMedals = true; }
  async init() {
    this.bg = await E.image('assets/bankbg@2x.webp'); this.bar = new ResourceBar(this.ui1);
    this.loanBtns = LOANS.map((loan, i) => Object.assign(new E.Button({
      w: 620, h: 210, label: loan.title,
      onClick: () => this.take(loan)
    }), { loan, i }));
    this.widgets = this.loanBtns;
  }
  onBack() { E.go(this.battle); }
  game() { return this.battle && this.battle.game; }
  take(loan) {
    const g = this.game();
    if (!g) return;
    if (g.loanTaken) { this.notice('每场战役只有一次贷款的机会。'); return; }
    if ((E.state.medals || 0) < loan.medals) {
      this.notice(`勋章不足。\n此项需要 ${loan.medals} 枚勋章，当前 ${E.state.medals || 0} 枚。`);
      return;
    }
    E.state.medals -= loan.medals;
    g.money += loan.money;
    g.industry += loan.industry;
    g.loanTaken = true;
    E.saveState();
    E.playSfx('lvup.wav');
    this.notice(loan.money ? `获得资金 ${loan.money}。` : `获得工业 ${loan.industry}。`);
  }
  renderBg() { E.cover(this.bg); }
  render() {
    const used = !!this.game()?.loanTaken;
    E.panel(240, 250, 1120, 440, { fill: 'rgba(30,20,12,.78)' });
    E.label('银行', 800, 285, 46, { align: 'center' });
    E.label('每场战役只有一次贷款的机会', 800, 344, 28, { align: 'center' });
    this.loanBtns.forEach((btn, i) => {
      Object.assign(btn, { x: 295 + i % 2 * 520, y: 390 + Math.floor(i / 2) * 135, w: 470, h: 106 });
      E.layout.group(btn, 'scenes/bank/loan', () => {
        const f = E.fx(btn, false), loan = btn.loan;
        E.drawFrameCentered(this.ui1.blue_normal, btn.x + btn.w / 2, btn.y + btn.h / 2 + f.dy, { sx: 3.1, sy: 1.4, filter: used ? 'grayscale(1)' : f.filter });
        E.label(loan.title, btn.x + btn.w / 2, btn.y + 30 + f.dy, 30, { align: 'center' });
        E.label(`${loan.medals} 勋章 = ${loan.money ? loan.money + ' 资金' : loan.industry + ' 工业'}`, btn.x + btn.w / 2, btn.y + 73 + f.dy, 27, { align: 'center' });
      });
    });
  }
  drawChrome() {
    super.drawChrome();
    const g = this.game();
    if (g) this.bar.draw(0, 0, 268, g.money, g.industry);
  }
}
export { Bank };
