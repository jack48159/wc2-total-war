// Drawing helpers for the Hearts of Iron IV style command HUD (theatre strips, order bar, pickers): gunmetal panels with a thin
// bevel, dark inset fields, square portraits, helmet army counters. Pure canvas, no atlas art: it is drawn from these primitives
// until generated assets replace them.
import { E } from '../../../core/index.js';
import { drawCommanderPortrait } from '../../commander.js';

export const PALETTE = { edge: '#0b0c0a', bevel: 'rgba(190,196,170,.28)', txt: '#e4dfca', khaki: '#b3aa86', gold: '#e8c45a', warn: '#e0301e', sel: '#ffd35a' };
export const THEATRE_COLORS = ['#a3342a', '#3f7a3a', '#3a5f9e', '#a37a26'];

const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
export const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function steel(c, x, y, w, h, o = {}) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#4b5047'); g.addColorStop(1, '#2c302a');
  c.fillStyle = g; rr(c, x, y, w, h, 3); c.fill(); c.shadowColor = 'transparent';
  c.strokeStyle = PALETTE.edge; c.lineWidth = 1; c.stroke();
  c.strokeStyle = PALETTE.bevel; c.beginPath(); c.moveTo(x + 2, y + 1.5); c.lineTo(x + w - 2, y + 1.5); c.stroke();
  if (o.ring) { c.strokeStyle = o.ring; c.lineWidth = 2; rr(c, x - 1, y - 1, w + 2, h + 2, 4); c.stroke(); }
  c.restore();
}
export function inset(c, x, y, w, h, o = {}) {
  c.save();
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, o.top || '#1f221d'); g.addColorStop(1, o.bottom || '#171915');
  c.fillStyle = g; rr(c, x, y, w, h, 2); c.fill();
  c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
  c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x + 1, y + 1, w - 2, 3);
  c.restore();
}
export function tile(c, x, y, w, h, o = {}) {
  c.save();
  const g = c.createLinearGradient(0, y, 0, y + h);
  const [a, b] = o.tone === 'go' ? ['#5f7440', '#3a4a24'] : o.tone === 'red' ? ['#7c352b', '#4d1f18'] : ['#5a6055', '#33372f'];
  g.addColorStop(0, a); g.addColorStop(1, b);
  c.fillStyle = g; rr(c, x, y, w, h, 3); c.fill();
  c.strokeStyle = PALETTE.edge; c.lineWidth = 1; c.stroke();
  c.strokeStyle = PALETTE.bevel; c.beginPath(); c.moveTo(x + 2, y + 1.5); c.lineTo(x + w - 2, y + 1.5); c.stroke();
  if (o.hover && !o.disabled) { c.fillStyle = 'rgba(255,255,255,.12)'; rr(c, x, y, w, h, 3); c.fill(); }
  if (o.on) { c.strokeStyle = PALETTE.gold; c.lineWidth = 2; rr(c, x + 1, y + 1, w - 2, h - 2, 3); c.stroke(); }
  if (o.disabled) { c.fillStyle = 'rgba(0,0,0,.42)'; rr(c, x, y, w, h, 3); c.fill(); }
  c.restore();
}
export function fit(str, maxW, size, bold = false) {
  const c = E.ctx; c.save(); c.font = `${bold ? 'bold ' : ''}${size}px ${E.FONT}`;
  let t = String(str);
  if (c.measureText(t).width <= maxW) { c.restore(); return t; }
  while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  c.restore(); return t + '…';
}
export function label(str, x, y, size, o = {}) {
  E.text(o.w ? fit(str, o.w, size, o.bold) : str, x, y, { size, bold: o.bold, color: o.color || PALETTE.txt, align: o.align, base: 'middle' });
}
// square portrait: real artwork when the commander has some, a striped empty slot otherwise
export function portrait(c, img, spec, x, y, w, h, o = {}) {
  c.save();
  if (spec) {
    drawCommanderPortrait(img, spec, x, y, w, h);
  } else {
    c.fillStyle = '#26281f'; c.fillRect(x, y, w, h);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.strokeStyle = '#33352f'; c.lineWidth = 4;
    for (let i = -h; i < w; i += 8) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); c.stroke(); }
    c.restore();
    if (o.empty) E.text(o.empty, x + w / 2, y + h / 2, { size: Math.round(w * .42), bold: true, align: 'center', base: 'middle', color: '#7d7b6c' });
  }
  c.strokeStyle = o.ring || PALETTE.edge; c.lineWidth = o.ring ? 2 : 1; c.strokeRect(x + .5, y + .5, w - 1, h - 1);
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  c.restore();
}
const DOME = new Path2D('M3 15C3 7 8 3 14 3s11 4 11 12z');
// the army-group counter: a helmet in the theatre's colour; `ghost` draws the empty slot outline
export function helmet(c, x, y, w, color, ghost = false) {
  const k = w / 28;
  c.save(); c.translate(x, y); c.scale(k, k);
  if (ghost) {
    c.strokeStyle = '#8b8a78'; c.lineWidth = 1.5; c.setLineDash([3, 2]); c.stroke(DOME);
    c.lineWidth = 1.2; rr(c, 1, 15, 26, 4, 1.5); c.stroke();
  } else {
    c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 2; c.shadowOffsetY = 1;
    c.fillStyle = color; c.fill(DOME); c.shadowColor = 'transparent';
    c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke(DOME);
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(7, 11); c.quadraticCurveTo(8, 5, 14, 5); c.stroke();
    c.fillStyle = color; rr(c, 1, 15, 26, 4, 1.5); c.fill(); c.fillStyle = 'rgba(0,0,0,.4)'; rr(c, 1, 15, 26, 4, 1.5); c.fill();
    c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
  }
  c.restore();
}
