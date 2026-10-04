// Opening sequence of a stage: briefing board -> round report -> general dialogue -> (map with our areas blinking).
// While it is active it swallows all input; `onDone` fires after the last step.
import { E } from '../../../core/index.js';
import '../../../ui/ui.js';
import { drawTalk, loadPortrait, takeStageDialogue } from './talk.js';

export class Opening {
  static async create(game, ui1, callbacks) {
    await E.loadStrings();
    const o = new Opening(game, ui1, callbacks);
    o.board = await E.image('assets/board_intro@2x.webp');
    const who = [...new Set(o.lines.map(l => l.who))];
    await Promise.all(who.map(w => loadPortrait(w).then(i => { o.portraits[w] = i; })));
    return o;
  }

  // callbacks: { done, bank }
  constructor(game, ui1, callbacks) {
    this.game = game; this.ui1 = ui1; this.cb = callbacks; this.phase = 'intro'; this.talkIdx = 0; this.portraits = {};
    this.lines = takeStageDialogue(game); this.income = game.income();
    const mk = (w, h, label, fn) => new E.Button({ w, h, edge: true, sfx: 'btn.wav', label, onClick: fn });
    this.okBtn = mk(170, 80, '确认', () => this.advance());
    this.bankBtn = mk(170, 80, '银行', () => this.cb.bank());
  }

  get buttons() { return this.phase === 'intro' ? [this.okBtn] : this.phase === 'round' ? [this.okBtn, this.bankBtn] : []; }
  disarm() { this.okBtn.disarm(); this.bankBtn.disarm(); }
  advance() {
    if (this.phase === 'intro') this.phase = 'round';
    else if (this.phase === 'round') { if (this.lines.length) this.phase = 'talk'; else this.cb.done(); }
    else if (this.phase === 'talk' && ++this.talkIdx >= this.lines.length) this.cb.done();
  }

  // ---- input (always consumed) ----
  down(p) { this.buttons.forEach(b => b.down(p)); }
  up(p) {
    if (this.phase === 'talk') { E.playSfx('btn.wav'); this.advance(); return; }
    this.buttons.forEach(b => b.up(p));
  }
  key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { E.playSfx('btn.wav'); this.advance(); } }

  draw(c, labels) {
    if (this.phase === 'intro') this.drawIntro(c, labels);
    else if (this.phase === 'round') this.drawRoundBoard(c);
    else this.drawTalk(c);
  }
  // 1) stage briefing on the original folder board (960x640 art, crowns are part of the picture)
  drawIntro(c, lab) {
    const k = 1.404, bx = (E.W - 960 * k) / 2, by = (E.H - 640 * k) / 2 + 3, X = px => bx + px * k, Y = py => by + py * k, b = this.game.info;
    c.fillStyle = 'rgba(0,0,0,0.55)'; E.layout.canvas(c, 'scenes/battle/ui/opening.js:50').fillRect(0, 0, E.W, E.H);
    E.layout.canvas(c, 'scenes/battle/ui/opening.js:51').drawImage(this.board, bx, by, 960 * k, 640 * k);
    if (b) {
      E.text(b.name, X(471), Y(97), { size: 52, bold: true, align: 'center', color: '#1c1208' });
      E.text(b.age, X(471), Y(156), { size: 36, bold: true, font: E.NUM, align: 'center', color: '#2a1c0c' });
      E.wrap(b.intro || '', (816 - 139) * k, 33).forEach((ln, i) => E.text(ln, X(139), Y(191) + i * 39, { size: 33, color: '#2a1c0c' }));
      if (b.victory != null) {                                     // campaign stages only; conquest has no round limit
        E.text(lab.victory + '条件', X(480), Y(383), { size: 30, bold: true, align: 'center', color: '#2a1c0c' });
        E.text(lab.victory, X(366), Y(423), { size: 38, color: '#2a1c0c' });
        E.text(`${b.victory}${lab.within}`, X(558), Y(423), { size: 38, color: '#2a1c0c' });
        E.text(lab.greatVictory, X(366), Y(483), { size: 38, color: '#2a1c0c' });
        E.text(`${b.greatVictory}${lab.within}`, X(558), Y(483), { size: 38, color: '#2a1c0c' });
      }
    }
    const ok = this.okBtn; ok.w = 170; ok.h = 80; ok.x = (E.W - ok.w) / 2; ok.y = Y(596) - 40; const f = E.fx(ok);
    E.drawFrame(this.ui1.green_normal, ok.x, ok.y + f.dy, { scale: 1.26, filter: f.filter });
    E.drawFrame(this.ui1.buttontext_ok, ok.x, ok.y + f.dy, { scale: 1.26, filter: f.filter });
    if (E.keyboard) E.focusRing(ok);
  }
  // 2) round report, centred, bank bottom-left and confirm bottom-right of the clipboard
  drawRoundBoard(c) {
    const u = this.ui1, g = this.game, s = 1.36, tlx = (E.W - 386 * s) / 2, tly = (E.H - 564 * s) / 2, X = px => tlx + px * s, Y = py => tly + py * s;
    c.fillStyle = 'rgba(0,0,0,0.5)'; E.layout.canvas(c, 'scenes/battle/ui/opening.js:72').fillRect(0, 0, E.W, E.H);
    E.drawFrame(u.roundstart_board, tlx + 6 * s, tly + 24 * s, { scale: s });
    E.text(g.totalRounds ? `第 ${g.round}/${g.totalRounds} 回合` : `第 ${g.round} 回合`, X(176), Y(112), { size: 36, bold: true, font: E.CJK_SERIF, align: 'center', color: '#8a1408' });
    E.text(String(this.income.money), X(170), Y(235), { size: 42, bold: true, font: E.NUM, color: '#4a3418' });
    E.text(String(this.income.industry), X(170), Y(289), { size: 42, bold: true, font: E.NUM, color: '#4a3418' });
    E.text(String(E.state.medals), X(210), Y(392), { size: 36, bold: true, font: E.NUM, align: 'center', color: '#2a1608' });
    const bank = this.bankBtn, ok = this.okBtn, by = tly + 564 * s - 88;
    bank.w = ok.w = 128 * 1.0 * s * 0.95; bank.h = ok.h = 68; bank.x = X(28); ok.x = X(386 - 28) - ok.w; bank.y = ok.y = by;
    const fb = E.fx(bank), fo = E.fx(ok);
    E.drawFrame(u.blue_normal, bank.x, bank.y + fb.dy, { sx: bank.w / 135, sy: 68 / 72, filter: fb.filter, noRef: true });
    E.drawFrame(u.buttontext_bank, bank.x + bank.w / 2 - u.buttontext_bank.w * 0.5 * 0.9, bank.y + 12 + fb.dy, { scale: 0.9, filter: fb.filter, noRef: true });
    E.drawFrame(u.green_normal, ok.x, ok.y + fo.dy, { sx: ok.w / 135, sy: 68 / 72, filter: fo.filter, noRef: true });
    E.drawFrame(u.buttontext_ok, ok.x + ok.w / 2 - u.buttontext_ok.w * 0.5 * 0.95, ok.y + 10 + fo.dy, { scale: 0.95, filter: fo.filter, noRef: true });
    if (E.keyboard) E.focusRing(ok);
  }
  // 3) general dialogue: portrait on the right, text box along the bottom, click / Enter for the next line
  drawTalk(c) { const ln = this.lines[this.talkIdx]; if (ln) drawTalk(c, this.portraits[ln.who], ln.text); }
}
