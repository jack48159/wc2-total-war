import { E } from '../../../core/index.js';
import { World } from '../../../game/world.js';
import { ReplayCursor, replayState, installReplayState } from '../../../game/replay.js';
import { AiTurnRunner } from './ai_turn_runner.js';
import { getUnitName } from '../../../game/api/names.js';
import { playerAreaName } from '../../../game/describe.js';

// Reuse the existing paper broadcast, with no AI action buttons or camera steering.
class ReplayBanner extends AiTurnRunner {
  get active() { return true; }
  geom() {
    const bw = Math.min(520, E.W - 32);
    const bx = E.clamp((E.W - bw) / 2 + this.bannerOffset.x, 0, E.W - bw);
    const by = E.clamp((E.W < 1100 ? 100 : 8) + this.bannerOffset.y, 0, E.H - 56);
    return { bx, by, bw, bh: 56, speedBtn: { x: bx + bw }, skipBtn: {}, stopBtn: {} };
  }
  drawButton() {}
}
const STYLES = ['兵人', '国旗', '纯地块', '军旗'];
const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// Atlas slices use the regular sprite entry point so the layout editor sees them.
function nineSlice(frame, box, edge, group) {
  if (!frame) return;
  const sx = [0, edge, frame.w - edge, frame.w], sy = [0, edge, frame.h - edge, frame.h];
  const ex = Math.min(edge, box.w / 3), ey = Math.min(edge, box.h / 3);
  const dx = [box.x, box.x + ex, box.x + box.w - ex, box.x + box.w];
  const dy = [box.y, box.y + ey, box.y + box.h - ey, box.y + box.h];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const f = { ...frame, cv: null, img: frame.cv || frame.img,
      x: (frame.cv ? 0 : frame.x) + sx[col], y: (frame.cv ? 0 : frame.y) + sy[row],
      w: sx[col + 1] - sx[col], h: sy[row + 1] - sy[row], name: `${frame.name}:${row}:${col}` };
    E.drawFrame(f, dx[col], dy[row], { noRef: true, sx: (dx[col + 1] - dx[col]) / f.w,
      sy: (dy[row + 1] - dy[row]) / f.h, layoutGroup: `${group}:${row}:${col}` });
  }
}

import { Narrator } from '../../../game/narration.js';
import { bridgeUrlFor } from '../../../game/bridge_controller.js';

