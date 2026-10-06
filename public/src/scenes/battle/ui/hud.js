import { isSandbox } from '../../../game/sandbox_policy.js';
// In-battle HUD: resource board (top-left), pause (top-right), cards (bottom-left), end round (bottom-right).
// Buttons hug their screen corners (edge coordinates). The HUD only reports clicks through callbacks.
import { E } from '../../../core/index.js';
import { ResourceBar } from '../../../ui/resource_bar.js';
import { TileInfo } from './tile_info.js';
import { dockLayout, cornerLayout, drawDock, pt, displayRadius } from '../../../ui/corner_plate.js';
import { LEGEND_ITEMS, paintHex, relationCaption } from '../../../game/relation_color.js';

const SCALE = 1.3;

// Board + icon share one hotspot (board.ref * s from its top-left), exactly like the original sprite pair.
function boardButton(btn, board, icon, iconPress, tlx, tly, s, text = null, customDraw = null) {
  const hx = tlx + board.rx * s, hy = tly + board.ry * s, f = E.fx(btn, false);
  btn.x = tlx; btn.y = tly; btn.w = board.w * s; btn.h = board.h * s;
  // 触屏有安全区：贴边页签收在安全区内，外侧四角做成圆角，像一个独立的圆角按钮(而不是被切断的页签)
  const capped = capCorners(true) && !(board === null);
  if (capped) { const c = E.ctx; c.save(); c.beginPath(); c.roundRect(tlx, tly + f.dy, btn.w, btn.h, 22); c.clip(); }
  const out = E.layout.group(btn, 'battle/ui/hud.js/boardButton', () => {
  if (false && E.state.hudStyle === 'v2') {   // rejected by the user; kept only for reference
    drawCornerButton(E.ctx, btn, tlx, tly, btn.w, btn.h, f, iconId(icon, iconPress, text, btn.label));
    return;
  }
  E.drawFrame(board, hx, hy + f.dy, { scale: s, filter: f.filter });
  if (icon) {
    E.drawFrame(btn.pressed && iconPress ? iconPress : icon, hx, hy + f.dy, { scale: s, filter: f.filter });
  }
  if (customDraw) {
    customDraw(tlx + btn.w / 2, tly + btn.h / 2 + f.dy, f);
  }
  if (text) {
    E.text(text, tlx + btn.w / 2, tly + btn.h / 2 + f.dy + 3, {
      size: 21, bold: true, align: 'center', font: E.CJK_SERIF,
      color: '#fff5dc', stroke: '#3a2410', strokeW: 3.5
    });
  }
  });
  if (capped) E.ctx.restore();
  return out;
}
// 触屏：四角坞(ui/corner_plate.js 方案 D)——原按钮板和图标等比放大、贴死物理角、只裁掉屏幕圆角外的一块
function dockButton(btn, board, icon, iconPress, corner, drawIcon = null, mirror = false, arc = true) {
  const f = E.fx(btn, false);
  if (btn._dock) drawDock(board, corner, { layout: btn._dock, clip: !!E.platform?.isTouch, pressed: btn.pressed, filter: f.filter, icon, iconPress, drawIcon, mirror, arc });
}
// 触屏(有安全区)才收圆角；桌面不变
function capCorners() { const v = E.view; return !!v && (v.il > 0.5 || v.ir > 0.5 || v.it > 0.5 || v.ib > 0.5); }

function iconId(icon, iconPress, text, label) {
  if (label === '结束回合') return 'hourglass';
  if (label === '政务') return 'folder';
  if (label === '暂停') return 'pause';
  if (label === '取消卡片') return 'cancel';
  return 'card';
}

