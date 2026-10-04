// General dialogue box: portrait on the right, text panel along the bottom, click / Enter for the next line.
// drawTalk() is shared by the stage opening (opening.js) and by in-battle dialogues (TalkDialog).
import { E } from '../../../core/index.js';
import '../../../ui/ui.js';

export function drawTalk(c, img, text) {
  const W = E.W, H = E.H;
  if (img) { const k = 1.6, w = img.width * k, h = img.height * k; E.layout.canvas(c, 'scenes/battle/ui/talk.js:8').drawImage(img, W - w + 90, H - h + 60, w, h); }
  const w = Math.min(1124, W - 80), x = (W - w) / 2, y = H - 240;
  c.save(); c.fillStyle = 'rgba(8,8,8,0.84)'; c.strokeStyle = 'rgba(210,210,210,0.75)'; c.lineWidth = 4;
  E.layout.canvas(c, 'scenes/battle/ui/talk.js:11').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/talk.js:11').roundRect(x, y, w, 300, 22); E.layout.canvas(c, 'scenes/battle/ui/talk.js:11').fill(); E.layout.canvas(c, 'scenes/battle/ui/talk.js:11').stroke(); c.restore();
  E.wrap(text, w - 90, 37).forEach((t, i) => E.text(t, x + 45, y + 58 + i * 50, { size: 37, color: '#fff' }));
  if (Math.sin(E.time * 6) > 0) { c.save(); c.fillStyle = '#fff'; E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').moveTo(x + w - 62, H - 44); E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').lineTo(x + w - 34, H - 44); E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').lineTo(x + w - 48, H - 26); E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').closePath(); E.layout.canvas(c, 'scenes/battle/ui/talk.js:13').fill(); c.restore(); }
}

// Portrait file of a commander name from the scenario data ("de Gaulle" -> general_degaulle@2x.webp); resolves to null when there is none.
export const loadPortrait = who => E.image(`assets/general_${String(who).toLowerCase().replace(/ /g, '')}@2x.webp`).catch(() => null);

export function takeStageDialogue(game) {
  const entries = game.stage.data.extra?.dialogue || [];
  const lines = [];
  while (game.dialogueIndex < entries.length && +entries[game.dialogueIndex].atround <= game.round) {
    const entry = entries[game.dialogueIndex++];
    const key = `${game.info.faction} battle ${game.info.index} ${entry.commander} ${entry.index}`;
    lines.push({ who: entry.commander, text: entry.text || E.strings[key] || '' });
  }
  return lines;
}

// A dialogue shown as the battle scene's `dialog` (it swallows input until dismissed).
export class TalkDialog {
  // lines: [{ who, text }]; onClose called after the last one
  constructor(lines, portraits, onClose) { this.lines = lines; this.portraits = portraits; this.i = 0; this.onClose = onClose; }
  next() { E.playSfx('btn.wav'); if (++this.i >= this.lines.length) this.onClose(); }
  down() {}
  up() { this.next(); }
  key(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') this.next(); }
  draw() { const ln = this.lines[this.i]; if (ln) drawTalk(E.ctx, this.portraits[ln.who], ln.text); }
}