export class ReplayControls {
  constructor(battle) {
    if (battle.replayView) return battle.replayView;
    this.battle = battle;
    const g = battle.game;
    this.previousSelection = battle.sel;
    this.autoPlayWasEnabled = battle.autoPlayer.enabled;
    this.autoPlayStatus = battle.autoPlayer.statusText;
    this.aiWasRunning = battle.aiTurnRunner.running;
    g.replayRecorder.capture();
    this.final = replayState(g); this.diplomacy = g.diplomacy; this.fog = g.fogOfWar;
    this.cursor = new ReplayCursor(g.replay);
    this.first = g.replay.initial.round;
    this.last = g.replay.frames.at(-1)?.r || this.first;
    this.speed = 1; this.playing = true; this.elapsed = -2; this.style = 0;
    this.idle = 0; this.hudAlpha = 1; this.hudVisible = true; this.hoverBar = false; this.styleOpen = false;
    this.banner = new ReplayBanner(battle);
    // 战报旁白：取回这一局的战报(桥或静态文件)，取到后在开场/每个回合排队播放
    this.narrator = new Narrator(); this.narrStarted = false;
    this.narrator.load(g.gameId, bridgeUrlFor(battle.bridgeUrl || E.state.bridgeUrl)).catch(() => {});
    battle.autoPlayer.stop(); battle.aiTurnRunner.running = false;
    battle.opening = battle.dialog = null; battle.talks = []; battle.blink = 0;
    battle.pointerCancel(); battle.cancelCardMode(); battle.photo = false;
    g.spectating = true; g.fogOfWar = false;
    this.clearEffects(); this.install(); this.focusStart();
    // Direct construction is a complete entry path, including update/input routing.
    battle.replayView = this;
  }
  caption() { return `第 ${this.battle.game.round} 回合`; }
  announceFrame(frame) {
    const ev = frame.e?.find(e => ['unitMoved', 'unitAttacked', 'unitDeployed', 'areaCaptured'].includes(e.type));
    const unit = ev?.armyType ? getUnitName(ev.armyType) : '部队';
    let report = this.caption();
    if (ev?.type === 'unitMoved') report = `${unit} 从 ${playerAreaName(ev.from)} 移动至 ${playerAreaName(ev.to)}`;
    else if (ev?.type === 'unitAttacked') report = `${unit} 从 ${playerAreaName(ev.from)} 进攻 ${playerAreaName(ev.to)}`;
    else if (ev?.type === 'unitDeployed') report = `${unit} 部署于 ${playerAreaName(ev.area)}`;
    else if (ev?.type === 'areaCaptured') report = `占领 ${playerAreaName(ev.area)}`;
    this.banner.currentCountry = frame.c || null;
    this.banner.statusText = report;
    this.banner.statusStep = 0;
    this.banner.fade = 1;
  }
  focusStart() {
    const { game, cam } = this.battle;
    const initial = this.cursor.data.initial;
    const configuredId = initial.diplomacy?.capitals?.[game.player] ?? this.diplomacy?.capitals?.[game.player];
    const capitalIn = state => {
      const owned = state.areas.filter(a => a.country === game.player && !a.sea);
      return owned.find(a => a.id === configuredId)
        || owned.find(a => (a.areaType ?? World.areas[a.id]?.areaType) === 1);
    };
    const startingCapital = capitalIn(initial) || initial.areas.find(a => a.id === configuredId)
      || initial.areas.find(a => a.country === game.player && !a.sea);
    const alive = !this.final.countries.find(c => c.id === game.player)?.eliminated;
    const target = (alive && capitalIn(this.final)) || startingCapital;
    const point = World.areas[target?.id]?.pts?.[0];
    if (!point) return;
    cam.focus(...point);
    // focus() clamps to map/table margins and can move the capital off-centre.
    // This one-time scripted focus may cross that margin; manual drags keep normal limits.
    cam.x = point[0]; cam.y = point[1]; cam.bouncing = false;
  }