function drawCornerButton(c, btn, x, y, w, h, f, id) {
  const disabled = !btn.enabled, down = btn.pressed, hover = btn.hover;
  const dy = f.dy, inset = Math.max(3, h * 0.055), radius = Math.max(5, h * 0.12);
  c.save(); c.globalAlpha *= disabled ? 0.58 : 1;
  c.shadowColor = 'rgba(22,13,7,.42)'; c.shadowBlur = h * 0.12; c.shadowOffsetY = down ? 1 : h * 0.045;
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:46').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:46').roundRect(x + inset, y + inset + dy, w - inset * 2, h - inset * 2, radius);
  c.fillStyle = down ? '#92774d' : hover ? '#e7d5ad' : '#c9b389'; E.layout.canvas(c, 'scenes/battle/ui/hud.js:47').fill();
  c.shadowColor = 'transparent'; c.strokeStyle = '#49321c'; c.lineWidth = Math.max(2, h * 0.055); E.layout.canvas(c, 'scenes/battle/ui/hud.js:48').stroke();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:49').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:49').roundRect(x + inset * 2.2, y + inset * 2.2 + dy, w - inset * 4.4, h - inset * 4.4, radius * 0.72);
  c.strokeStyle = 'rgba(244,226,187,.68)'; c.lineWidth = Math.max(1, h * 0.022); E.layout.canvas(c, 'scenes/battle/ui/hud.js:50').stroke();
  const cx = x + w / 2, cy = y + h * 0.43 + dy, s = Math.min(w, h) * 0.25;
  drawHudGlyph(c, id, cx, cy, s);
  c.fillStyle = 'rgba(85,58,28,.32)';
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:54').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:54').roundRect(x + w * 0.16, y + h * 0.76 + dy, w * 0.68, Math.max(2, h * 0.035), 2); E.layout.canvas(c, 'scenes/battle/ui/hud.js:54').fill();
  c.restore();
}

function drawHudGlyph(c, id, x, y, s) {
  c.save(); c.strokeStyle = '#352416'; c.fillStyle = '#ead9b3'; c.lineWidth = Math.max(2.2, s * 0.18); c.lineCap = 'round'; c.lineJoin = 'round';
  if (id === 'pause') {
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:61').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:61').roundRect(x - s * 0.72, y - s, s * 0.44, s * 2, s * 0.12); E.layout.canvas(c, 'scenes/battle/ui/hud.js:61').roundRect(x + s * 0.28, y - s, s * 0.44, s * 2, s * 0.12); E.layout.canvas(c, 'scenes/battle/ui/hud.js:61').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:61').stroke();
  } else if (id === 'folder') {
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').moveTo(x - s * 1.25, y - s * 0.62); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').lineTo(x - s * 0.25, y - s * 0.62); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').lineTo(x + s * 0.05, y - s * 0.28); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').lineTo(x + s * 1.22, y - s * 0.28); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').lineTo(x + s * 1.05, y + s * 0.88); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').lineTo(x - s * 1.22, y + s * 0.88); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').closePath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:63').stroke();
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:64').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:64').moveTo(x - s * 0.72, y + s * 0.1); E.layout.canvas(c, 'scenes/battle/ui/hud.js:64').lineTo(x + s * 0.68, y + s * 0.1); E.layout.canvas(c, 'scenes/battle/ui/hud.js:64').stroke();
  } else if (id === 'hourglass') {
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').moveTo(x - s, y - s); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x + s, y - s); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x + s * 0.68, y - s * 0.25); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x - s * 0.68, y + s * 0.25); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x - s, y + s); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x + s, y + s); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x + s * 0.68, y + s * 0.25); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').lineTo(x - s * 0.68, y - s * 0.25); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').closePath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:66').stroke();
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').moveTo(x - s * 0.48, y - s * 0.35); E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').lineTo(x + s * 0.48, y - s * 0.35); E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').moveTo(x - s * 0.48, y + s * 0.35); E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').lineTo(x + s * 0.48, y + s * 0.35); E.layout.canvas(c, 'scenes/battle/ui/hud.js:67').stroke();
  } else if (id === 'cancel') {
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:69').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:69').roundRect(x - s * 0.82, y - s, s * 1.64, s * 2, s * 0.2); E.layout.canvas(c, 'scenes/battle/ui/hud.js:69').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:69').stroke();
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').moveTo(x - s * 0.43, y - s * 0.5); E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').lineTo(x + s * 0.43, y + s * 0.5); E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').moveTo(x + s * 0.43, y - s * 0.5); E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').lineTo(x - s * 0.43, y + s * 0.5); E.layout.canvas(c, 'scenes/battle/ui/hud.js:70').stroke();
  } else {
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:72').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:72').roundRect(x - s * 0.82, y - s, s * 1.64, s * 2, s * 0.2); E.layout.canvas(c, 'scenes/battle/ui/hud.js:72').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:72').stroke();
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').moveTo(x - s * 0.5, y - s * 0.48); E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').lineTo(x + s * 0.5, y - s * 0.48); E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').moveTo(x - s * 0.5, y - s * 0.1); E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').lineTo(x + s * 0.5, y - s * 0.1); E.layout.canvas(c, 'scenes/battle/ui/hud.js:73').stroke();
    E.layout.canvas(c, 'scenes/battle/ui/hud.js:74').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:74').arc(x + s * 0.43, y + s * 0.57, s * 0.45, 0, Math.PI * 2); c.fillStyle = '#a53b2e'; E.layout.canvas(c, 'scenes/battle/ui/hud.js:74').fill(); E.layout.canvas(c, 'scenes/battle/ui/hud.js:74').stroke();
  }
  c.restore();
}

