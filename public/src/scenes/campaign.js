// Campaign: faction select (2x2 cards) and the save-slot load screen.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import '../ui/keyart.js';

class Campaign extends Page {
  constructor() { super(); this.route = 'campaign'; }
  async init() {
    await E.loadKeyArt(this);
    const mui = await E.atlas('mui_hd'); this.cn = await E.atlas('mui_cn_hd');
    this.data = await E.json('data/campaigns.json');
    this.cards = this.data.factions.map((f, i) => Object.assign(new E.Button({ w: 580, h: 194, label: f.name, onClick: () => this.pick(f) }),
      { f, img: mui[f.card], txt: this.cn[f.text], i, cx: 192 + (i % 2) * 635, cy: 316 + Math.floor(i / 2) * 216 }));
    this.loadBtn = E.makeLoadButton(() => E.go('saveScreen', null, 'load', 'campaign'));
    this.widgets = [...this.cards, this.loadBtn];
  }
  isLocked(f) { return f.locked && !E.state.unlocked[f.id]; }
  pick(f) {
    if (this.isLocked(f)) return this.lockHint(this.data.unlockHint);
    E.go('campaignList', f.id);
  }
  renderBg() { E.cover(this.bg); }
  render() {
    E.drawKeyArt(this);
    const U = E.U;
    for (const c of this.cards) {
      c.x = c.cx; c.y = c.cy;
      const f = E.fx(c);
      E.drawFrame(c.img, c.cx + 2, c.cy + 2 + f.dy, { scale: U, filter: f.filter });
      E.drawFrame(c.txt, c.cx + 2, c.cy + 2 + f.dy, { scale: U, filter: f.filter });
      if (this.isLocked(c.f)) E.drawFrame(this.ui2.mark_locked, c.cx + 420, c.cy + 92 + f.dy, { scale: 1.2 });
    }
    E.drawLoadButton(this, this.loadBtn);
  }
}

export { Campaign };