  clearEffects() {
    const b = this.battle;
    b.units.moving.clear(); b.units.deploying.clear(); b.units.frontSwitches.clear(); b.units.colorState.clear();
    b.effects.floats = []; b.effects.particles.active = []; b.effects.particles.list = [];
  }
  install() {
    const b = this.battle;
    installReplayState(b.game, this.cursor.state);
    const state = this.cursor.state;
    const player = state.countries.find(c => c.id === b.game.player);
    // Own immutable HUD values for this frame, including old recordings without top-level stability.
    b.hud.replayEconomy = { money: state.money ?? player?.money ?? 0,
      industry: state.industry ?? player?.industry ?? 0,
      stability: state.stability ?? player?.stability ?? 100 };
    b.map.invalidate(); b.inspectArea = null; b.sel = -1; b.map.setTargets(new Map());
    this.banner.statusText = this.caption(); this.banner.statusStep = 0;
  }
  seek(round) {
    this.narrator?.silence(); this.narrator?.shown.clear(); if (this.narrator) this.narrator.queue = [];
    this.cursor.seek(Math.max(this.first, Math.min(this.last, round)));
    if (this.narrator?.available && this.narrator.mode !== 2) this.narrator.enqueue(this.cursor.state.round);
    this.elapsed = -0.7; this.clearEffects(); this.install();
  }
  toggle() {
    if (!this.playing && this.cursor.index === this.cursor.data.frames.length) this.seek(this.first);
    this.playing = !this.playing; this.wake();
  }
  wake(p) {
    this.idle = 0; this.hudVisible = true;
    if (p) this.hoverBar = !E.pointer.touch && this.hit(p);
  }
  updateHud(dt) {
    const held = !this.playing || this.hoverBar || this.scrubbing || this.styleOpen || this.battle.dialog || E.pinching;
    this.idle = held ? 0 : this.idle + dt;
    this.hudVisible = held || this.idle < 2.5;
    this.hudAlpha = E.clamp(this.hudAlpha + (this.hudVisible ? dt / 0.15 : -dt / 0.3), 0, 1);
  }
  update(dt) {
    this.updateHud(dt);
    if (this.battle.dialog) return;
    const n = this.narrator;
    if (n?.available && !this.narrStarted) {   // 战报刚取到：开场白 + 当前回合
      this.narrStarted = true; n.enqueue('intro'); n.enqueue(this.cursor.state.round);
    }
    if (n?.available && this.playing && !this.scrubbing && n.tick()) return;   // 旁白还在读：回放停在原地
    if (!this.playing || this.scrubbing) return;
    this.elapsed += dt * this.speed;
    let budget = 32;
    while (this.elapsed >= 0.32 && budget-- > 0) {
      this.elapsed -= 0.32;
      const oldRound = this.cursor.state.round, frame = this.cursor.next();
      if (!frame) { this.playing = false; this.elapsed = 0; this.wake(); if (n?.available && n.mode !== 2) n.play('outro'); break; }
      const selected = this.battle.sel;
      this.install(); this.battle.sel = selected; this.announceFrame(frame);
      if (frame.r !== oldRound) { this.elapsed = -0.7; n?.enqueue(frame.r); }
      for (const ev of frame.e || []) this.battle.game.events.emit(ev);
    }
  }
  pointerDown(p) {
    const b = this.battle;
    this.wakeOnly = !this.hudVisible || this.hudAlpha < 0.05;
    this.wake(p);
    if (this.wakeOnly) return;
    if (b.dialog) { b.dialog.down(p); return; }
    if (this.banner.startBannerDrag(p)) return;
    if (this.down(p)) { this.controlPress = true; return; }
    b.hud.layoutButtons();
    if (b.sel >= 0 && b.hud.tileInfo.contains(p, b.sel)) return;
    this.pausePress = b.hud.pause.hit(p);
    this.drag = b.dragFrom(p);
  }
  pointerMove(p) {
    const b = this.battle;
    if (this.banner.moveBannerDrag(p)) return;
    this.wake(p);
    if (this.wakeOnly) return;
    if (b.dialog) { b.dialog.move?.(p); return; }
    if (this.controlPress) { this.move(p); return; }
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(p.x - d.x, p.y - d.y) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.rig) { const w = b.cam.toWorldWith(d.rig, p.x, p.y); b.cam.dragTo(d.cx - (w.x - d.w0.x), d.cy - (w.y - d.w0.y)); }
    else b.cam.dragTo(d.cx - (p.x - d.x) / b.cam.zoom, d.cy - (p.y - d.y) / b.cam.zoom);
  }
  pointerUp(p) {
    const b = this.battle;
    if (this.banner.endBannerDrag()) return;
    this.wake(p);
    if (this.wakeOnly) { this.wakeOnly = false; return; }
    if (b.dialog) { b.dialog.up(p); return; }
    if (this.controlPress) { this.up(p); this.controlPress = false; return; }
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.moved || Math.hypot(p.x - d.x, p.y - d.y) > 4) { b.cam.release(); return; }
    if (this.pausePress && b.hud.pause.hit(p)) this.pause();
    else b.clickWorld(p);
  }
  key(e) {
    this.wake();
    const b = this.battle, act = E.hotkeys.match(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      if (this.styleOpen) this.styleOpen = false;
      else if (b.dialog) b.dialog = null;
      else this.exit();
      return;
    }
    if (b.dialog) { b.dialog.key?.(e); return; }
    if (e.key === ' ') { if (!e.repeat) this.toggle(); }
    else if (e.key === 'ArrowLeft') this.seek(b.game.round - 1);
    else if (e.key === 'ArrowRight') this.seek(b.game.round + 1);
    else if (act === 'pause') { if (!e.repeat) this.pause(); }
    else if (act === 'zoomIn') b.zoomBy(1.15);
    else if (act === 'zoomOut') b.zoomBy(1 / 1.15);
    else return;
    e.preventDefault();
  }
  // Keep the familiar corner button; it now controls playback directly.
  pause() { this.toggle(); }
  cancel() {
    if (this.drag?.moved) this.battle.cam.release();
    this.drag = null; this.scrubbing = this.controlPress = this.wakeOnly = this.pausePress = false;
    this.pressed = null; this.hoverBar = false; this.wake();
  }
  exit() {
    const b = this.battle;
    this.narrator?.dispose(); this.cancel(); this.clearEffects(); installReplayState(b.game, this.final);
    b.game.diplomacy = this.diplomacy; b.game.fogOfWar = this.fog; b.game.spectating = false;
    b.hud.replayEconomy = null;
    b.units.replayStyle = 0; b.replayView = null; b.map.invalidate();
    if (b.game.phase === 'finished') b.showResult(b.game.result);
    else {
      b.autoPlayer.enabled = this.autoPlayWasEnabled;
      b.autoPlayer.statusText = this.autoPlayStatus;
      b.aiTurnRunner.running = this.aiWasRunning;
      b.aiTurnRunner.lastStepTime = performance.now();
      b.select(this.previousSelection);
    }
  }
  geom() {
    const w = Math.min(950, E.W - 32), k = Math.min(1, w / 520), x = (E.W - w) / 2, h = 110 * k, y = E.H - h - 14;
    const button = (dx, width) => ({ x: x + dx * k, y: y + 10 * k, w: width * k, h: 48 * k });
    const style = button(180, 132);
    return { x, y, w, h, k, start: x + 24 * k, end: x + w - 24 * k, trackY: y + 91 * k,
      buttons: { play: button(20, 80), speed: button(104, 72), style, ...(this.narrator?.available ? { narr: button(320, 72) } : {}), exit: { ...button(0, 112), x: x + w - 124 * k } },
      menu: { x: style.x, y: y - (STYLES.length * 50 + 8) * k, w: style.w, h: STYLES.length * 50 * k } };
  }
  hit(p) { return contains(this.geom(), p); }
  controlAt(p) {
    const r = this.geom();
    if (this.styleOpen && contains(r.menu, p)) return 'style:' + Math.min(STYLES.length - 1, Math.floor((p.y - r.menu.y) / (r.menu.h / STYLES.length)));
    return Object.keys(r.buttons).find(id => contains(r.buttons[id], p)) || null;
  }
  scrub(p) {
    const r = this.geom(), t = E.clamp((p.x - r.start) / (r.end - r.start), 0, 1);
    this.seek(Math.round(this.first + t * (this.last - this.first)));
  }
  down(p) {
    this.pressed = this.controlAt(p);
    if (this.pressed) return true;
    if (this.styleOpen) { this.styleOpen = false; return true; }
    if (!this.hit(p)) return false;
    const r = this.geom();
    if (p.y >= r.trackY - 13 * r.k) { this.scrubbing = true; this.scrub(p); }
    return true;
  }
  move(p) { if (this.scrubbing) this.scrub(p); }
  up(p) {
    if (this.scrubbing) { this.scrub(p); this.scrubbing = false; return; }
    const id = this.pressed; this.pressed = null;
    if (!id || this.controlAt(p) !== id) return;
    if (id === 'play') this.toggle();
    else if (id === 'speed') { this.speed = this.speed === 8 ? 1 : this.speed * 2; this.clearEffects(); }
    else if (id === 'style') this.styleOpen = !this.styleOpen;
    else if (id === 'narr') { this.narrator.cycleMode(); if (this.narrator.mode === 2) this.narrator.silence(); }
    else if (id === 'exit') this.exit();
    else if (id.startsWith('style:')) {
      this.style = Number(id.split(':')[1]); this.battle.units.replayStyle = this.style;
      this.styleOpen = false; this.clearEffects();
    }
  }
  // 战报字幕：屏幕下方偏上的电影字幕条，标题金色、正文白色，不随操作栏淡出
  drawNarration(c) {
    const v = this.narrator?.visible?.(); if (!v) return;
    const k = E.H / 900, W = Math.min(E.W - 80, (this.subtitleWidth || 980) * Math.max(1, k)), size = Math.round((this.subtitleSize || 26) * Math.max(1, k)), pad = size * 0.9;
    c.save(); c.font = `${size}px ${E.CJK_SERIF}`;
    const lines = []; let line = '';
    for (const ch of v.text) { const w = c.measureText(line + ch).width; if (w > W - pad * 2 && line) { lines.push(line); line = ch; } else line += ch; }
    if (line) lines.push(line);
    const lh = size * 1.55, th = v.title ? size * 1.5 : 0, h = pad * 2 + th + lines.length * lh, x = (E.W - W) / 2, y = this.subtitleBottom ? E.H - h - this.subtitleBottom : E.H - h - 150 * Math.max(1, k);   // subtitleBottom：录制动画时贴近画面下沿
    c.globalAlpha = 0.92 * v.alpha; c.fillStyle = 'rgba(14,10,6,.82)'; c.beginPath(); c.roundRect(x, y, W, h, 10); c.fill();
    c.strokeStyle = 'rgba(216,182,108,.75)'; c.lineWidth = 2; c.stroke();
    c.globalAlpha = v.alpha;
    if (v.title) E.text(v.title, E.W / 2, y + pad + size * 0.6, { size: Math.round(size * 1.05), bold: true, color: '#e8c872', font: E.CJK_SERIF, align: 'center', stroke: '#000', strokeW: 4 });
    lines.forEach((l, i) => E.text(l, x + pad, y + pad + th + lh * (i + 0.55), { size, color: '#f6ecd0', font: E.CJK_SERIF, align: 'left', stroke: '#000', strokeW: 3 }));
    c.restore();
  }
  draw(c) {
    this.drawNarration(c);
    if (this.hudAlpha <= 0) return;
    const r = this.geom();
    c.save(); c.globalAlpha *= this.hudAlpha;
    const atlas = this.battle.ui1;
    // A quiet parchment inset avoids stretching the atlas menu's orange header across the controls.
    E.drawParchment(r.x, r.y, r.w, r.h, { fill: '#dfcda6', stroke: '#493321',
      lineWidth: 3 * r.k, r: 12 * r.k, shadowBlur: 10 * r.k });
    const panel = E.layout.canvas(c, 'battle/replay/panel');
    c.strokeStyle = 'rgba(255,244,210,.7)'; c.lineWidth = r.k;
    panel.beginPath(); panel.roundRect(r.x + 5 * r.k, r.y + 5 * r.k,
      r.w - 10 * r.k, r.h - 10 * r.k, 8 * r.k); panel.stroke();
    const text = (s, x, y, align = 'left', color = '#3b2918') => E.text(s, x, y,
      { size: Math.max(18, 24 * r.k), color, font: E.CJK_SERIF, align });
    const labels = { play: this.playing ? '暂停' : '播放', speed: `${this.speed}x`, style: `${STYLES[this.style]} ▾`, narr: ['配音', '字幕', '静音'][this.narrator?.mode ?? 0], exit: '退出看海' };
    const button = (id, box, label) => {
      const frame = this.pressed === id ? (atlas.longgreen_press || atlas.longgreen_normal) : atlas.longgreen_normal;
      nineSlice(frame, box, 16, `replay-button-${id}`);
      text(label, box.x + box.w / 2, box.y + box.h / 2, 'center', '#fff5dc');
    };
    for (const [id, box] of Object.entries(r.buttons)) button(id, box, labels[id]);
    text(this.caption(), r.x + r.w / 2, r.y + 70 * r.k, 'center');
    const t = E.clamp((this.battle.game.round - this.first) / Math.max(1, this.last - this.first), 0, 1);
    const rail = E.layout.canvas(c, 'battle/replay/timeline');
    const trackW = r.end - r.start, trackH = 10 * r.k;
    const thumbX = r.start + trackW * t;
    // Dark recessed channel, green played segment and fine brass edging.
    c.save();
    c.shadowColor = 'rgba(53,32,15,.32)'; c.shadowBlur = 3 * r.k; c.shadowOffsetY = 2 * r.k;
    rail.beginPath(); rail.roundRect(r.start - 2 * r.k, r.trackY - trackH / 2 - 2 * r.k,
      trackW + 4 * r.k, trackH + 4 * r.k, 7 * r.k);
    c.fillStyle = '#9e8354'; rail.fill();
    c.shadowColor = 'transparent';
    const trough = c.createLinearGradient(0, r.trackY - trackH / 2, 0, r.trackY + trackH / 2);
    trough.addColorStop(0, '#30281d'); trough.addColorStop(1, '#63523a');
    rail.beginPath(); rail.roundRect(r.start, r.trackY - trackH / 2, trackW, trackH, 5 * r.k);
    c.fillStyle = trough; rail.fill();
    c.save(); rail.clip();
    const fill = c.createLinearGradient(0, r.trackY - trackH / 2, 0, r.trackY + trackH / 2);
    fill.addColorStop(0, '#91a35b'); fill.addColorStop(0.45, '#637f38'); fill.addColorStop(1, '#3d5724');
    c.fillStyle = fill; rail.fillRect(r.start, r.trackY - trackH / 2, trackW * t, trackH);
    c.restore();
    // Sparse round marks preserve readability on short and long replays alike.
    const intervals = Math.min(10, Math.max(1, this.last - this.first));
    c.strokeStyle = 'rgba(80,57,30,.5)'; c.lineWidth = r.k;
    rail.beginPath();
    for (let i = 0; i <= intervals; i++) {
      const px = r.start + trackW * i / intervals;
      rail.moveTo(px, r.trackY + 9 * r.k); rail.lineTo(px, r.trackY + 12 * r.k);
    }
    rail.stroke();
    const radius = (this.scrubbing ? 10 : 9) * r.k;
    const brass = c.createRadialGradient(thumbX - 3 * r.k, r.trackY - 4 * r.k, r.k,
      thumbX, r.trackY, radius);
    brass.addColorStop(0, '#fff0bf'); brass.addColorStop(0.5, '#ceb575'); brass.addColorStop(1, '#806039');
    c.shadowColor = 'rgba(38,25,12,.45)'; c.shadowBlur = 4 * r.k; c.shadowOffsetY = 2 * r.k;
    rail.beginPath(); rail.arc(thumbX, r.trackY, radius, 0, Math.PI * 2);
    c.fillStyle = brass; rail.fill(); c.strokeStyle = '#513a23'; c.lineWidth = 1.5 * r.k; rail.stroke();
    c.shadowColor = 'transparent'; c.strokeStyle = 'rgba(255,244,204,.8)'; c.lineWidth = r.k;
    rail.beginPath(); rail.arc(thumbX, r.trackY, radius - 3 * r.k, 0, Math.PI * 2); rail.stroke();
    c.restore();
    const endpoint = (value, px, align) => E.text(`\u7b2c ${value} \u56de\u5408`, px, r.y + 70 * r.k,
      { size: Math.max(12, 14 * r.k), font: E.CJK_SERIF, color: '#766044', align });
    if (r.w > 360) { endpoint(this.first, r.start, 'left'); endpoint(this.last, r.end, 'right'); }
    if (this.styleOpen) {
      const m = r.menu;
      STYLES.forEach((label, i) => {
        const box = { x: m.x, y: m.y + i * m.h / STYLES.length, w: m.w, h: m.h / STYLES.length };
        const hover = contains(box, E.pointer);
        E.text((i === this.style ? '✓ ' : '') + label, box.x + box.w / 2, box.y + box.h / 2,
          { size: Math.max(18, 23 * r.k), color: hover || i === this.style ? '#ffe4a0' : '#fff5dc',
            font: E.CJK_SERIF, align: 'center', stroke: 'rgba(25,17,9,.9)', strokeW: 4 });
      });
    }
    const area = this.battle.game.stage.st(this.battle.sel);
    if (area?.armies.length) {
      const names = { infantry: '步兵', eliteinfantry: '精锐步兵', panzer: '装甲车', tank: '坦克', heavytank: '重坦克', artillery: '火炮', rocket: '火箭炮', destroyer: '驱逐舰', cruiser: '巡洋舰', battleship: '战列舰', aircraftcarrier: '航母' };
      const lines = area.armies.map(a => `${names[a.type] || a.type} · ${a.hp}/${a.maxHp}`);
      c.save(); c.fillStyle = '#d8c4a0'; E.layout.canvas(c, 'battle/replay/unit-info').fillRect(268, 52, 245, 16 + lines.length * 25);
      lines.forEach((line, i) => E.text(line, 280, 72 + i * 25, { size: 20, color: '#3b2918', font: E.CJK_SERIF })); c.restore();
    }
    this.banner.draw(c);
    c.restore();
  }
}