function createZhengwuBoardFrame(blueFrame) {
  const w = 65, h = 66;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  const flip = document.createElement('canvas');
  flip.width = blueFrame.w; flip.height = blueFrame.h;
  const fctx = flip.getContext('2d');
  fctx.translate(flip.width, 0);
  fctx.scale(-1, 1);
  const src = blueFrame.cv || blueFrame.img;
  const sx = blueFrame.cv ? 0 : blueFrame.x;
  const sy = blueFrame.cv ? 0 : blueFrame.y;
  E.layout.canvas(fctx, 'scenes/battle/ui/hud.js:93').drawImage(src, sx, sy, blueFrame.w, blueFrame.h, 0, 0, blueFrame.w, blueFrame.h);

  // Top rounded corner (y: 0..25)
  E.layout.canvas(ctx, 'scenes/battle/ui/hud.js:96').drawImage(flip, 0, 0, w, 25, 0, 0, w, 25);
  // Middle straight slice (y: 25..35 stretched to height 16)
  E.layout.canvas(ctx, 'scenes/battle/ui/hud.js:98').drawImage(flip, 0, 25, w, 10, 0, 25, w, 16);
  // Bottom rounded corner (top flipped vertically)
  ctx.save();
  ctx.translate(0, 66);
  ctx.scale(1, -1);
  E.layout.canvas(ctx, 'scenes/battle/ui/hud.js:103').drawImage(flip, 0, 0, w, 25, 0, 0, w, 25);
  ctx.restore();

  return { cv, w, h, rx: 0, ry: 0, name: 'buttonboard_zhengwu' };
}

function drawZhengwuIcon(c, cx, cy, f) {
  c.save();
  if (f.filter && f.filter !== 'none') c.filter = f.filter;

  const fw = 34, fh = 26;
  const x = cx - fw / 2, y = cy - fh / 2 + 1;
  const tabW = 13, tabH = 5;

  c.fillStyle = '#efe3c2';
  c.strokeStyle = '#1e140c';
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.lineCap = 'round';

  // Folder contour with top tab
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:124').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:125').moveTo(x, y);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:126').lineTo(x, y - tabH);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:127').lineTo(x + tabW, y - tabH);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:128').lineTo(x + tabW + 4, y);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:129').lineTo(x + fw, y);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:130').lineTo(x + fw, y + fh);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:131').lineTo(x, y + fh);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:132').closePath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:133').fill();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:134').stroke();

  // Subtle interior paper lines
  c.strokeStyle = '#b8a688';
  c.lineWidth = 2;
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:139').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:140').moveTo(x + 6, y + 8);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:141').lineTo(x + fw - 6, y + 8);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:142').moveTo(x + 6, y + 14);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:143').lineTo(x + fw - 13, y + 14);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:144').stroke();

  // Red wax seal at bottom right
  const sealX = x + fw - 6, sealY = y + fh - 5, r = 5.5;
  c.fillStyle = '#a3322a';
  c.strokeStyle = '#1e140c';
  c.lineWidth = 2;
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:151').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:152').arc(sealX, sealY, r, 0, Math.PI * 2);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:153').fill();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:154').stroke();

  // Embossed center of wax seal
  c.fillStyle = '#c7483d';
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:158').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:159').arc(sealX - 0.5, sealY - 0.5, 2.2, 0, Math.PI * 2);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:160').fill();

  c.restore();
}

