import { E } from '../../../core/index.js';
import { HIGH_RISK_WIN_RATE_THRESHOLD } from '../../../game/ai/hq/commander/verb_profile.js';

const drawPopup = (c, img, q) => {
  const edge = 16, top = 68, bottom = 16, sx = [0, edge, img.width - edge], sy = [0, top, img.height - bottom];
  const sw = [edge, img.width - 2 * edge, edge], sh = [top, img.height - top - bottom, bottom];
  const dx = [q.x, q.x + edge, q.x + q.w - edge], dy = [q.y, q.y + top, q.y + q.h - bottom];
  const dw = [edge, q.w - 2 * edge, edge], dh = [top, q.h - top - bottom, bottom];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
    c.drawImage(img, sx[col], sy[row], sw[col], sh[row], dx[col], dy[row], dw[col], dh[row]);
};

export class OrderSettingsDialog {
  constructor(order, confirm, cancel, warning = '') {
    this.warning = warning;
    this.order = order;
    this.order.guard = this.order.guard || 'hold';
    this.confirm = confirm;
    this.cancel = cancel;
    this.pressed = null;
    this.hideHud = true;
    this.images = {};
    for (const [key, path] of Object.entries({ popup: 'order_settings_popup.png', button: 'order_settings_button.png', slider: 'order_settings_slider.png' }))
      E.image('assets/hoi4/ui/' + path).then(img => { this.images[key] = img; }).catch(() => {});
  }
  geom() { const w = Math.min(480, E.W - 24), h = Math.min(360, E.H - 24); return { x: (E.W - w) / 2, y: (E.H - h) / 2, w, h }; }
  boxes() {
    const q = this.geom(), s = Math.min(q.w / 480, q.h / 360);
    return {
      safe: { x: q.x + 35 * s, y: q.y + 85 * s, w: 120 * s, h: 32 * s },
      balanced: { x: q.x + 180 * s, y: q.y + 85 * s, w: 120 * s, h: 32 * s },
      bold: { x: q.x + 325 * s, y: q.y + 85 * s, w: 120 * s, h: 32 * s },
      slider: { x: q.x + 45 * s, y: q.y + 135 * s, w: 390 * s, h: 25 * s },
      minus: { x: q.x + 120 * s, y: q.y + 185 * s, w: 36 * s, h: 32 * s },
      plus: { x: q.x + 310 * s, y: q.y + 185 * s, w: 36 * s, h: 32 * s },
      guardHold: { x: q.x + 150 * s, y: q.y + 240 * s, w: 130 * s, h: 32 * s },
      guardRing: { x: q.x + 295 * s, y: q.y + 240 * s, w: 130 * s, h: 32 * s },
      cancel: { x: q.x + 85 * s, y: q.y + 295 * s, w: 120 * s, h: 38 * s },
      confirm: { x: q.x + 275 * s, y: q.y + 295 * s, w: 120 * s, h: 38 * s }
    };
  }
  hit(p) { return Object.entries(this.boxes()).find(([, r]) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.[0]; }
  setRisk(p) { const r = this.boxes().slider; this.order.risk = Math.max(0, Math.min(1, (p.x - r.x) / r.w)); }
  down(p) { this.pressed = this.hit(p); if (this.pressed === 'slider') this.setRisk(p); }
  move(p) { if (this.pressed === 'slider') this.setRisk(p); }
  up(p) {
    const key = this.hit(p);
    if (this.pressed === 'slider') { this.setRisk(p); this.pressed = null; return; }
    if (key !== this.pressed) return;
    this.pressed = null;
    if (key === 'safe') this.order.risk = .15;
    if (key === 'balanced') this.order.risk = .5;
    if (key === 'bold') this.order.risk = .85;
    if (key === 'minus') this.order.priority = Math.max(1, this.order.priority - 1);
    if (key === 'plus') this.order.priority = Math.min(9, this.order.priority + 1);
    if (key === 'guardHold') this.order.guard = 'hold';
    if (key === 'guardRing') this.order.guard = 'ring';
    if (key === 'cancel') this.cancel();
    if (key === 'confirm') this.confirm(this.order);
  }
  key(e) { if (e.key === 'Escape') this.cancel(); else if (e.key === 'Enter') this.confirm(this.order); }
  draw() {
    const q = this.geom(), c = E.ctx, b = this.boxes();
    c.save(); c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(0, 0, E.W, E.H);
    if (this.images.popup) drawPopup(c, this.images.popup, q);
    else { c.fillStyle = '#252a28'; c.fillRect(q.x, q.y, q.w, q.h); c.strokeStyle = '#777968'; c.strokeRect(q.x, q.y, q.w, q.h); }
    c.restore();
    const title = (this.order?.level === 'army' || this.level === 'army') ? '集团军命令设置' : '战区命令设置';
    E.text(title, q.x + q.w / 2, q.y + 35, { size: 24, align: 'center', bold: true, color: '#e4dfca' });
    if (this.warning) E.text(this.warning, q.x + q.w / 2, q.y + 60, { size: 13, align: 'center', color: '#d5a368' });
    E.text('风险策略', q.x + 35, q.y + 68, { size: 15, color: '#c6c7b5' });
    const names = {
      safe: '保守', balanced: '均衡', bold: '冒进', minus: '-', plus: '+',
      guardHold: '达成待命', guardRing: '环形警戒',
      cancel: '取消', confirm: '确认下令'
    };
    for (const [id, r] of Object.entries(b)) {
      if (id === 'slider') continue;
      const selected = (id === 'safe' && Math.abs(this.order.risk - .15) < 0.05) ||
        (id === 'balanced' && Math.abs(this.order.risk - .5) < 0.05) ||
        (id === 'bold' && Math.abs(this.order.risk - .85) < 0.05) ||
        (id === 'guardHold' && (!this.order.guard || this.order.guard === 'hold')) ||
        (id === 'guardRing' && this.order.guard === 'ring');

      if (this.images.button) c.drawImage(this.images.button, r.x, r.y, r.w, r.h);
      else E.panel(r.x, r.y, r.w, r.h, { fill: '#39443b', stroke: '#77806d', r: 2 });
      if (selected) { c.save(); c.strokeStyle = '#c4ab62'; c.lineWidth = 2; c.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); c.restore(); }
      E.text(names[id], r.x + r.w / 2, r.y + r.h / 2, { size: id.startsWith('guard') ? 12 : 15, align: 'center', base: 'middle', color: selected ? '#fff1be' : '#e1e2cf' });
    }
    const track = b.slider; c.save();
    if (this.images.slider) c.drawImage(this.images.slider, track.x, track.y, track.w, track.h);
    else { c.fillStyle = '#151917'; c.fillRect(track.x, track.y + 9, track.w, 7); }
    c.fillStyle = '#a99760'; c.fillRect(track.x + 5, track.y + 11, (track.w - 10) * this.order.risk, 3);
    c.fillStyle = '#d8d3bd'; c.strokeStyle = '#252822'; c.lineWidth = 2; c.beginPath(); c.arc(track.x + track.w * this.order.risk, track.y + 13, 8, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
    E.text(String(Math.round(this.order.risk * 100)) + '%', q.x + q.w / 2, q.y + 170, { size: 14, align: 'center', color: '#d3d1b9' });
    E.text('优先级 ' + this.order.priority, q.x + q.w / 2, q.y + 200, { size: 18, align: 'center', color: '#e1dfcb' });
    E.text('外围警戒模式', q.x + 45, q.y + 256, { size: 14, color: '#c6c7b5' });
  }
}

/**
 * 任务 D: 高风险强攻极低胜率预警对话框 (复用 HOI4 对话框组件)
 */
export class HighRiskWarningDialog {
  constructor({ order, winRate = 0.05, onProceed, onCancel, allout = false, unitCount = 0 }) {
    this.order = order;
    this.winRate = winRate;
    this.allout = allout;
    this.unitCount = unitCount;
    this.expires = null;
    this.onProceed = onProceed;
    this.onCancel = onCancel;
    this.pressed = null;
    this.hideHud = true;
    this.images = {};
    for (const [key, path] of Object.entries({ popup: 'order_settings_popup.png', button: 'order_settings_button.png' }))
      E.image('assets/hoi4/ui/' + path).then(img => { this.images[key] = img; }).catch(() => {});
  }
  geom() { const touch = this.allout && E.platform?.isTouch;
    const w = Math.min(touch ? 780 : 480, E.W - 24), h = Math.min(touch ? 480 : 300, E.H - 24);
    return { x: (E.W - w) / 2, y: (E.H - h) / 2, w, h }; }
  boxes() {
    const q = this.geom(), s = Math.min(q.w / 480, q.h / 300);
    const touch = this.allout && E.platform?.isTouch ? 44 * E.H / E.cv.clientHeight : 0;
    return {
      cancel: { x: q.x + 60 * s, y: q.y + 225 * s, w: 150 * s, h: Math.max(46 * s, touch) },
      proceed: { x: q.x + 270 * s, y: q.y + 225 * s, w: 150 * s, h: Math.max(46 * s, touch) },
      ...(this.allout ? { duration: { x: q.x + 120 * s, y: q.y + 150 * s, w: 240 * s, h: Math.max(46 * s, touch) } } : {})
    };
  }
  hit(p) { return Object.entries(this.boxes()).find(([, r]) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.[0]; }
  down(p) { this.pressed = this.hit(p); }
  move() {}
  up(p) {
    const key = this.hit(p);
    if (key !== this.pressed) return;
    this.pressed = null;
    if (key === 'duration') this.expires = this.expires == null ? 2 : this.expires === 2 ? 3 : null;
    if (key === 'proceed') this.onProceed(this.expires);
    if (key === 'cancel') this.onCancel();
  }
  key(e) {
    if (e.key === 'Escape') this.onCancel();
    else if (e.key === 'Enter') this.onProceed(this.expires);
  }
  draw() {
    const q = this.geom(), c = E.ctx, b = this.boxes();
    c.save(); c.fillStyle = 'rgba(0,0,0,.75)'; c.fillRect(0, 0, E.W, E.H);
    if (this.images.popup) drawPopup(c, this.images.popup, q);
    else { c.fillStyle = '#2b211d'; c.fillRect(q.x, q.y, q.w, q.h); c.strokeStyle = '#994433'; c.strokeRect(q.x, q.y, q.w, q.h); }
    c.restore();

    const scale = this.allout ? Math.min(q.w / 480, q.h / 300) : 1;
    E.text(this.allout ? '⚠ 全线总攻确认' : '⚠️ 高风险强攻警告', q.x + q.w / 2, q.y + 40 * scale, { size: 23 * scale, align: 'center', bold: true, color: '#e87d69' });
    if (this.allout) {
      E.text(`涉及 ${this.unitCount} 个单位`, q.x + q.w / 2, q.y + 88 * scale, { size: 18 * scale, align: 'center', bold: true, color: '#f2c8a7' });
      E.text('将不计损失全面进攻，直到移动力耗尽，可能造成重大伤亡', q.x + q.w / 2, q.y + 122 * scale, { size: 14 * scale, align: 'center', color: '#d0c8b8' });
      E.text(`持续：${this.expires ? `${this.expires}回合` : '仅当前回合'}（点击切换）`, q.x + q.w / 2, q.y + 175 * scale, { size: 15 * scale, align: 'center', color: '#e4dfca' });
    } else {
    const pct = Math.max(1, Math.round(this.winRate * 100));
    E.text(`预估突破胜率极低：约 ${pct}%`, q.x + q.w / 2, q.y + 88, { size: 17, align: 'center', bold: true, color: '#f2c8a7' });
    E.text('守军实力极为强大或地形险要，强行强攻预计将承受毁灭性战损。', q.x + q.w / 2, q.y + 122, { size: 14, align: 'center', color: '#d0c8b8' });
    E.text('是否确认强行执行该进攻指令？', q.x + q.w / 2, q.y + 152, { size: 14, align: 'center', color: '#e4dfca' });
    }

    const btnLabels = { proceed: '仍然执行', cancel: '取消指令' };
    for (const [id, r] of Object.entries(b)) {
      if (id === 'duration') continue;
      if (this.images.button) c.drawImage(this.images.button, r.x, r.y, r.w, r.h);
      else E.panel(r.x, r.y, r.w, r.h, { fill: id === 'proceed' ? '#5a2d24' : '#39443b', stroke: '#77806d', r: 3 });
      E.text(btnLabels[id], r.x + r.w / 2, r.y + r.h / 2, {
        size: 16 * scale, align: 'center', base: 'middle', bold: id === 'proceed',
        color: id === 'proceed' ? '#ffc8be' : '#e1e2cf'
      });
    }
  }
}
