// The command HUD (Hearts of Iron IV style): theatre strips down the right edge under 政务, an order bar at the bottom, a selection bar for
// selected units, and army-group banners on the map. Rules live in game/army_groups.js commands (game.apply); this is presentation + input.
//   Shift+click or drag on the map -> select own units (armies) -> 新建集团军 / 加入集团军
//   drag a helmet marker onto a strip (or the 未编入战区 strip) -> assignArmyToTheater
//   click a name / marker -> focus (order bar appears); right-click -> the portrait menu (orders, commander, rename ...)
import { E } from '../../../core/index.js';
import { World } from '../../../game/world.js';
import { countryCommanders, armyRows, liveGroupUnits, commanderById, commanderData, commanderYearAvailable, ownsCommander, modLines, COMMANDER_ATLAS, GROUP_LIMIT } from '../../../game/army_groups.js';
import { groupForArmy } from '../../../game/army_groups.js';
import { getGroupColor } from '../render/unit_renderer.js';
import { autoOrganize } from '../../../game/ai/hq/staff/organize.js';
import { orderSummary, ORDER_VERBS, ORDER_STATUS } from './order_menu.js';
import { PickDialog } from './pick_dialog.js';
import { steel, inset, tile, portrait, helmet, label, fit, inside, PALETTE, THEATRE_COLORS } from './hoi.js';

const MAIN_VERBS = ['attack', 'defend', 'concentrate', 'withdraw'];
const VERB_ICON = { attack: '➜', defend: '⊣', concentrate: '◎', withdraw: '↩' };
const WORKBENCH_GLYPHS = { attack: '➜', breakthrough: '➔➔', envelop: '⊗', counterattack: '⇆', defend: '⊣', delay: '⏳', concentrate: '◎', screen: '≋', withdraw: '↩', support: '✦', allout: '⚔' };
const FREE = 'free';

const HOI4_UI_ASSETS = {
  attack: 'assets/hoi4/ui/attack_brush.png',
  defend: 'assets/hoi4/ui/defend_brush.png',
  breakthrough: 'assets/hoi4/ui/blitz_brush.png',
  withdraw: 'assets/hoi4/ui/fallback_brush.png',
  ongoing: 'assets/hoi4/ui/ongoing_order.png',
  theatre_bg: 'assets/hoi4/ui/theatre_bg.png'
};

import { platform } from '../../../platform/detect.js';
import { pt, plateSize } from '../../../ui/corner_plate.js';
import { MacroRecorder } from '../../../game/macro_recorder.js';