function drawRelationToken(c, cx, cy, r, hex) {
  c.save();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:167').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:168').ellipse(cx, cy + 1, r * 1.15, r * 0.72, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(40, 24, 10, 0.35)';
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:170').fill();
  const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
  g.addColorStop(0, hex);
  g.addColorStop(1, shadeHex(hex, 0.62));
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:174').beginPath();
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:175').ellipse(cx, cy, r * 1.15, r * 0.72, 0, 0, Math.PI * 2);
  c.fillStyle = g;
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:177').fill();
  c.strokeStyle = '#2a1a0c';
  c.lineWidth = Math.max(1.2, r * 0.18);
  E.layout.canvas(c, 'scenes/battle/ui/hud.js:180').stroke();
  c.restore();
}

function shadeHex(hex, k) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export class BattleHud {
  // actions: { pause, strategy, zhengwu, shop, cardCancel, endRound }
  constructor(ui1, army, game, actions) {
    E.detachFrames(ui1);
    this.ui1 = E.hudAtlas(ui1); this.game = game; this.army = army; this.bar = new ResourceBar(this.ui1);
    this.tileInfo = new TileInfo(game, ui1, army);
    this.legendOpen = true;
    const mk = (w, h, label, fn) => new E.Button({ w, h, edge: true, sfx: 'btn.wav', label, onClick: fn });
    this.pause = mk(92, 75, '暂停', actions.pause);
    this.save = mk(92, 75, '存档', actions.save);
    this.strategy = mk(92, 75, '政务', actions.zhengwu || actions.strategy);
    this.zhengwu = this.strategy;
    this.groups = mk(108, 46, '集团军', actions.groups);
    this.shop = mk(92, 75, '卡片', actions.shop);
    this.cardRemove = mk(92, 75, '取消卡片', actions.cardCancel);
    this.endRound = mk(86, 75, '结束回合', actions.endRound);
    this.cardMode = false;
    this.zhengwuBoard = null;
    // touch screens: the actions that used to be keys only (zoom, 2D / 3D, photo mode, accessories), as a column at the right edge
    this.actions = actions;
    this.touch = ['zoomIn', 'zoomOut', 'mode', 'photo', 'decorate'].map(id => Object.assign(mk(76, 76, id, actions[id]), { id }));
  }
  // The right-side touch column is gone: zoom is pinch, and 2D/3D, 摄影 and 摆件 all live in the pause menu / options, so the buttons were redundant.
  touchButtons() { return []; }
  setCardMode(active) { this.cardMode = active; this.disarm(); }
  get buttons() { if ((this.game.spectating || this.game.bridgeSpectating)) return [this.pause]; return [this.pause, this.strategy, this.cardMode ? this.cardRemove : this.shop, this.endRound]; }
  disarm() { [...this.buttons, ...this.touch].forEach(b => b.disarm()); }
  down(p) { return this.buttons.some(b => b.down(p)); }
  up(p) { let hit = false; this.buttons.forEach(b => { if (b.up(p)) hit = true; }); return hit; }

  // ---- 资源栏可拖动(触屏)：拖动调整位置，位置存本地；松手后/拖动中显示坐标；双击复位 ----
  barDefault() { return E.platform?.isTouch ? { x: 0, y: 0 } : { x: E.nudge || 0, y: E.nudge || 0 }; }   // 与 corner_plate.resourceBarPos 的默认值一致
  barPos() {
    if (this._barPos) return this._barPos;
    try { const s = JSON.parse(localStorage.getItem('wc2_resbar_pos_v1') || 'null'); if (s && isFinite(s.x) && isFinite(s.y)) return (this._barPos = { x: s.x, y: s.y }); } catch (e) {}
    return this.barDefault();
  }
  barRect() { const sz = this._barSize || { w: 268, h: 72 }, p = this.barPos(); return { x: p.x, y: p.y, w: sz.w, h: sz.h }; }
  barDown(p) {
    if (!E.platform?.isTouch || (this.game.spectating || this.game.bridgeSpectating)) return false;
    const r = this.barRect();
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return false;
    this._barDrag = { dx: p.x - r.x, dy: p.y - r.y, sx: p.x, sy: p.y, moved: false };
    return true;
  }
  barMove(p) {
    const d = this._barDrag; if (!d) return false;
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 8) d.moved = true;
    if (d.moved) {
      const sz = this._barSize || { w: 268, h: 72 };
      this._barPos = { x: Math.round(E.clamp(p.x - d.dx, -sz.w * 0.6, E.W - sz.w * 0.4)), y: Math.round(E.clamp(p.y - d.dy, -sz.h * 0.5, E.H - sz.h)) };
      this._barShow = performance.now() + 6000;
    }
    return true;
  }
  barUp() {
    const d = this._barDrag; if (!d) return false;
    this._barDrag = null;
    if (d.moved) { try { localStorage.setItem('wc2_resbar_pos_v1', JSON.stringify(this._barPos)); } catch (e) {} this._barShow = performance.now() + 6000; }
    else {   // 双击复位
      const now = performance.now();
      if (now - (this._barTap || 0) < 380) { this._barPos = null; try { localStorage.removeItem('wc2_resbar_pos_v1'); } catch (e) {} this._barShow = performance.now() + 2500; }
      this._barTap = now;
    }
    return true;
  }
  layoutButtons() {
    const u = this.ui1, W = E.W, H = E.H;
    if (!u) return;
    this.endRound.enabled = this.actions.canEndRound ? this.actions.canEndRound() : true;
    const NU = E.nudge || 0;   // 触屏圆角屏：四个角的元素往里让一点，贴着圆角而不是被切掉
    const pauseB = u.buttonboard_red;
    this.pause.x = W - pauseB.w * SCALE - NU;
    this.pause.y = NU;
    this.pause.w = pauseB.w * SCALE;
    this.pause.h = pauseB.h * SCALE;
    const saveB = u.buttonboard_save || pauseB;
    Object.assign(this.save, { x: this.pause.x - saveB.w * SCALE - 4, y: NU, w: saveB.w * SCALE, h: saveB.h * SCALE });
    this.save.enabled = typeof this.actions.save === 'function';
    if (this.zhengwuSource !== u.buttonboard_blue) {
      this.zhengwuSource = u.buttonboard_blue;
      this.zhengwuBoard = u.buttonboard_zhengwu || createZhengwuBoardFrame(u.buttonboard_blue);
    }
    if (this.zhengwuBoard) {
      this.strategy.x = W - this.zhengwuBoard.w * SCALE - NU;
      this.strategy.y = this.pause.y + this.pause.h + 4;
      this.strategy.w = this.zhengwuBoard.w * SCALE;
      this.strategy.h = this.zhengwuBoard.h * SCALE;
    }
    const shopB = this.cardMode ? u.buttonboard_blue : u.buttonboard_blue;
    Object.assign(this.groups, { x: W - 114 - NU, y: this.strategy.y + this.strategy.h + 10, w: 108, h: 46 });
    this.groups.enabled = typeof this.actions.groups === 'function';
    const shopBtn = this.cardMode ? this.cardRemove : this.shop;
    shopBtn.x = NU;
    shopBtn.y = H - shopB.h * SCALE - NU;
    shopBtn.w = shopB.w * SCALE;
    shopBtn.h = shopB.h * SCALE;
    const endB = u.buttonboard_green;
    this.endRound.x = W - endB.w * SCALE - NU;
    this.endRound.y = H - endB.h * SCALE - NU;
    this.endRound.w = endB.w * SCALE;
    this.endRound.h = endB.h * SCALE;
    for (const [button, board, corner] of [[shopBtn, shopB, 'bl'], [this.endRound, endB, 'br']]) {
      const L = cornerLayout(board, corner, SCALE); button._dock = L;
      Object.assign(button, { x: L.x0, y: L.y0, w: L.w, h: L.h });
    }
    if (E.platform?.isTouch) {
      // 触屏圆角屏：四角坞(原按钮板等比放大到 72pt、贴死物理角)；政务贴右边、在暂停正下方、灵动岛带之上(52pt 高，不贴角不裁)
      const lay = (b, board, corner, hPt, at) => { if (!board) return null; const L = dockLayout(board, corner, hPt, at); b._dock = L; Object.assign(b, { x: L.x0, y: L.y0, w: L.w, h: L.h }); return L; };
      const P = lay(this.pause, u.buttonboard_red, 'tr');
      if (this.zhengwuBoard && P) { const zb = this.zhengwuBoard, zk = pt(52) / zb.h; lay(this.strategy, zb, null, 52, { x: E.W - zb.w * zk, y: P.y0 + P.h + pt(8) }); }
      Object.assign(this.groups, { x: W - 114, y: this.strategy.y + this.strategy.h + 10, w: 108, h: 46 });
      lay(this.cardMode ? this.cardRemove : this.shop, u.buttonboard_blue, 'bl');
      lay(this.endRound, u.buttonboard_green, 'br');
    }
  }

  cornerRects() {
    this.layoutButtons();
    const pad = 6;
    const rects = [];
    const add = (b) => {
      if (!b) return;
      rects.push({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
    };
    add(this.pause);
    if ((this.game.spectating || this.game.bridgeSpectating)) return rects;
    add(this.strategy);
    add(this.cardMode ? this.cardRemove : this.shop);
    add(this.endRound);
    return rects;
  }

  legendScale() { return E.clamp(E.H / 900, 0.82, 1.05); }

  legendRect() {
    const s = this.legendScale();
    const shopH = (this.ui1?.buttonboard_blue?.h || 58) * SCALE;
    const pad = 8;
    if (this.legendOpen) {
      const w = Math.round(236 * s), h = Math.round(186 * s);
      return { x: pad, y: E.H - shopH - pad - h, w, h, s, open: true };
    }
    const w = Math.round(96 * s), h = Math.round(34 * s);
    return { x: pad, y: E.H - shopH - pad - h, w, h, s, open: false };
  }

  legendHit(p) {
    return false;   // legend removed
    if ((this.game.spectating || this.game.bridgeSpectating)) return false;
    const r = this.legendRect();
    return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  toggleLegend() {
    this.legendOpen = !this.legendOpen;
    E.playSfx('btn.wav');
  }

  drawHoverHint(areaId) {
    if (areaId == null || areaId < 0) return;
    const country = this.game.stage.st(areaId)?.country;
    if (!country) return;
    const caption = relationCaption(this.game, country);
    const color = paintHex(this.game.stage.unitColor(country));
    const c = E.ctx;
    c.save();
    c.font = `bold 15px ${E.CJK_SERIF}`;
    const tw = Math.ceil(c.measureText(caption).width);
    c.restore();
    const padX = 14, token = 8;
    const w = tw + padX * 2 + token * 2 + 6, h = 30;
    let x = E.pointer.x + 16, y = E.pointer.y + 18;
    if (x + w > E.W - 8) x = E.pointer.x - w - 12;
    if (y + h > E.H - 8) y = E.pointer.y - h - 12;
    x = E.clamp(x, 8, E.W - w - 8);
    y = E.clamp(y, 8, E.H - h - 8);
    E.drawParchment(x, y, w, h, { fill: '#e8d7ad', stroke: '#5a3a18', lineWidth: 2.5, r: 6, shadowBlur: 7 });
    drawRelationToken(c, x + padX + token, y + h / 2, token, color);
    E.text(caption, x + padX + token * 2 + 8, y + h / 2, {
      size: 15, bold: true, font: E.CJK_SERIF, align: 'left', color: '#2a1d12', base: 'middle'
    });
  }

  // deferTile=true：地块信息面板由调用方在战区指挥部之后再画(drawTileInfo)，保证它始终在最上层
  // 层级(从下到上)：战区指挥部 < 地块信息面板 < 顶部资源条；所以画完地块信息面板后把资源条再盖一遍
  drawTileInfo(selectedArea) {
    if (selectedArea < 0) return;
    this.tileInfo.draw(selectedArea);
    if (this._barArgs) { const capBar = capCorners(); if (capBar) { const sz = this._barSize || { w: 268, h: 72 }; E.ctx.save(); E.ctx.beginPath(); E.ctx.roundRect(0, 0, sz.w, sz.h, 22); E.ctx.clip(); } this.bar.draw(...this._barArgs); if (capBar) E.ctx.restore(); }
  }
  draw(c, selectedArea, deferTile = false) {
    const u = this.ui1, W = E.W, H = E.H, g = this.game;
    this.layoutButtons();
    if (selectedArea >= 0 && !deferTile) this.tileInfo.draw(selectedArea);
    const economy = (g.spectating || g.bridgeSpectating) && this.replayEconomy ? this.replayEconomy : g;
    const stability = (g.spectating || g.bridgeSpectating) && this.replayEconomy ? (economy.stability ?? 100) : g.getStability ? g.getStability(g.player) : (g.stability ?? 100);
    const touch = !!E.platform?.isTouch, NU = E.nudge || 0, resourceY = NU; // 资源条贴着屏幕左上角(触屏圆角屏往里让 NU)
    const bp = this.barPos(), sz0 = this._barSize || { w: 268, h: 72 };
    this._barArgs = [bp.x, bp.y, 268, economy.money, economy.industry, { stability: isSandbox(g)?undefined:stability }];
    const capBar = capCorners();
    if (capBar) { const sz = this._barSize || { w: 268, h: 72 }; E.ctx.save(); E.ctx.beginPath(); E.ctx.roundRect(0, 0, sz.w, sz.h, 22); E.ctx.clip(); }
    const barSize = this.bar.draw(...this._barArgs);
    if (capBar) E.ctx.restore();
    if (barSize?.w > 0 && barSize?.h > 0) this._barSize = barSize;
    if (touch && (this._barDrag?.moved || performance.now() < (this._barShow || 0))) {
      E.text(`资源栏  x=${Math.round(bp.x)}  y=${Math.round(bp.y)}  （拖动调整，双击复位）`, bp.x + 6, bp.y + sz0.h + 22, { size: 22, bold: true, color: '#fff7d6', stroke: '#000', strokeW: 5, align: 'left' });
    }
    if (touch) dockButton(this.pause, u.buttonboard_red, u.gamebutton_pause_normal, u.gamebutton_pause_press, 'tr', null, false, false);   // 不画圆弧补边(画了之后右上角像镜像过的页签)   // 不镜像(用户确认：镜像后是反的)
    else boardButton(this.pause, u.buttonboard_red, u.gamebutton_pause_normal, u.gamebutton_pause_press, W - u.buttonboard_red.w * SCALE - NU, NU, SCALE);
    if ((g.spectating || g.bridgeSpectating)) return;
    // user removed the extra save button (top right, beside pause) and the relation legend (bottom left)
    if (this.zhengwuSource !== u.buttonboard_blue) {
      this.zhengwuSource = u.buttonboard_blue;
      this.zhengwuBoard = u.buttonboard_zhengwu || createZhengwuBoardFrame(u.buttonboard_blue);
    }
    if (this.zhengwuBoard) {
      const zwX = W - this.zhengwuBoard.w * SCALE - NU;
      const zwY = this.pause.y + this.pause.h + 4;
      if (touch) dockButton(this.strategy, this.zhengwuBoard, null, null, null, (ax, ay, k, filter) => {   // 和桌面一样：文件夹图标画在按钮中心偏右 3
        const L = this.strategy._dock, cx = L.x0 + L.w / 2 + 3 * k / SCALE, cy = L.y0 + L.h / 2 + (this.strategy.pressed ? pt(1.5) : 0);
        if (u.hud_folder) E.drawFrameCentered(u.hud_folder, cx, cy, { scale: 1.05 * k / SCALE, filter }); else drawZhengwuIcon(c, cx, cy, { filter, dy: 0 });
      });
      else boardButton(this.strategy, this.zhengwuBoard, null, null, zwX, zwY, SCALE, null, (hx, hy, f) => {
        if (u.hud_folder) E.drawFrameCentered(u.hud_folder, hx + 3, hy, { scale: 1.05, filter: f.filter });
        else drawZhengwuIcon(c, hx + 3, hy, f);
      });
    }
    dockButton(this.cardMode ? this.cardRemove : this.shop, u.buttonboard_blue, this.cardMode ? u.gamebutton_cardremove_normal : u.gamebutton_card_normal, this.cardMode ? u.gamebutton_cardremove_press : u.gamebutton_card_press, 'bl');
    this.drawTouch(c, W, H);
    dockButton(this.endRound, u.buttonboard_green, u.gamebutton_round_normal, u.gamebutton_round_press, 'br');
  }
  drawLegend() {
    const r = this.legendRect(), s = r.s, c = E.ctx;
    const frame = this.ui1[r.open ? 'hud_legend' : 'hud_legend_closed'];
    if (frame) E.drawFrame(frame, r.x, r.y, { sx: r.w / frame.w, sy: r.h / frame.h, noRef: true });
    else E.drawParchment(r.x, r.y, r.w, r.h, { fill: '#dfcda3', stroke: '#493c27', r: 7 });
    E.text(r.open ? '外交图例  −' : '外交图例  +', r.x + 13 * s, r.y + 18 * s, {
      size: 15 * s, bold: true, color: '#493b24', align: 'left', base: 'middle'
    });
    if (!r.open) return;
    LEGEND_ITEMS.forEach((item, i) => {
      const cy = r.y + (49 + i * 27) * s;
      drawRelationToken(c, r.x + 22 * s, cy, 7 * s, paintHex(item.color));
      E.text(item.label, r.x + 40 * s, cy, { size: 14 * s, color: '#392d1c', align: 'left', base: 'middle' });
    });
  }
  drawTouch(c, W, H) {
    const list = this.touchButtons(), text = { zoomIn: '＋', zoomOut: '－', photo: '摄影', decorate: '摆件' };
    list.forEach((b, i) => {
      b.x = W - 100; b.y = H / 2 - 200 + i * 88;
      const f = E.fx(b), on = b.pressed;
      E.panel(b.x, b.y + f.dy, b.w, b.h, { fill: on ? 'rgba(80,110,60,.9)' : 'rgba(22,34,18,.72)', stroke: '#d8b66c' });
      const t = b.id === 'mode' ? '切 ' + this.actions.modeLabel() : text[b.id];
      E.text(t, b.x + b.w / 2, b.y + b.h / 2 + f.dy, { size: b.id === 'zoomIn' || b.id === 'zoomOut' ? 44 : 24, bold: true, color: '#f4ecd6', stroke: 'rgba(0,0,0,.6)', strokeW: 5, align: 'center' });
    });
  }
}