export class CommandUI {
  constructor(game, battle) {
    this.macro = new MacroRecorder(game);
    this.game = game; this.battle = battle; this.hits = []; this.strips = []; this.markers = []; this.banners = [];
    this.focus = null; this.sel = new Set(); this.selectedGroups = new Set(); this.folds = new Set(); this.press = null; this.drag = null; this.box = null; this.toastText = ''; this.toastUntil = 0; this.lastClick = null;
    this.stackDrag = null; this.stackTotalH = 220; this.stackPos = null;
    try { this.stackHidden = localStorage.getItem('wc2.hq.hidden') === 'true'; } catch { this.stackHidden = false; }
    try {
      const saved = localStorage.getItem(platform.isTouch ? 'wc2_theatre_stack_pos_touch' : 'wc2_theatre_stack_pos');   // 触屏单独存，不沿用电脑上拖出来的位置
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') this.stackPos = p;
      }
    } catch (e) { this.stackPos = null; }
    this.hoiUiImages = {};
    for (const [k, path] of Object.entries(HOI4_UI_ASSETS)) {
      E.image(path).then(img => { this.hoiUiImages[k] = img; }).catch(() => {});
    }
    E.image(COMMANDER_ATLAS).then(img => { this.portraits = img; }).catch(() => {});
  }
  // ---- state -------------------------------------------------------------------------------------------------------------------------
  get country() { return this.game.player; }
  // 触屏(手机)上屏幕物理尺寸小，整个指挥部/指令栏放大一档才点得到
  get s() { return E.clamp(E.H / 900, .8, 1.15) * (platform.isTouch ? 2.0 : 1); }
  theatres() { return this.game.theatres.filter(t => t.country === this.country); }
  groups() { return this.game.armyGroups.filter(g => g.country === this.country); }
  groupsOf(t) { return t.armyIds.map(id => this.game.armyGroups.find(g => g.id === id)).filter(Boolean); }
  theatreOf(g) { return this.theatres().find(t => t.armyIds.includes(g.id)); }
  colorOfTheatre(t) { return THEATRE_COLORS[Math.max(0, this.theatres().indexOf(t)) % THEATRE_COLORS.length]; }
  colorOfGroup(g) { const t = this.theatreOf(g); return t ? this.colorOfTheatre(t) : '#7d8279'; }
  unitCount(g) { return liveGroupUnits(this.game, g).length; }
  levelOf(kind) { return kind === 'theatre' ? 'theater' : 'army'; }
  entryFor(kind, id) { return this.battle.portraitMenu.orderFor(this.levelOf(kind), id); }
  targetObj() { const f = this.focus; if (!f) return null; return f.kind === 'group' ? this.groups().find(g => g.id === f.id) : this.theatres().find(t => t.id === f.id); }
  focusedAreaIds() {
    const targets = this.selectedGroups.size ? this.groups().filter(g => this.selectedGroups.has(g.id))
      : this.focus?.kind === 'group' ? this.groups().filter(g => g.id === this.focus.id)
      : this.focus?.kind === 'theatre' && this.targetObj() ? this.groupsOf(this.targetObj()) : [];
    return new Set(targets.flatMap(g => liveGroupUnits(this.game, g).map(r => r.area.id)));
  }
  orderTargets() {
    if (this.selectedGroups.size) return this.groups().filter(g => this.selectedGroups.has(g.id)).map(g => ({ level: 'army', id: g.id }));
    return this.focus ? [{ level: this.levelOf(this.focus.kind), id: this.focus.id }] : [];
  }
  commandTools() {
    return Object.entries(ORDER_VERBS).map(([verb, name], index) => ({ id: verb, key: verb, name, glyph: WORKBENCH_GLYPHS[verb], verb, shortcut: verb === 'allout' ? '0' : index < 9 ? String(index + 1) : null }));
  }
  setFocus(kind, id) {
    this.selectedGroups.clear();
    this.focus = kind ? { kind, id } : null;
    this.battle.selectedOrderTarget = kind ? { level: this.levelOf(kind), id } : null;
    if (kind) this.sel.clear();
  }
  say(text) { this.toastText = text; this.toastUntil = performance.now() + 2600; }
  cmd(type, extra = {}) {
    const r = this.game.apply({ type, country: this.country, ...extra });
    if (!r.ok) { this.say(r.reason || '无法执行'); E.playSfx('cancel.wav'); } else E.playSfx('select.wav');
    return r.ok;
  }
  // the panel exists only for the human player's own turn view: not while spectating, replaying, in photo mode or during dialogs
  visible() {
    const b = this.battle;
    return !!this.country && (!b.options.multiplayerRoom || this.game.activeCountry === this.country) && !(this.game.spectating || this.game.bridgeSpectating) && !b.replayView && !b.photo && !b.opening && !b.dialog && !b.aiTurnRunner?.running && this.game.phase !== 'finished';
  }
  interactive() { return this.visible() && !this.battle.orderDrawing; }
  occluders() {
    if (!this.visible()) return [];
    return this.strips.map(r => ({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }));
  }

  // ---- hit registration --------------------------------------------------------------------------------------------------------------
  hit(x, y, w, h, o) { this.hits.push({ x, y, w, h, ...o }); }
  hov(r) { return inside(E.pointer, r) && this.interactive(); }

  // ---- draw --------------------------------------------------------------------------------------------------------------------------
  draw(c) {
    this.hits = []; this.strips = []; this.markers = [];
    if (!this.visible()) return;
    const s = this.s, act = this.interactive();
    c.save(); if (!act) c.globalAlpha = .55;
    this.drawStack(c, s);
    c.restore();
    if (act) { this.drawOrderBar(c, s); this.drawSelBar(c, s); }
    if (!this.stackHidden && this.macroOpen && !this.macro.recording && this.macroAnchor) this.drawMacroList(c, s);
    this.drawDrag(c, s);
    this.drawToast(c, s);
  }
  // 播放按钮展开的录制列表：本关卡、当前国家的所有录制，点一行即重放它在当前回合的操作
  drawMacroList(c, s) {
    const { x, y, W } = this.macroAnchor, list = this.macro.list().slice(0, 8), rowH = 34 * s, titleH = 26 * s, h = titleH + list.length * rowH + 6 * s;
    c.save();
    c.fillStyle = 'rgba(24,27,21,.96)'; c.strokeStyle = '#8a7a45'; c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(x, y, W, h, 4 * s); c.fill(); c.stroke();
    label('选择要重放的录制', x + 10 * s, y + titleH / 2, 12 * s, { bold: true, color: PALETTE.khaki });
    const cl = { x: x + W - 26 * s, y: y + 3 * s, w: 20 * s, h: 20 * s };
    label('✕', cl.x + cl.w / 2, cl.y + cl.h / 2, 13 * s, { bold: true, align: 'center', color: this.hov(cl) ? '#fff' : PALETTE.khaki });
    this.hit(cl.x, cl.y, cl.w, cl.h, { act: 'macroClose' });
    list.forEach((rec, i) => {
      const ry = y + titleH + i * rowH, row = { x: x + 4 * s, y: ry, w: W - 8 * s, h: rowH - 3 * s }, hv = this.hov(row), steps = this.macro.stepsThisRound(rec), sm = this.macro.summary(rec);
      c.fillStyle = hv ? 'rgba(98,107,87,.95)' : 'rgba(52,59,50,.9)'; c.strokeStyle = hv ? PALETTE.gold : '#58604f';
      c.beginPath(); c.roundRect(row.x, row.y, row.w, row.h, 3 * s); c.fill(); c.stroke();
      label(rec.name, row.x + 8 * s, row.y + 11 * s, 13 * s, { bold: true, color: steps ? PALETTE.txt : '#8c8f84' });
      label(`共 ${sm.count} 步 · 第 ${sm.from}${sm.to !== sm.from ? '–' + sm.to : ''} 回合 · ` + (steps ? `本回合 ${steps} 步` : `第 ${this.game.round} 回合无操作`), row.x + 8 * s, row.y + 24 * s, 10 * s, { color: steps ? '#c9d2b8' : '#8c8f84' });
      const del = { x: row.x + row.w - 24 * s, y: row.y + 6 * s, w: 18 * s, h: 18 * s }, ren = { x: del.x - 24 * s, y: del.y, w: 18 * s, h: 18 * s };
      label('✎', ren.x + ren.w / 2, ren.y + ren.h / 2, 12 * s, { align: 'center', color: this.hov(ren) ? '#fff' : PALETTE.khaki });
      label('🗑', del.x + del.w / 2, del.y + del.h / 2, 12 * s, { align: 'center', color: this.hov(del) ? '#fff' : PALETTE.khaki });
      this.hit(row.x, row.y, row.w, row.h, { act: 'macroPick', id: rec.id });
      this.hit(ren.x, ren.y, ren.w, ren.h, { act: 'macroRen', id: rec.id });
      this.hit(del.x, del.y, del.w, del.h, { act: 'macroDel', id: rec.id });
    });
    this.strips.push({ x, y, w: W, h });
    c.restore();
  }
  drawStack(c, s) {
    const W = (this.stackHidden ? 66 : 270) * s;
    if (!this.stackPos) {
      // 触屏：放在右上角页签(暂停/政务)下面，不盖住它们
      this.stackPos = { x: E.W - W - 10 * s, y: platform.isTouch ? 330 : 75 * s };
    }
    // 触屏：左右各留出屏幕圆角/灵动岛的一段，右边还要避开角落按钮那一列，上下避开角落按钮
    // 用户要求可以拖到屏幕最左/最右：只要求标题栏留在屏幕内
    const minX = 0, maxX = Math.max(0, E.W - W);
    const minY = 0, maxY = Math.max(0, E.H - (this.stackTotalH || 60 * s));
    this.stackPos.x = E.clamp(this.stackPos.x, minX, maxX);
    this.stackPos.y = E.clamp(this.stackPos.y, minY, maxY);
    const x = this.stackPos.x;
    let y = this.stackPos.y;
    if (this.stackHidden) {
      const r = { x, y, w: W, h: 32 * s };
      c.save(); c.fillStyle = this.hov(r) ? '#626b57' : '#343b32'; c.strokeStyle = '#aaa079';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 4 * s); c.fill(); c.stroke(); c.restore();
      label('指挥部', x + W / 2, y + r.h / 2, 12 * s, { bold: true, align: 'center', color: PALETTE.txt });
      this.hit(r.x, r.y, r.w, r.h, { act: 'toggleStack', dragStack: true, tip: '点击展开指挥部，按住可拖动' });
      this.strips.push(r); this.stackTotalH = r.h; return;
    }

    // 绘制金属拖拽把手栏 (Drag Header)
    const headerH = 24 * s, hr = { x, y, w: W, h: headerH }, hovH = this.hov(hr);
    c.save();
    const hg = c.createLinearGradient(0, y, 0, y + headerH);
    hg.addColorStop(0, hovH ? '#5d6356' : '#41473d');
    hg.addColorStop(1, hovH ? '#383e34' : '#272b24');
    c.fillStyle = hg;
    c.beginPath(); c.roundRect(x, y, W, headerH, [3, 3, 0, 0]); c.fill();
    c.strokeStyle = '#0b0c0a'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(x + 2, y + 1.5); c.lineTo(x + W - 2, y + 1.5); c.stroke();
    // 录制 / 重放按钮(左侧)：录制中红点闪烁并显示已录条数
    const macro = this.macro, recording = macro.recording, playing = macro.playing, n = macro.count(), listOpen = this.macroOpen && !recording;
    const rec = { x: x + 6 * s, y: y + 2 * s, w: 22 * s, h: 20 * s }, play = { x: x + 32 * s, y: y + 2 * s, w: 22 * s, h: 20 * s };
    for (const [r, kind] of [[rec, 'rec'], [play, 'play']]) {
      const hv = this.hov(r), on = kind === 'rec' ? recording : (playing || listOpen);
      c.fillStyle = on ? '#6b2b24' : hv ? '#626b57' : '#343b32'; c.strokeStyle = hv || on ? PALETTE.gold : '#737b68';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 3 * s); c.fill(); c.stroke();
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (kind === 'rec') {
        const pulse = recording ? .55 + .45 * Math.sin(performance.now() / 220) : 1;
        c.fillStyle = recording ? `rgba(255,70,55,${pulse})` : '#c9503f'; c.beginPath(); c.arc(cx, cy, 5 * s, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = playing ? '#ffd27a' : PALETTE.khaki; c.beginPath();
        if (playing) { c.rect(cx - 4.5 * s, cy - 4.5 * s, 3.2 * s, 9 * s); c.rect(cx + 1.3 * s, cy - 4.5 * s, 3.2 * s, 9 * s); }
        else { c.moveTo(cx - 3.5 * s, cy - 5 * s); c.lineTo(cx + 5 * s, cy); c.lineTo(cx - 3.5 * s, cy + 5 * s); c.closePath(); }
        c.fill();
      }
    }
    if (recording) label(String(n), rec.x + rec.w / 2, y + headerH + 8 * s, 10 * s, { bold: true, align: 'center', color: '#ff8d7e' });
    label('战区指挥部', x + W / 2, y + headerH / 2, 12 * s, { bold: true, align: 'center', color: PALETTE.txt });
    label('−', x + W - 16 * s, y + headerH / 2, 18 * s, { color: PALETTE.khaki, align: 'center' });
    const auto = { x: x + W - 58 * s, y: y + 2 * s, w: 22 * s, h: 20 * s };
    const autoHover = this.hov(auto);
    c.fillStyle = autoHover ? '#626b57' : '#343b32';
    c.strokeStyle = autoHover ? PALETTE.gold : '#737b68';
    c.beginPath(); c.roundRect(auto.x, auto.y, auto.w, auto.h, 3 * s); c.fill(); c.stroke();
    c.fillStyle = PALETTE.khaki;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) c.fillRect(auto.x + (6 + col * 7) * s, auto.y + (5 + row * 7) * s, 4 * s, 4 * s);
    }
    c.restore();
    this.hit(hr.x, hr.y, hr.w, hr.h, { act: 'dragStack', dragStack: true, tip: '按住拖动战区指挥部' });
    this.hit(x + W - 30 * s, y, 30 * s, headerH, { act: 'toggleStack', tip: '隐藏战区指挥部' });
    const recTip = recording ? `录制中(已录 ${n} 步)：点击结束，并为这条录制命名保存` : '录制：之后你的每一步操作(移动/攻击/出牌/编组…)都会被记下，可命名保存，以后一键重放';
    const playTip = playing ? '重放中：点击停止' : n ? `重放：从本关卡的 ${n} 条录制里选一条，自动重做它「第 ${this.game.round} 回合」的操作` : '重放：本关卡还没有录制';
    this.macroAnchor = { x, y: y + headerH + 2 * s, W };
    this.hit(rec.x, rec.y, rec.w, rec.h, { act: 'macroRec', tip: recTip });
    this.hit(play.x, play.y, play.w, play.h, { act: 'macroPlay', tip: playTip });
    if (this.hov(rec)) this.tip = { text: recTip, x: E.pointer.x, y: E.pointer.y };
    if (this.hov(play)) this.tip = { text: playTip, x: E.pointer.x, y: E.pointer.y };
    this.hit(auto.x, auto.y, auto.w, auto.h, { act: 'autoOrganize', tip: '自动编组：将未编组部队编入集团军和战区' });
    if (autoHover) this.tip = { text: '自动编组：将未编组部队编入集团军和战区', x: E.pointer.x, y: E.pointer.y };
    this.strips.push({ x: hr.x, y: hr.y, w: hr.w, h: hr.h, isHeader: true });
    y += headerH + 4 * s;

    const theatres = this.theatres(), maxT = commanderData()?.maxTheatres || 4;
    for (const t of theatres) y += this.drawStrip(c, s, t, x, y, W) + 8 * s;
    if (theatres.length < maxT) {
      const r = { x, y, w: W, h: 26 * s }, hv = this.hov(r);
      c.save(); c.fillStyle = hv ? 'rgba(60,66,54,.88)' : 'rgba(20,22,18,.78)'; c.strokeStyle = '#5b6052'; c.setLineDash([4, 3]); c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 3); c.fill(); c.stroke(); c.restore();
      label('＋ 新建战区', x + W / 2, y + 13 * s, 13 * s, { bold: true, align: 'center', color: PALETTE.khaki });
      this.hit(r.x, r.y, r.w, r.h, { act: 'addTheatre' });
      y += 34 * s;
    }
    const free = this.groups().filter(g => !this.theatreOf(g));
    if (free.length) this.drawStrip(c, s, null, x, y, W, free);

    this.stackTotalH = Math.max(80 * s, y - this.stackPos.y);
  }
  drawStrip(c, s, t, x, y, W, freeGroups = null) {
    const fold = t && this.folds.has(t.id), gs = t ? this.groupsOf(t) : freeGroups, headH = 46 * s, rowH = 62 * s;
    const H = fold ? headH + 4 * s : headH + rowH + 4 * s, focus = t && this.focus?.kind === 'theatre' && this.focus.id === t.id;
    const over = this.drag?.moved && inside(E.pointer, { x, y, w: W, h: H });
    let ring = focus ? PALETTE.gold : null;
    if (over) ring = this.dropOK(t) ? PALETTE.sel : PALETTE.warn;
    steel(c, x, y, W, H, { ring });
    if (this.hoiUiImages.theatre_bg && this.hoiUiImages.theatre_bg.complete) {
      c.save(); c.beginPath(); c.roundRect(x, y, W, H, 3); c.clip();
      c.globalAlpha = 0.22;
      c.drawImage(this.hoiUiImages.theatre_bg, x, y, W, H);
      c.restore();
    }
    this.strips.push({ x, y, w: W, h: H, theatre: t });
    const marshal = t?.marshalId ? commanderById(this.country, t.marshalId) : null;
    // head: marshal portrait, name field, fold
    const px = x + 5 * s, py = y + 5 * s, ps = 36 * s;
    portrait(c, this.portraits, marshal, px, py, ps, ps, { empty: t ? '帅' : '' });
    if (t) this.hit(px, py, ps, ps, { act: 'marshal', id: t.id, right: ['theater', t.id], tip: marshal ? `元帅 ${marshal.name}` : '点击任命元帅' });
    const btn = 26 * s, nameX = px + ps + 5 * s, nameW = W - (nameX - x) - (t ? btn + 9 * s : 8 * s);
    inset(c, nameX, y + 8 * s, nameW, 30 * s);
    label(t ? t.name : '未编入战区', nameX + 6 * s, y + 23 * s, 14 * s, { bold: !!t, w: nameW - 10 * s, color: t ? PALETTE.txt : PALETTE.khaki });
    if (t) {
      this.hit(nameX, y + 8 * s, nameW, 30 * s, { act: 'selTheatre', id: t.id, right: ['theater', t.id], dragStack: true });
      const bx = nameX + nameW + 4 * s, by = y + 8 * s, foldR = { x: bx, y: by, w: btn, h: btn };
      tile(c, foldR.x, foldR.y, btn, btn, { hover: this.hov(foldR) });
      label(fold ? '⇲' : '⇆', foldR.x + btn / 2, foldR.y + btn / 2, 14 * s, { align: 'center' });
      this.hit(foldR.x, foldR.y, btn, btn, { act: 'fold', id: t.id });
    }
    if (fold) return H;
    // marker row: one helmet per army group, ghost helmets for the free command slots, the theatre's unit total on the right
    const ry = y + headH, rx = x + 5 * s, rw = W - 10 * s;
    inset(c, rx, ry, rw, rowH - 2 * s);
    const mw = 38 * s, col = t ? this.colorOfTheatre(t) : '#7d8279';
    const visibleMarkers = Math.max(1, Math.floor((rw - 52 * s) / mw));
    gs.slice(0, visibleMarkers).forEach((g, i) => this.drawMarker(c, s, g, rx + 4 * s + i * mw, ry + 4 * s, mw, col));
    if (gs.length > visibleMarkers) label('+' + (gs.length - visibleMarkers), rx + rw - 36 * s, ry + 22 * s, 13 * s, { bold: true, align: 'center' });
    if (t && !gs.length) label('拖入集团军', rx + 6 * s, ry + rowH / 2 + 2 * s, 12 * s, { color: '#7f7b69' });
    const total = gs.reduce((n, g) => n + this.unitCount(g), 0);
    label(String(total), rx + rw - 6 * s, ry + rowH - 16 * s, 16 * s, { bold: true, align: 'right' });
    return H;
  }
  issues(g) {
    const r = [], t = this.theatreOf(g);
    if (!g.commanderId) r.push('没有指挥官');
    const own = this.entryFor('group', g.id), th = t && this.entryFor('theatre', t.id);
    if (!own && !th) r.push('没有命令');
    return { list: r, pending: !!(own || th) };
  }
  drawMarker(c, s, g, x, y, w, color) {
    const multi = this.selectedGroups.has(g.id), foc = this.focus?.kind === 'group' && this.focus.id === g.id, r = { x, y, w, h: 54 * s }, dragging = this.drag?.moved && this.drag.id === g.id;
    this.markers.push({ ...r, id: g.id });
    if (foc || multi || this.hov(r)) { c.save(); c.fillStyle = multi ? 'rgba(116,211,195,.24)' : foc ? 'rgba(232,196,90,.18)' : 'rgba(255,255,255,.07)'; c.fillRect(x, y, w, r.h); if (foc || multi) { c.strokeStyle = multi ? PALETTE.sel : PALETTE.gold; c.lineWidth = multi ? 2 : 1; c.strokeRect(x + .5, y + .5, w - 1, r.h - 1); } c.restore(); }
    if (this.drag?.moved && this.drag.id !== g.id && this.hov(r) && this.canMerge(this.drag.id, g.id)) {
      c.save(); c.strokeStyle = PALETTE.sel; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, r.h - 2); c.restore();
    }
    c.save(); if (dragging) c.globalAlpha = .35;
    const spec = commanderById(this.country, g.commanderId);
    portrait(c, this.portraits, spec, x + 3 * s, y + 3 * s, 32 * s, 34 * s, { empty: '?' });
    const { list, pending } = this.issues(g);
    label(String(this.unitCount(g)), x + w / 2, y + 40 * s, 15 * s, { bold: true, align: 'center' });
    if (list.length) { c.fillStyle = PALETTE.warn; c.fillRect(x + w - 10 * s, y + 1 * s, 7 * s, 18 * s); c.strokeStyle = '#3a0a05'; c.strokeRect(x + w - 10 * s + .5, y + 1 * s + .5, 7 * s - 1, 18 * s - 1); label('!', x + w - 6.5 * s, y + 10 * s, 11 * s, { bold: true, align: 'center', color: '#fff' }); }
    else if (pending) label('➜', x + w - 7 * s, y + 6 * s, 12 * s, { bold: true, align: 'center', color: PALETTE.gold });
    c.restore();
    this.hit(x, y, w, r.h, { act: 'marker', id: g.id, drag: g.id, right: ['army', g.id], tip: `${g.name}（${spec?.name || '无指挥官'}）· ${this.unitCount(g)} 单位${list.length ? ' · ' + list.join('、') : ''}` });
    if (this.hov(r)) this.tip = { text: `${g.name}（${spec?.name || '无指挥官'}）· ${this.unitCount(g)} 单位${list.length ? ' · ' + list.join('、') : ''}`, x: E.pointer.x, y: E.pointer.y };
  }
  dropOK(t) {
    const g = this.drag && this.game.armyGroups.find(v => v.id === this.drag.id); if (!g) return false;
    if (!t) return !!this.theatreOf(g);
    return true;
  }
  canMerge(sourceId, targetId) {
    const source = this.groups().find(g => g.id === sourceId), target = this.groups().find(g => g.id === targetId);
    return !!source && !!target && source.id !== target.id && this.unitCount(source) > 0
      && this.unitCount(source) + this.unitCount(target) <= (commanderData()?.groupLimit || GROUP_LIMIT);
  }
  drawDrag(c, s) {
    if (this.tip && !this.drag) { const t = this.tip; this.tip = null; const w = Math.min(320 * s, t.text.length * 13 * s + 20 * s), x = Math.min(t.x, E.W - w - 8), y = t.y + 22 * s; steel(c, x, y, w, 24 * s); label(t.text, x + 8 * s, y + 12 * s, 12 * s, { w: w - 14 * s }); }
    this.tip = null;
    if (!this.drag?.moved) return;
    const g = this.game.armyGroups.find(v => v.id === this.drag.id); if (!g) return;
    helmet(c, E.pointer.x - 18 * s, E.pointer.y - 22 * s, 36 * s, this.colorOfGroup(g));
    label(String(this.unitCount(g)), E.pointer.x, E.pointer.y + 14 * s, 16 * s, { bold: true, align: 'center' });
  }
  drawToast(c, s) {
    if (performance.now() > this.toastUntil || !this.toastText) return;
    const w = Math.min(E.W - 40, this.toastText.length * 15 * s + 30 * s), x = (E.W - w) / 2, y = E.H - 132 * s;
    steel(c, x, y, w, 30 * s); label(this.toastText, E.W / 2, y + 15 * s, 14 * s, { align: 'center', w: w - 16 * s });
  }

  // ---- bottom order bar (HOI4 Battle Planner Toolbar) -----------------------------------------------------------------
  drawOrderBar(c, s) {
    const o = this.targetObj(); if (!o || this.sel.size) return;
    const isT = this.focus.kind === 'theatre', kind = this.focus.kind, active = this.game.activeCountry === this.country && this.game.phase === 'playing';
    const gs = isT ? this.groupsOf(o) : [o], n = gs.reduce((k, g) => k + this.unitCount(g), 0);
    const leader = commanderById(this.country, isT ? o.marshalId : o.commanderId), entry = this.entryFor(kind, o.id);
    const th = !isT ? this.theatreOf(o) : null;
    const sub = isT ? `${leader ? '元帅 ' + leader.name : '未任命元帅'} · ${gs.length} 集团军 · ${n} 单位`
      : `${leader ? leader.name + ' · ' + leader.tactic : '未任命指挥官'} · ${n} 单位${th ? ' · ' + th.name : ''}`;
    let plan = '无命令';
    if (entry) {
      const statusText = ORDER_STATUS[entry.status] || entry.status;
      const progressPct = Math.round((entry.progress || 0) * 100);
      const rounds = entry.roundsActive ? `第${entry.roundsActive}回合` : '';
      if (entry.status === 'progressing') {
        const estRounds = (entry.progress > 0.05 && entry.roundsActive) ? `预计还需${Math.max(1, Math.ceil((1 - entry.progress) / (entry.progress / entry.roundsActive)))}回合` : '';
        const detail = [rounds, estRounds].filter(Boolean).join('/');
        plan = `${orderSummary(entry.order)} [执行中${detail ? '·' + detail : ''} ${progressPct}%]`;
      } else if (entry.status === 'stalled') {
        const reason = entry.report?.warnings?.[0] || '受阻';
        plan = `${orderSummary(entry.order)} [受阻: ${reason}]`;
      } else if (entry.status === 'achieved') {
        plan = `${orderSummary(entry.order)} [已完成]`;
      } else if (entry.status === 'failed') {
        const isExpired = entry.report?.warnings?.some(w => w.includes('到期') || w.includes('过期'));
        plan = `${orderSummary(entry.order)} [${isExpired ? '已过期' : '已失败'}]`;
      } else {
        plan = `${orderSummary(entry.order)}  ${statusText}`;
      }
    }

    const tools = this.commandTools(), cols = Math.ceil(tools.length / 2);
    const touch = E.platform?.isTouch ? 44 * E.H / E.cv.clientHeight : 0;
    const tw = Math.max(50 * s, touch), toolH = Math.max(35 * s, touch), gap = 3 * s, pad = 8 * s, whoW = 220 * s, sideW = 110 * s, showSide = isT || !th;
    const toolsW = cols * tw + (cols - 1) * gap;
    const W = pad * 2 + whoW + 8 * s + toolsW + (showSide ? 8 * s + sideW : 28 * s), H = Math.max(88 * s, 2 * toolH + gap + 2 * pad), x = (E.W - W) / 2,
      y = E.H - H - 12 * s - (E.platform?.isTouch ? 56 * E.H / E.cv.clientHeight : 0);
    steel(c, x, y, W, H); this.barRect = { x, y, w: W, h: H };
    const ps = 56 * s;
    portrait(c, this.portraits, leader, x + pad, y + (H - ps) / 2, ps, ps, { empty: isT ? '帅' : '?' });
    this.hit(x + pad, y + (H - ps) / 2, ps, ps, { act: isT ? 'marshal' : 'commander', id: o.id });
    label(this.selectedGroups.size > 1 ? `已选 ${this.selectedGroups.size} 个集团军` : o.name, x + pad + ps + 8 * s, y + 18 * s, 15 * s, { bold: true, w: whoW - ps - 10 * s });
    label(sub, x + pad + ps + 8 * s, y + 38 * s, 12 * s, { color: PALETTE.khaki, w: whoW - ps - 10 * s });
    label(plan, x + pad + ps + 8 * s, y + 58 * s, 12 * s, { color: entry ? PALETTE.gold : '#d7766a', w: whoW - ps - 10 * s });

    const toolsX = x + pad + whoW + 8 * s, toolsY = y + (H - (toolH * 2 + gap)) / 2;
    let hoveredTool = null;
    for (const [index, tool] of tools.entries()) {
      const col = index % cols, row = Math.floor(index / cols);
      const r = { x: toolsX + col * (tw + gap), y: toolsY + row * (toolH + gap), w: tw, h: toolH };
      const on = entry && tool.verb && entry.order?.verb === tool.verb && !['achieved', 'cancelled', 'failed'].includes(entry.status);
      const dis = !active;
      tile(c, r.x, r.y, r.w, r.h, { hover: this.hov(r) && !dis, on, disabled: dis, tone: tool.verb === 'allout' ? 'red' : null });
      const img = tool.key && this.hoiUiImages[tool.key];
      const labelScale = E.platform?.isTouch ? E.H / E.cv.clientHeight : s;
      const iconSize = 16 * labelScale, cx = r.x + r.w / 2, cy = r.y + 17 * labelScale;
      if (img && img.complete && img.naturalWidth > 0) {
        c.save();
        if (dis) c.globalAlpha = 0.4;
        c.drawImage(img, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);
        c.restore();
      } else {
        label(tool.glyph || '•', cx, cy, 14 * labelScale, { align: 'center', color: dis ? '#7f7b69' : '#e9e1c4' });
      }
      label(tool.name, cx, r.y + r.h - 8 * labelScale, 10 * labelScale, { bold: true, align: 'center', color: dis ? '#7f7b69' : PALETTE.txt });
      if (tool.shortcut) label(tool.shortcut, r.x + 7 * labelScale, r.y + 7 * labelScale, 9 * labelScale, { bold: true, align: 'center', color: dis ? '#777365' : PALETTE.gold });
      if (this.hov(r)) hoveredTool = tool;
      if (!dis) this.hit(r.x, r.y, r.w, r.h, { act: 'verb', verb: tool.verb });
    }

    const sx = toolsX + toolsW + 8 * s, bw = sideW - 4 * s, bh = Math.max(24 * s, touch);
    const side = showSide && this.selectedGroups.size < 2 ? [[isT ? '解散战区' : '解散集团军', isT ? 'dissolve' : 'dissolveGroup', true]] : [];
    side.forEach(([text, act, en], i) => {
      const r = { x: sx, y: y + (H - bh) / 2, w: bw, h: bh };
      tile(c, r.x, r.y, r.w, r.h, { hover: this.hov(r) && en && active, disabled: !en || !active, tone: act === 'dissolve' || act === 'dissolveGroup' ? 'red' : null });
      label(text, r.x + r.w / 2, r.y + r.h / 2, 12 * s, { bold: true, align: 'center' });
      if (en && active) this.hit(r.x, r.y, r.w, r.h, { act });
    });
    if (hoveredTool) {
      const tip = `${hoveredTool.name}指令${hoveredTool.shortcut ? ` · 快捷键 ${hoveredTool.shortcut}` : ' · 无数字快捷键'}`;
      const tipW = 150 * s, tipX = E.clamp(E.pointer.x - tipW / 2, 8 * s, E.W - tipW - 8 * s), tipY = y - 27 * s;
      steel(c, tipX, tipY, tipW, 23 * s);
      label(tip, tipX + tipW / 2, tipY + 12 * s, 11 * s, { bold: true, align: 'center', color: PALETTE.txt });
    }
    const cr = { x: x + W - 22 * s, y: y + 4 * s, w: 18 * s, h: 18 * s };
    label('✕', cr.x + cr.w / 2, cr.y + cr.h / 2, 13 * s, { align: 'center', color: PALETTE.khaki }); this.hit(cr.x - 4, cr.y - 4, cr.w + 8, cr.h + 8, { act: 'closeBar' });
  }
  // ---- selection bar (units picked with Shift+click or drag) -------------------------------------------------------------------------
  drawSelBar(c, s) {
    if (!this.sel.size) return;
    const groups = this.groups(), can = this.game.activeCountry === this.country && this.game.phase === 'playing';
    const H = 46 * s, bw = 130 * s, W = 22 * s + 150 * s + bw * (groups.length ? 3 : 2) + 8 * s * 3, x = (E.W - W) / 2, y = E.H - H - 14 * s;
    steel(c, x, y, W, H); this.barRect = { x, y, w: W, h: H };
    label(`已选 ${this.sel.size} 个单位`, x + 14 * s, y + H / 2, 16 * s, { bold: true, color: PALETTE.gold });
    let bx = x + 14 * s + 150 * s;
    const items = [['新建集团军', 'newGroup', 'go'], ...(groups.length ? [['加入集团军 ▾', 'joinGroup', null]] : []), ['取消选择', 'clearSel', null]];
    for (const [text, act, tone] of items) {
      const r = { x: bx, y: y + 8 * s, w: bw, h: H - 16 * s };
      tile(c, r.x, r.y, r.w, r.h, { hover: this.hov(r), tone, disabled: !can && act !== 'clearSel' });
      label(text, r.x + r.w / 2, r.y + r.h / 2, 13 * s, { bold: true, align: 'center' });
      if (can || act === 'clearSel') this.hit(r.x, r.y, r.w, r.h, { act });
      bx += bw + 8 * s;
    }
  }

  // ---- on the map: banners and the selection box -------------------------------------------------------------------------------------
  center(areaId) { const a = World.areas[areaId]; return a ? this.battle.cam.toScreen(a.x + a.w / 2, a.y + a.h / 2) : null; }
  drawMap(c) {
    this.banners = [];
    if (!this.visible() && !this.battle.options.multiplayerRoom) return;
    if (this.battle.replayView || this.battle.photo || this.battle.opening || this.game.phase === 'finished') return;
    const s = this.s, cam = this.battle.cam;
    // One banner at the screen-space center of all living units in each group.
    const groups = this.battle.options.multiplayerRoom ? this.game.armyGroups : this.groups();
    // 地图上的集团军小条会挡住视线、妨碍点选地块和单位：只有在指挥部里选中(聚焦/多选)该集团军或其战区时才画；
    // 想一直显示全部，可设 WC2.state.groupBanners = true
    for (const g of groups) {
      const rows = liveGroupUnits(this.game, g); if (!rows.length) continue;
      const pts = rows.map(r => this.center(r.area.id)).filter(Boolean); if (!pts.length) continue;
      const worldCenter = rows.reduce((sum, r) => {
        const area = World.areas[r.area.id];
        return { x: sum.x + area.x + area.w / 2, y: sum.y + area.y + area.h / 2 };
      }, { x: 0, y: 0 });
      const visualScale = Math.min(1, this.battle.cam.scaleAt(worldCenter.x / rows.length, worldCenter.y / rows.length) / 2.5);
      const bannerScale = s * visualScale * 2.25;
      const center = pts.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
      center.x /= pts.length; center.y /= pts.length;
      const own = g.country === this.country, th = own ? this.theatreOf(g) : null;
      const col = own ? this.colorOfGroup(g) : getGroupColor(g, this.game, g.country);
      const multi = own && this.selectedGroups.has(g.id), foc = own && ((this.focus?.kind === 'group' && this.focus.id === g.id) || (th && this.focus?.kind === 'theatre' && this.focus.id === th.id));
      if (E.state.groupBanners !== true && !multi && !foc) continue;   // 未被选中的集团军不画小条
      const w = 98 * bannerScale, h = 22 * bannerScale, x = center.x - w / 2, y = center.y - h / 2;
      if (x + w < 0 || x > E.W || y + h < 0 || y > E.H) continue;
      c.save(); c.fillStyle = '#23261f'; c.strokeStyle = multi ? PALETTE.sel : foc ? PALETTE.gold : '#0b0c0a'; c.lineWidth = (foc || multi ? 2.5 : 1.5) * visualScale * 1.25; c.beginPath(); c.roundRect(x, y, w, h, 2.5 * visualScale); c.fill(); c.stroke();
      c.fillStyle = col; c.fillRect(x + 1, y + 1, 4 * bannerScale, h - 2); c.restore();
      const spec = commanderById(g.country, g.commanderId);
      portrait(c, this.portraits, spec, x + 7 * bannerScale, y + 3 * bannerScale, 16 * bannerScale, 16 * bannerScale, { empty: '?' });
      label(`${g.name.replace('集团军', '军')} · ${rows.length}`, x + 28 * bannerScale, y + h / 2, 11 * bannerScale, { bold: true, w: w - 32 * bannerScale });
      const r = { x, y, w, h };
      if (own && this.visible()) this.banners.push({ ...r, id: g.id });
    }
    if (this.box) {
      const b = this.box; c.save(); c.fillStyle = 'rgba(255,211,90,.14)'; c.strokeStyle = PALETTE.sel; c.lineWidth = 2; c.setLineDash([6, 4]);
      c.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); c.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); c.restore();
    }
  }

  // ---- input -------------------------------------------------------------------------------------------------------------------------
  // returns true when the press belongs to this UI (the map must not react to it)
  pointerDown(p) {
    const toggle = [...this.hits].reverse().find(r => r.act === 'toggleStack' && inside(p, r));
    if (toggle && p.button !== 2 && !this.interactive()) { this.press = { h: toggle, x: p.x, y: p.y }; return true; }
    if (!this.interactive() && !(this.visible() && this.box)) return false;
    if (this.box) return true;
    if (p.button === 2) {
      const h = [...this.hits].reverse().find(r => r.right && inside(p, r)), b = this.banners.find(r => inside(p, r));
      if (h) { this.openMenu(h.right[0], h.right[1], p); return true; }
      if (b) { this.setFocus('group', b.id); this.openMenu('army', b.id, p); return true; }
      return !!([...this.hits].reverse().find(r => inside(p, r)) || (this.barRect && inside(p, this.barRect)));
    }
    const h = [...this.hits].reverse().find(r => inside(p, r));
    if (p.shiftKey && p.button === 0 && !h && !(this.barRect && inside(p, this.barRect)) && !this.strips.some(r => inside(p, r)) && !this.banners.some(r => inside(p, r))) {
      const hit = this.battle.units.hitBox(p);
      const area = hit && this.game.stage.st(hit.id);
      const unit = area?.country === this.country && area.armies.find(a => a.id === hit.armyId && a.hp > 0);
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: p.ctrlKey || this.sel.size > 0, clickUnitId: unit?.id };
      return true;
    }
    if (h) {
      if (h.dragStack && this.stackPos) {
        this.stackDrag = { startX: p.x, startY: p.y, origX: this.stackPos.x, origY: this.stackPos.y, h };
        return true;
      }
      this.press = { h, x: p.x, y: p.y, shiftKey: p.shiftKey };
      return true;
    }
    const b = this.banners.find(r => inside(p, r));
    if (b) { this.press = { h: { act: 'banner', id: b.id }, x: p.x, y: p.y, shiftKey: p.shiftKey }; return true; }
    if (this.barRect && inside(p, this.barRect)) return true;
    if (this.strips.some(r => inside(p, r))) return true;
    return false;
  }
  pointerMove(p) {
    if (this.box) { this.box.x1 = p.x; this.box.y1 = p.y; return true; }
    if (this.stackDrag) {
      const s = this.s, W = (this.stackHidden ? 66 : 270) * s;
      const dx = p.x - this.stackDrag.startX, dy = p.y - this.stackDrag.startY;
      const minX = 0, maxX = Math.max(0, E.W - W);
      const minY = 0, maxY = Math.max(0, E.H - (this.stackTotalH || 60 * s));
      this.stackPos.x = E.clamp(this.stackDrag.origX + dx, minX, maxX);
      this.stackPos.y = E.clamp(this.stackDrag.origY + dy, minY, maxY);
      return true;
    }
    if (this.press && !this.press.shiftKey && this.press.h.drag && !this.drag && Math.hypot(p.x - this.press.x, p.y - this.press.y) > 6) this.drag = { id: this.press.h.drag, moved: true };
    return !!(this.press || this.drag);
  }
  pointerCancel() {
    this.box = null;
    this.press = null;
    this.drag = null;
    this.stackDrag = null;
  }
  pointerUp(p) {
    if (this.box) { this.box.x1 = p.x; this.box.y1 = p.y; this.finishBox(); return true; }
    if (this.stackDrag) {
      const drag = this.stackDrag;
      this.stackDrag = null;
      if (Math.hypot(p.x - drag.startX, p.y - drag.startY) <= 8) {
        if (drag.h.act !== 'dragStack') this.click(drag.h, p);
      } else {
        try {
          localStorage.setItem(platform.isTouch ? 'wc2_theatre_stack_pos_touch' : 'wc2_theatre_stack_pos', JSON.stringify({ x: Math.round(this.stackPos.x), y: Math.round(this.stackPos.y) }));
        } catch (e) {}
      }
      return true;
    }
    const press = this.press; this.press = null;
    if (this.drag) {
      const d = this.drag; this.drag = null;
      const marker = this.markers.find(r => r.id !== d.id && inside(p, r));
      if (marker) {
        const source = this.groups().find(g => g.id === d.id), target = this.groups().find(g => g.id === marker.id);
        if (source && target) {
          if (!this.unitCount(source)) {
            this.say('集团军没有可合并的单位');
          } else if (!this.canMerge(source.id, target.id)) {
            this.say('集团军人数已满，无法合并');
          } else {
            const unitIds = liveGroupUnits(this.game, source).map(r => r.army.id);
            if (this.cmd('transferUnits', { unitIds, toGroupId: target.id })
              && this.cmd('dissolveArmyGroup', { groupId: source.id })) {
              this.setFocus('group', target.id);
              this.say(`已将${source.name}并入${target.name}`);
            }
          }
        }
        return true;
      }
      const st = this.strips.find(r => inside(p, r));
      if (st) {
        const g = this.game.armyGroups.find(v => v.id === d.id), cur = this.theatreOf(g);
        if ((st.theatre?.id || null) !== (cur?.id || null)) {
          this.battle.pushOrderUndo({
            type: 'assignTheater',
            groupId: d.id,
            prevTheaterId: cur ? cur.id : null
          });
          if (this.cmd('assignArmyToTheater', { groupId: d.id, theaterId: st.theatre ? st.theatre.id : null })) {
            this.say(st.theatre ? `${g.name}已编入${st.theatre.name}` : `${g.name}已移出战区`);
          }
        }
      }
      return true;
    }
    if (!press) return false;
    if (Math.hypot(p.x - press.x, p.y - press.y) > 8) return true;
    this.click(press.h, { ...p, shiftKey: press.shiftKey });
    return true;
  }
  finishBox() {
    const b = this.box; this.box = null; if (!b) return;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    if (x1 - x0 < 8 && y1 - y0 < 8) {
      if (b.clickUnitId != null) {
        if (this.sel.has(b.clickUnitId)) this.sel.delete(b.clickUnitId);
        else this.sel.add(b.clickUnitId);
        this.focus = null; this.selectedGroups.clear(); this.battle.selectedOrderTarget = null;
      }
      return;
    }
    if (!b.additive) this.sel.clear();
    for (const area of this.game.stage.areas) {
      if (area.country !== this.country) continue;
      const p = this.center(area.id); if (!p || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      for (const a of area.armies) if (a.hp > 0) this.sel.add(a.id);
    }
    if (this.sel.size) { this.focus = null; this.selectedGroups.clear(); this.battle.selectedOrderTarget = null; this.say(`已选 ${this.sel.size} 个单位`); } else this.say('框内没有我方单位');
  }
  glowingUnits() {
    if (!this.box) return this.sel;
    const b = this.box, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const ids = new Set(b.additive ? this.sel : []);
    if (x1 - x0 < 8 && y1 - y0 < 8) return ids;
    for (const area of this.game.stage.areas) {
      if (area.country !== this.country) continue;
      const p = this.center(area.id);
      if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        for (const army of area.armies) if (army.hp > 0) ids.add(army.id);
    }
    return ids;
  }
  clearSelection() { this.sel.clear(); }
  key(e) {
    if (e.key === 'Escape') {
      if (this.sel.size || this.focus || this.selectedGroups.size) { this.sel.clear(); this.setFocus(null); return true; }
      return false;
    }
    if (!/^[0-9]$/.test(e.key) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
    const target = e.target || document.activeElement;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return false;
    const b = this.battle;
    if (!this.interactive() || this.game.activeCountry !== this.country || this.game.phase !== 'playing' || this.game.fogOfWar || (this.game.spectating || this.game.bridgeSpectating) || b.replayView || b.dialog || b.orderDrawing || b.cardTarget != null) return false;
    if (!this.focus && !this.selectedGroups.size) {
      if (e.key !== '0') return false;
      this.battle.startAlloutOrder({ level: 'country', id: this.country });
      return true;
    }
    const tool = this.commandTools().find(item => item.shortcut === e.key);
    if (!tool) return false;
    this.click({ act: 'verb', verb: tool.verb }, E.pointer);
    return true;
  }
  openMenu(level, id, p) { this.battle.portraitMenu.openMenu(level, id, p.x, p.y); }

  // ---- actions -----------------------------------------------------------------------------------------------------------------------
  autoOrganize() {
    const unassigned = armyRows(this.game, this.country).filter(r => r.army?.hp > 0 && !groupForArmy(this.game, this.country, r.army.id));
    if (!unassigned.length) { this.say('没有可编组的部队'); return; }

    const commands = autoOrganize(this.game, this.country);
    if (!commands.length) { this.say('现有部队暂时无法编组'); return; }

    let groups = 0, theaters = 0;
    const groupIds = new Map(), theaterIds = new Map();
    let plannedGroupId = this.game.nextArmyGroupId || 1;
    let plannedTheaterId = this.game.nextTheaterId || 1;
    const failedReasons = [];

    const applyCmd = (type, extra = {}) => {
      const res = this.game.apply({ type, country: this.country, ...extra });
      if (!res.ok) {
        failedReasons.push(res.reason || '无法执行');
      }
      return res;
    };

    for (const command of commands) {
      const { type, country, ...extra } = command;
      if (extra.groupId && groupIds.has(extra.groupId)) extra.groupId = groupIds.get(extra.groupId);
      if (extra.theaterId && theaterIds.has(extra.theaterId)) extra.theaterId = theaterIds.get(extra.theaterId);
      if (type === 'assignArmyToTheater' &&
          (!this.groups().some(g => g.id === extra.groupId) || !this.theatres().some(t => t.id === extra.theaterId))) continue;
      if (type === 'setArmyGroup' && extra.groupId == null) {
        const plannedId = 'group_' + plannedGroupId++;
        const res = applyCmd(type, extra);
        if (res.ok) {
          groupIds.set(plannedId, this.groups().at(-1).id);
          groups++;
        }
      } else if (type === 'createTheater') {
        const plannedId = 'theater_' + plannedTheaterId++;
        const res = applyCmd(type, extra);
        if (res.ok) {
          theaterIds.set(plannedId, this.theatres().at(-1).id);
          theaters++;
        }
      } else {
        applyCmd(type, extra);
      }
    }

    if (failedReasons.length > 0) {
      const distinctReasons = [...new Set(failedReasons)].join('、');
      const prefix = (groups || theaters) ? `已自动编组 ${groups} 个集团军、${theaters} 个战区；` : '';
      this.say(`${prefix}${failedReasons.length} 条指令被拒：${distinctReasons}`);
      E.playSfx(groups || theaters ? 'select.wav' : 'cancel.wav');
    } else if (groups || theaters) {
      this.say(`已自动编组 ${groups} 个集团军、${theaters} 个战区`);
      E.playSfx('select.wav');
    } else {
      this.say('现有部队暂时无法编组');
      E.playSfx('cancel.wav');
    }
  }
  click(h, p) {
    const now = performance.now();
    switch (h.act) {
      case 'toggleStack':
        this.stackHidden = !this.stackHidden; this.macroOpen = false;
        this.stackTotalH = (this.stackHidden ? 32 : 80) * this.s;
        try { localStorage.setItem('wc2.hq.hidden', String(this.stackHidden)); } catch {}
        break;
      case 'dragStack': break;
      case 'autoOrganize': this.autoOrganize(); break;
      case 'macroRec': {
        const m = this.macro;
        if (m.playing) { this.say('重放中，请先停止'); break; }
        if (!m.recording) { m.start(); this.say('开始录制：接下来的操作都会被记下，再点一次保存'); E.playSfx('select.wav'); break; }
        const name = m.cmds.length ? window.prompt('给这条录制起个名字', m.defaultName()) : null;
        const r = m.stop(name);
        this.say(r.saved ? `已保存录制「${r.name}」：${r.count} 步（第 ${r.from}${r.to !== r.from ? '–' + r.to : ''} 回合）` : '没有录到任何操作，已放弃');
        break;
      }
      case 'macroPlay': {
        const m = this.macro;
        if (m.playing) { m.cancel(); this.say('已停止重放'); break; }
        if (m.recording) { this.say('正在录制，请先结束录制'); break; }
        if (!m.list().length) { this.say('本关卡还没有录制：先点左边的红点录制一次'); break; }
        this.macroOpen = !this.macroOpen;
        break;
      }
      case 'macroPick': {
        this.macroOpen = false;
        const r = this.macro.play(h.id, { onDone: sum => this.say(sum.failed.length ? `「${sum.name}」重放完成：成功 ${sum.ok}/${sum.total} 步，${sum.failed.length} 步未能执行（${[...new Set(sum.failed.map(f => f.reason))].slice(0, 2).join('；')}）` : `「${sum.name}」重放完成：${sum.total} 步全部执行`) });
        this.say(r.started ? `开始重放「${r.name}」${r.total} 步…` : r.reason);
        break;
      }
      case 'macroDel': { const rec = this.macro.get(h.id); if (rec && window.confirm(`删除录制「${rec.name}」？`)) { this.macro.remove(h.id); if (!this.macro.list().length) this.macroOpen = false; } break; }
      case 'macroRen': { const rec = this.macro.get(h.id), name = rec && window.prompt('录制名称', rec.name); if (name) this.macro.rename(h.id, name); break; }
      case 'macroClose': this.macroOpen = false; break;
      case 'addTheatre': if (this.cmd('createTheater')) { const t = this.theatres().at(-1); this.setFocus('theatre', t.id); } break;
      case 'selTheatre': {
        const dbl = this.lastClick && this.lastClick.id === h.id && now - this.lastClick.t < 350; this.lastClick = { id: h.id, t: now };
        if (dbl) { const t = this.theatres().find(v => v.id === h.id), name = prompt('战区名称', t.name); if (name && name.trim()) this.cmd('renameTheater', { theaterId: h.id, name }); break; }
        if (this.focus?.kind === 'theatre' && this.focus.id === h.id) this.setFocus(null); else this.setFocus('theatre', h.id);
        break;
      }
      case 'fold': if (this.folds.has(h.id)) this.folds.delete(h.id); else this.folds.add(h.id); break;
      case 'marker': case 'banner':
        if (p.shiftKey) {
          if (this.selectedGroups.has(h.id)) this.selectedGroups.delete(h.id); else this.selectedGroups.add(h.id);
          const first = this.selectedGroups.values().next().value;
          this.focus = first ? { kind: 'group', id: first } : null;
          this.battle.selectedOrderTarget = first ? { level: 'army', id: first } : null;
          this.sel.clear();
        } else if (this.focus?.kind === 'group' && this.focus.id === h.id && !this.selectedGroups.size) this.setFocus(null);
        else this.setFocus('group', h.id);
        break;
      case 'marshal': this.chooseMarshal(this.theatres().find(t => t.id === h.id) || this.targetObj()); break;
      case 'commander': this.chooseCommander(this.targetObj()); break;
      case 'verb': { const targets = this.orderTargets(); if (targets.length) {
        if (h.verb === 'allout') this.battle.startAlloutOrder({ ...targets[0], ids: targets.map(t => t.id) });
        else this.battle.startOrderDrawing({ ...targets[0], ids: targets.map(t => t.id), verb: h.verb });
      } break; }
      case 'toggleExec': {
        const o = this.targetObj();
        if (o) {
          const entry = this.entryFor(this.focus.kind, o.id);
          if (entry) {
            this.battle.pushOrderUndo({
              type: 'toggleExec',
              level: this.levelOf(this.focus.kind),
              targetId: o.id,
              prevStatus: entry.status
            });
            if (entry.status === 'progressing') {
              this.cmd('setOrderPaused', { level: this.levelOf(this.focus.kind), targetId: o.id, paused: true });
              this.say(o.name + '：作战计划已暂停推进');
            } else {
              this.cmd('setOrderPaused', { level: this.levelOf(this.focus.kind), targetId: o.id, paused: false });
              this.say(o.name + '：作战计划开始推进');
            }
          }
        }
        break;
      }
      case 'dissolve': { const o = this.targetObj(); if (o && this.cmd('dissolveTheater', { theaterId: o.id })) { this.setFocus(null); this.say(o.name + '已解散，集团军转入「未编入战区」'); } break; }
      case 'unassign': { const o = this.targetObj(); if (o && this.cmd('assignArmyToTheater', { groupId: o.id, theaterId: null })) this.say(o.name + '已移出战区'); break; }
      case 'dissolveGroup': { const o = this.targetObj(); if (o && this.cmd('dissolveArmyGroup', { groupId: o.id })) { this.setFocus(null); this.say(o.name + '已解散，单位回到总参直属'); } break; }
      case 'closeBar': this.setFocus(null); break;
      case 'newGroup': this.chooseCommander(null); break;
      case 'joinGroup': this.chooseGroupToJoin(); break;
      case 'clearSel': this.sel.clear(); break;
    }
  }
  portraitsReady() { return this.portraits; }
  commanderItems(group) {
    const used = id => this.groups().find(g => g.commanderId === id && g.id !== group?.id) || this.theatres().find(t => t.marshalId === id);
    return countryCommanders(this.country).filter(sp => !sp.marshal || true).map(spec => {
      const owned = ownsCommander(this.game, spec), year = commanderYearAvailable(this.game, spec), u = used(spec.id);
      const note = !owned ? `未购买 · ${spec.cost} 勋章` : !year ? '年代不符' : u ? '已任职' : '', mods = modLines(spec.mods).slice(0, 2).map(m => m.text).join('  ');
      return { name: spec.name, sub: `${spec.tactic}${mods ? '  ' + mods : ''}`, note, spec, owned, disabled: !!note, onPick: () => { this.closePick(); this.pickedCommander(group, spec); } };
    }).sort((a, b) => Number(b.owned) - Number(a.owned));
  }
  pickedCommander(group, spec) {
    if (group) { this.cmd('appointCommander', { groupId: group.id, commanderId: spec.id }); return; }
    const ids = [...this.sel]; if (!ids.length) return;
    if (!this.cmd('createArmyGroup', { commanderId: spec.id })) return;
    const g = this.groups().at(-1);
    if (this.cmd('transferUnits', { unitIds: ids, toGroupId: g.id })) {
      this.sel.clear();
      const theatres = this.theatres();
      let targetTheatre = null;

      // 1. 若当前聚焦在某个战区上，优先归属于该战区
      if (this.focus?.kind === 'theatre') {
        targetTheatre = theatres.find(t => t.id === this.focus.id);
      }
      // 2. 否则选择容量未满的已有战区
      if (!targetTheatre) {
        targetTheatre = theatres[0];
      }
      // 3. 否则默认归属于已有的第一个战区
      if (!targetTheatre && theatres.length > 0) {
        targetTheatre = theatres[0];
      }
      // 4. 若此时完全没有任何战区，则先创建第一个战区再编入
      if (!targetTheatre) {
        if (this.cmd('createTheater')) {
          targetTheatre = this.theatres().at(-1);
        }
      }

      if (targetTheatre) {
        this.cmd('assignArmyToTheater', { groupId: g.id, theaterId: targetTheatre.id });
        this.setFocus('group', g.id);
        this.say(`${g.name}已编成（${ids.length} 个单位），已编入${targetTheatre.name}`);
      } else {
        this.setFocus('group', g.id);
        this.say(`${g.name}已编成（${ids.length} 个单位）`);
      }
    }
  }
  chooseCommander(group) {
    this.openPick({ title: group ? '更换指挥官 · ' + group.name : `任命集团军指挥官 · 编入 ${this.sel.size} 个单位`, items: this.commanderItems(group) });
  }
  chooseMarshal(t) {
    if (!t) return;
    const used = id => this.theatres().find(v => v.id !== t.id && v.marshalId === id) || this.groups().find(g => g.commanderId === id);
    const items = countryCommanders(this.country).filter(sp => sp.marshal).map(spec => {
      const owned = ownsCommander(this.game, spec), year = commanderYearAvailable(this.game, spec), u = used(spec.id);
      const note = !owned ? `未购买 · ${spec.cost} 勋章` : !year ? '年代不符' : u ? '已任职' : '';
      return { name: spec.name, sub: `${spec.tactic} · 协同 进攻+${Math.round((spec.coordination?.attack || 0) * 100)}% 防御+${Math.round((spec.coordination?.defence || 0) * 100)}%`, note, spec, disabled: !!note, onPick: () => { this.closePick(); this.cmd('appointMarshal', { theaterId: t.id, marshalId: spec.id }); } };
    }).sort((a, b) => a.disabled - b.disabled);
    if (t.marshalId) items.push({ name: '免去元帅', sub: '战区回到默认指挥容量', glyph: '×', onPick: () => { this.closePick(); this.cmd('appointMarshal', { theaterId: t.id, marshalId: null }); } });
    this.openPick({ title: '任命战区元帅 · ' + t.name, items, empty: '没有可任命的元帅（需在首页「指挥官」购买）' });
  }
  chooseGroupToJoin() {
    const items = this.groups().map(g => ({ name: g.name, sub: `${commanderById(this.country, g.commanderId)?.name || '无指挥官'} · ${this.unitCount(g)} 单位`, spec: commanderById(this.country, g.commanderId),
      onPick: () => { this.closePick(); const ids = [...this.sel]; if (this.cmd('transferUnits', { unitIds: ids, toGroupId: g.id })) { this.sel.clear(); this.setFocus('group', g.id); this.say(`已加入${g.name}`); } } }));
    this.openPick({ title: `加入集团军 · ${this.sel.size} 个单位`, items });
  }
  // a support order (配合): pick which standing order to support
  chooseSupport(level, targetId) {
    const list = (this.game.orders || []).filter(o => o.order && ['pending', 'progressing', 'stalled'].includes(o.status) && !(o.level === level && o.targetId === targetId));
    const items = list.map(entry => ({ name: orderSummary(entry.order), sub: entry.level === 'theater' ? '战区命令' : '集团军命令', glyph: '➜', onPick: () => {
      this.closePick(); const t = entry.order; const order = { verb: 'support', from: t.from, to: t.to, risk: .5, priority: 5, supportOrderId: entry.id, path: t.path || undefined, draw: t.draw || undefined };
      this.cmd(level === 'army' ? 'setArmyOrder' : 'setTheaterOrder', { groupId: targetId, theaterId: targetId, order });
    } }));
    this.openPick({ title: '配合哪一项命令', items, empty: '当前没有可配合的命令' });
  }
  openPick(o) { this.battle.dialog = new PickDialog({ ...o, portraits: this.portraits, close: () => this.closePick() }); E.playSfx('pop.wav'); }
  closePick() { if (this.battle.dialog instanceof PickDialog) this.battle.dialog = null; }
  // the portrait menu (TheaterPanel) opens its own pickers, which the battle scene never draws: turn them into our dialogs
  adoptMenuPicker() {
    const pm = this.battle.portraitMenu, pk = pm.picker; if (!pk) return;
    pm.picker = null;
    if (pk.kind === 'marshal') this.chooseMarshal(this.theatres().find(t => t.id === pk.theaterId));
    else if (pk.kind === 'support') this.chooseSupport(pk.level, pk.targetId);
    else if (pk.kind === 'group') this.say('把集团军的钢盔标拖到战区条上即可编入');
  }
}
