// Zhengwu / Strategic Administration Panel
// Implements the leather document folder design conforming to ZHENGWU_UI_TASK.md

import { E } from '../../../core/index.js';
import { TheaterPanel } from './theater_panel.js';
import { SituationPanel } from './situation_panel.js';
import { buildSituationReport } from '../../../game/situation.js';
import { foldOpeningReports } from '../../../game/report.js';
import { DIPLOMACY_STATE, RELATION_NAMES, relationKey, getDiplomaticRelation, warCascade, hasNap, computeReparations, declareWarStabilityCost } from '../../../game/rules/diplomacy.js';

const SERIF = E.CJK_SERIF || 'Songti SC, SimSun, serif';
const BOARD_STRETCH = 1.15;
const DIPLOMACY_TAGS = {
  scenario: { text: '[剧本]', label: '剧本', bg: 'rgba(245, 166, 35, 0.16)', border: '#d99b38', color: '#8c531b' },
  rule: { text: '[规则]', label: '规则', bg: 'rgba(100, 116, 139, 0.15)', border: '#8da0b3', color: '#334155' },
  player: { text: '[你]', label: '你', bg: 'rgba(46, 125, 50, 0.16)', border: '#57a35c', color: '#1b5e20' },
  offer_accepted: { text: '[接受]', label: '接受', bg: 'rgba(21, 101, 192, 0.16)', border: '#5396db', color: '#0d47a1' },
  offer_rejected: { text: '[拒绝]', label: '拒绝', bg: 'rgba(198, 40, 40, 0.16)', border: '#db6969', color: '#b71c1c' },
  staff: { text: '[参谋]', label: '参谋', bg: 'rgba(106, 27, 154, 0.16)', border: '#ab65c7', color: '#4a148c' },
  ai: { text: '[AI]', label: 'AI', bg: 'rgba(69, 90, 100, 0.14)', border: '#78909c', color: '#263238' },
  unclassified: { text: '[未分类]', label: '未分类', bg: 'rgba(117, 117, 117, 0.14)', border: '#9e9e9e', color: '#424242' },
};

const TABS = [
  { id: 'situation', label: '局势' },
  { id: 'diplomacy', label: '外交' },
  { id: 'events', label: '战报' },
  { id: 'autoplay', label: '参谋' },
  { id: 'theater', label: '战区' },
];

const SITUATION_SORTS = [
  { id: 0, label: '综合实力' },
  { id: 4, label: '领地' },
  { id: 3, label: '军力' },
  { id: 1, label: '经济' },
];

const COUNTRY_NAMES_MAP = {
  de: '德国', de1: '德国', de2: '德国', it: '意大利', it1: '意大利', ja: '日本', ja1: '日本', ja2: '日本',
  gb: '英国', gb1: '英国', fr: '法国', fr1: '法国', dk: '丹麦', nl: '荷兰', be: '比利时',
  no: '挪威', ru: '苏联', ru1: '苏联', ru2: '苏联', fl: '芬兰', ch: '瑞士',
  nk: '朝鲜', kr: '韩国', rk: '韩国', in: '印度', am: '美国', am1: '美国',
  ca: '加拿大', mx: '墨西哥', cn: '中国', tw: '中国', tw1: '中国', tw2: '中国',
  au: '澳大利亚', yu: '南斯拉夫', ro: '罗马尼亚', hu: '匈牙利', bg: '保加利亚',
  gr: '希腊', tr: '土耳其', es: '西班牙', pt: '葡萄牙', pl: '波兰', se: '瑞典',
  ir: '伊朗', iq: '伊拉克', eg: '埃及', ly: '利比亚', sa: '沙特', br: '巴西',
  ar: '阿根廷', cu: '古巴'
};

function formatCountryDisplayName(countryObj, isPlayer, allCountries) {
  const flag = countryObj.flag || countryObj.id;
  const baseName = COUNTRY_NAMES_MAP[countryObj.id] || COUNTRY_NAMES_MAP[flag] || countryObj.name || countryObj.id;
  const sameFlag = allCountries.filter(c => (c.flag || c.id) === flag);
  if (sameFlag.length > 1) {
    if (isPlayer) return baseName;
    if (countryObj.commander && !countryObj.commander.startsWith('common')) {
      const cName = countryObj.commander === 'Guderian' ? '古德里安' : countryObj.commander;
      return `${baseName}（${cName}兵团）`;
    }
    const idx = sameFlag.indexOf(countryObj) + 1;
    return `${baseName}（第${idx}集团军）`;
  }
  return baseName;
}

export class ZhengwuDialog {
  constructor(game, battle, hooks = {}) {
    this.game = game;
    this.battle = battle;
    this.hooks = hooks;
    this.isZhengwu = true;
    this.activeTab = hooks.initialTab || 'situation';
    this.theaterPanel = new TheaterPanel(this);
    this.situationPanel = new SituationPanel(this);
    this.sortType = 0;
    this.scroll = 0;
    this.reportFilter = 'all';
    this.diplomacyOnlyMine = false;
    this.openingExpanded = false;
    this.drag = null;
    this.signatureStroke = null;
    this.signatureHintUntil = 0;
    this.signatureStampAt = null;
    if (!battle.zhengwuSignature || (!battle.autoPlayer.enabled && battle.zhengwuSignature.authorized)) {
      battle.zhengwuSignature = { strokes: [], authorized: false, revokedAt: null };
    }
    E.preloadSfx(['pop.wav']);
    this.t0 = performance.now();
    this.confirmDialog = null; // { title, content, cascadedCountries, warning, ackOnly, onConfirm, onCancel }

    // Preload required assets
    this.assets = {
      boardCommon: null,
      boardSelbattle: null,
      chooseBoard: null,
      boardIntro: null,
      armyAtlas: null,
      flagAtlas: null,
    };

    Promise.all([
      E.image('assets/board_common@2x.webp'),
      E.image('assets/board_selbattle@2x.webp'),
      E.image('assets/choose_battle_intorboard@2x.png'),
      E.image('assets/board_intro@2x.webp'),
      E.atlas('army_hd'),
      E.atlas('flag_hd'),
    ]).then(([boardCommon, boardSelbattle, chooseBoard, boardIntro, armyAtlas, flagAtlas]) => {
      this.assets.boardCommon = boardCommon;
      this.assets.boardSelbattle = boardSelbattle;
      this.assets.chooseBoard = chooseBoard;
      this.assets.boardIntro = boardIntro;
      this.assets.armyAtlas = armyAtlas;
      this.assets.flagAtlas = flagAtlas;
    }).catch(err => {
      console.warn('Zhengwu assets loading error:', err);
    });
  }

  tabs(){return (this.game.spectating || this.game.bridgeSpectating)?TABS.filter(tab=>tab.id==='situation'||tab.id==='events'):TABS;}

  get otherCountries() {
    const player = this.game.player;
    return this.game.stage.data.countries.filter(c => c.id !== player);
  }

  geom() {
    const W = E.W, H = E.H;
    // Keep the board's height and text scale unchanged at a given scale.
    const scale = Math.min((W - 40) / (1024 * BOARD_STRETCH), (H - 40) / 565, 1.21);
    const pw = 1024 * BOARD_STRETCH * scale;
    const ph = 565 * scale;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    const sw = 190 * (scale / 1.21);
    const boardRect = { x: px, y: py, w: pw, h: ph };
    const barRect = { x: px, y: py, w: sw, h: ph };
    return { W, H, scale, pw, ph, px, py, sw, boardRect, barRect };
  }

  contentRect(g = this.geom()) {
    const s = g.scale;
    const x = g.barRect.x + g.barRect.w + 30 * s;
    const y = g.boardRect.y + 25 * s;
    const right = g.boardRect.x + g.boardRect.w - 70 * s;
    const bottom = g.boardRect.y + g.boardRect.h - 72 * s;
    return { x, y, w: right - x, h: bottom - y };
  }

  bodyRect(g = this.geom()) {
    const safe = this.contentRect(g), y = g.py + 95 * g.scale;
    return { x: safe.x, y, w: safe.w, h: safe.y + safe.h - y };
  }

  selectedTabRect(g = this.geom(), index = this.tabs().findIndex(tab => tab.id === this.activeTab)) {
    const s = g.scale;
    return { x: g.barRect.x + 10 * s, y: g.py + (85 + index * 74) * s,
      w: g.barRect.w - 20 * s, h: 64 * s };
  }

  close() {
    this.cancelGesture();
    E.playSfx('cancel.wav');
    if (this.hooks.close) this.hooks.close();
  }

  diplomacyGeom(g) {
    const s = g.scale;
    const { x: cx, y: cy, w: cw, h: ch } = this.bodyRect(g);
    const listTop = g.py + 110 * s;
    const rowH = 78 * s;
    const startY = listTop + 6 * s;
    const btnW = 88 * (s / 1.21), btnH = 32 * (s / 1.21);
    const btnGap = 12 * s;
    const btn1X = cx + cw - 48 * s - btnW;
    const btn2X = btn1X - btnW - btnGap;
    const btn3X = btn2X - btnW - btnGap;
    return { s, cx, cy, cw, ch, listTop, rowH, startY, btnW, btnH, btnGap, btn1X, btn2X, btn3X };
  }

  truceLeft(a, b) {
    const until = this.game.diplomacy?.truceUntil?.[relationKey(a, b)] || 0;
    return Math.max(0, until - (this.game.round || 1));
  }

  reparationsBill(player, countryId) {
    return computeReparations(this.game, player, countryId);
  }

  situationRowH(s) {
    return (this.game?.diplomacy?.enabled ? 52 : 38) * s;
  }

  traitView(countryId) {
    const game = this.game;
    if (!game?.diplomacy?.enabled) return null;
    const info = game.stage?.countries?.get(countryId);
    const catalog = game.stage?.data?.traitCatalog;
    if (!info || (!info.regime && !(info.traits || []).length)) return null;
    const regime = catalog?.regimes?.[info.regime] || null;
    const traits = (info.traits || []).map(id => catalog?.traits?.[id]).filter(Boolean);
    return {
      regimeLabel: regime?.label || '',
      regimeTip: [regime?.blurb, info.traitNote].filter(Boolean).join(''),
      traits: traits.map(t => ({ label: t.label, tip: t.desc })),
    };
  }

  drawTraitChips(c, x, y, view, s, maxW) {
    if (!view) return;
    const items = [];
    if (view.regimeLabel) items.push({ label: view.regimeLabel, tip: view.regimeTip });
    for (const t of view.traits) items.push({ label: t.label, tip: t.tip });
    if (!this._traitHits) this._traitHits = [];
    let cx = x;
    const h = Math.max(14, 16 * s);
    const gap = 4 * s;
    const fontSize = Math.max(11, Math.round(11 * s));
    for (const item of items) {
      c.save();
      c.font = `${fontSize}px ${SERIF}`;
      const tw = Math.ceil(c.measureText(item.label).width + 10 * s);
      c.restore();
      if (cx > x && cx + tw > x + maxW) break;
      const rect = { x: cx, y: y - h / 2, w: tw, h, tip: item.tip };
      c.save();
      c.fillStyle = 'rgba(74, 48, 24, 0.08)';
      c.strokeStyle = 'rgba(74, 48, 24, 0.55)';
      c.lineWidth = 1;
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:182').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:183').roundRect(rect.x, rect.y, rect.w, rect.h, 2);
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:184').fill();
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:185').stroke();
      c.restore();
      E.text(item.label, rect.x + rect.w / 2, y + 0.5, {
        size: fontSize, font: SERIF, color: '#4a3018', align: 'center', base: 'middle'
      });
      this._traitHits.push(rect);
      cx += tw + gap;
    }
  }

  drawTraitTooltip(c) {
    const p = E.pointer;
    const hits = this._traitHits;
    if (!p || !hits?.length) return;
    const hit = hits.find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (!hit?.tip) return;
    const g = this.geom();
    const s = g.scale;
    const fontSize = Math.max(13, Math.round(13 * s));
    const maxW = 260 * s;
    c.save();
    c.font = `${fontSize}px ${SERIF}`;
    const lines = [];
    let cur = '';
    for (const ch of hit.tip) {
      if (c.measureText(cur + ch).width > maxW - 16 * s && cur) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    c.restore();
    const lineH = fontSize + 4;
    const boxW = maxW;
    const boxH = lines.length * lineH + 12 * s;
    let bx = hit.x;
    let by = hit.y + hit.h + 6;
    if (bx + boxW > g.W - 8) bx = Math.max(8, g.W - 8 - boxW);
    if (by + boxH > g.H - 8) by = Math.max(8, hit.y - boxH - 6);
    c.save();
    c.fillStyle = '#f6edd8';
    c.strokeStyle = '#6b4f33';
    c.lineWidth = 1;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:228').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:229').roundRect(bx, by, boxW, boxH, 3);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:230').fill();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:231').stroke();
    c.restore();
    for (let i = 0; i < lines.length; i++) {
      E.text(lines[i], bx + 8 * s, by + 6 * s + i * lineH + fontSize / 2, {
        size: fontSize, font: SERIF, color: '#2a1d12', base: 'middle'
      });
    }
  }

  showRejectNotice(countryName, actionLabel) {
    this.confirmDialog = {
      title: `${countryName}拒绝了提议`,
      content: `对方拒绝了本次${actionLabel}。\n详情已写入战报。`,
      ackOnly: true,
    };
  }

  switchTab(tabId) {
    if(!this.tabs().some(tab=>tab.id===tabId))return;
    if (this.activeTab !== tabId) {
      this.cancelGesture();
      this.activeTab = tabId;
      this.scroll = 0;
      this.confirmDialog = null;
      E.playSfx('btn.wav');
    }
  }

  down(p) {
    if (this.signatureStroke) return;
    const g = this.geom();

    // 1. If confirm dialog is active, handle confirm modal clicks
    if (this.confirmDialog) {
      const cw = 700 * (g.scale / 1.21), ch = 430 * (g.scale / 1.21);
      const cx = (g.W - cw) / 2, cy = (g.H - ch) / 2;
      const btnW = 120 * (g.scale / 1.21), btnH = 46 * (g.scale / 1.21);
      const btnY = cy + ch - 82 * (g.scale / 1.21);
      const ackOnly = !!this.confirmDialog.ackOnly;
      const cancelX = cx + cw * 0.28 - btnW / 2;
      const okX = ackOnly ? cx + cw * 0.5 - btnW / 2 : cx + cw * 0.72 - btnW / 2;

      // Cancel button (hidden on ack-only notices)
      if (!ackOnly && p.x >= cancelX && p.x <= cancelX + btnW && p.y >= btnY && p.y <= btnY + btnH) {
        E.playSfx('cancel.wav');
        this.confirmDialog = null;
        return;
      }
      // OK button
      if (p.x >= okX && p.x <= okX + btnW && p.y >= btnY && p.y <= btnY + btnH) {
        E.playSfx('btn.wav');
        const action = this.confirmDialog.onConfirm;
        this.confirmDialog = null;
        if (action) action();
        return;
      }
      // Click outside confirm modal dismisses it
      if (p.x < cx || p.x > cx + cw || p.y < cy || p.y > cy + ch) {
        E.playSfx('cancel.wav');
        this.confirmDialog = null;
      }
      return;
    }

    // 2. Bottom centered green OK button
    const okW = 140 * (g.scale / 1.21), okH = 64 * (g.scale / 1.21);
    const okX = g.px + g.sw + (g.pw - g.sw) / 2 - okW / 2;
    const okY = g.py + g.ph - 68 * (g.scale / 1.21);
    if (p.x >= okX && p.x <= okX + okW && p.y >= okY && p.y <= okY + okH) {
      this.close();
      return;
    }

    // 3. Click outside paper area
    if (p.x < g.px || p.x > g.px + g.pw || p.y < g.py || p.y > g.py + g.ph) {
      this.close();
      return;
    }

    // 4. Tabs on the left spine
    const spineStartY = g.py + 85 * g.scale;
    const tabH = 64 * g.scale;
    const tabGap = 10 * g.scale;
    const minTouch = 44 * E.W / E.logicalRect().width;
    const tabs=this.tabs();
    for (let i = 0; i < tabs.length; i++) {
      const ty = spineStartY + i * (tabH + tabGap);
      const hitH = Math.max(tabH, minTouch);
      if (p.x >= g.px && p.x <= g.px + g.sw
        && p.y >= ty + (tabH - hitH) / 2 && p.y <= ty + (tabH + hitH) / 2) {
        this.switchTab(tabs[i].id);
        return;
      }
    }

    const safe = this.contentRect(g);
    if (p.x < safe.x || p.x > safe.x + safe.w || p.y < safe.y || p.y > safe.y + safe.h) return;

    if (this.activeTab === 'theater') { this.theaterPanel.down(p); return; }

    // 5. Situation Tab interactions
    if (this.activeTab === 'situation') {
      const body = this.bodyRect(g);
      this.situationPanel.down(p, body.x, body.y, body.w, body.h, g.scale);
      return;
    }

    // 6. Diplomacy Tab interactions
    if (this.activeTab === 'diplomacy') {
      const list = this.otherCountries;
      const dg = this.diplomacyGeom(g);
      const player = this.game.player;
      const allStageCountries = this.game.stage.data.countries;

      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.eliminated || this.game.stage.countries.get(c.id)?.eliminated) continue;
        const ry = dg.startY + i * dg.rowH - this.scroll;
        if (ry + dg.rowH < dg.listTop || ry > dg.cy + dg.ch) continue;
        if (ry + 10 * dg.s < dg.listTop) continue;

        const rel = getDiplomaticRelation(this.game, player, c.id);
        const btnY = ry + 10 * dg.s;
        const hitBtn = (x) => p.x >= x && p.x <= x + dg.btnW && p.y >= btnY && p.y <= btnY + dg.btnH;
        const cName = formatCountryDisplayName(c, false, allStageCountries);
        const nap = hasNap(this.game, player, c.id);
        const truce = this.truceLeft(player, c.id);

        if (rel === DIPLOMACY_STATE.WAR) {
          if (hitBtn(dg.btn1X)) {
            const bill = this.reparationsBill(player, c.id);
            this.confirmDialog = {
              title: `向 ${cName} 签署和约？`,
              content: `对方可能拒绝此和约。\n赔款 $${bill.paid}、工业 ${bill.industry}\n（对方在本次战争中损失部队造价的 ${bill.rate.toFixed(1)} 倍，必须全额支付，不足部分记为负债）\n并扣除稳定度 10 点。`,
              onConfirm: () => {
                this.game.apply({ type: 'setDiplomacy', first: player, second: c.id, state: 'peace', reason: 'player_action' });
                if (getDiplomaticRelation(this.game, player, c.id) === DIPLOMACY_STATE.WAR) {
                  this.showRejectNotice(cName, '求和');
                }
              }
            };
            return;
          }
        } else if (rel === DIPLOMACY_STATE.ALLIANCE) {
          if (hitBtn(dg.btn1X)) {
            const cascadeIds = this.game.warCascade ? this.game.warCascade(player, c.id) : warCascade(this.game, player, c.id);
            const cascadedCountries = cascadeIds.map(id => allStageCountries.find(x => x.id === id) || { id, name: id });
            this.confirmDialog = {
              title: `向盟国 ${cName} 宣战？`,
              content: `退出同盟并宣战将扣除国家稳定度 20 点。\n确认宣战？`,
              cascadedCountries,
              onConfirm: () => {
                this.game.apply({ type: 'setDiplomacy', first: player, second: c.id, state: 'war', reason: 'player_action' });
              }
            };
            return;
          }
        } else {
          if (hitBtn(dg.btn1X)) {
            if (truce > 0) {
              this.confirmDialog = {
                title: `停战期内不可对 ${cName} 宣战`,
                content: `双方仍处于停战期，剩余 ${truce} 回合后才能再次宣战。`,
                ackOnly: true,
              };
              return;
            }
            const cascadeIds = this.game.warCascade ? this.game.warCascade(player, c.id) : warCascade(this.game, player, c.id);
            const cascadedCountries = cascadeIds.map(id => allStageCountries.find(x => x.id === id) || { id, name: id });
            this.confirmDialog = nap ? {
              title: `向 ${cName} 宣战？`,
              content: `稳定度 −20\n确认宣战？`,
              warning: '撕毁互不侵犯条约',
              cascadedCountries,
              onConfirm: () => {
                this.game.apply({ type: 'setDiplomacy', first: player, second: c.id, state: 'war', reason: 'player_action' });
              }
            } : {
              title: `向 ${cName} 宣战？`,
              content: `宣战将扣除国家稳定度 12 点，并立即进入交战状态。\n确认宣战？`,
              cascadedCountries,
              onConfirm: () => {
                this.game.apply({ type: 'setDiplomacy', first: player, second: c.id, state: 'war', reason: 'player_action' });
              }
            };
            return;
          }
          if (hitBtn(dg.btn2X)) {
            this.confirmDialog = {
              title: `向 ${cName} 递交国书？`,
              content: `递交国书，对方可能拒绝。\n一旦缔结同盟，双方将共享前线视野并协同作战。`,
              onConfirm: () => {
                this.game.apply({ type: 'setDiplomacy', first: player, second: c.id, state: 'alliance', reason: 'player_action' });
                if (getDiplomaticRelation(this.game, player, c.id) !== DIPLOMACY_STATE.ALLIANCE) {
                  this.showRejectNotice(cName, '结盟');
                }
              }
            };
            return;
          }
          if (!nap && hitBtn(dg.btn3X)) {
            this.confirmDialog = {
              title: `向 ${cName} 提议互不侵犯？`,
              content: `递交互不侵犯条约草案，对方可能拒绝。\n若签署，撕毁后再宣战将付出与背盟相当的稳定度代价。`,
              onConfirm: () => {
                this.game.apply({ type: 'proposeDiplomacy', first: player, second: c.id, action: 'nap', reason: 'player_action' });
                if (!hasNap(this.game, player, c.id)) {
                  this.showRejectNotice(cName, '互不侵犯');
                }
              }
            };
            return;
          }
        }
      }
      this.drag = { y: p.y, scroll: this.scroll };
      return;
    }

    // 7. Events Tab interactions
    if (this.activeTab === 'events') {
      const s = g.scale, { x: bx, y: by, w: cw, h: ch } = this.bodyRect(g);
      const nw = Math.min(cw - 20 * s, 720 * (s / 1.21));
      const nh = Math.min(ch - 10 * s, 340 * (s / 1.21));
      const x = bx + (cw - nw) / 2 + 25 * s;
      const y = by + (ch - nh) / 2 + 25 * (s / 1.21);
      if (p.y >= y - 15 * s && p.y <= y + 15 * s) {
        const filters = ['all', 'diplomacy', 'military', 'scenario'];
        const index = Math.floor((p.x - x + 15 * s) / (68 * s));
        if (index >= 0 && index < filters.length) { this.reportFilter = filters[index]; this.scroll = 0; return; }
        if (this.reportFilter === 'diplomacy') {
          const subX = x + 4 * 68 * s + 10 * s;
          if (p.x >= subX - 8 * s && p.x <= subX + 115 * s) {
            this.diplomacyOnlyMine = !this.diplomacyOnlyMine;
            this._reportRowsCache = null;
            this._reportLayout = null;
            this.scroll = 0;
            return;
          }
        }
      }
      const paperX = bx + (cw - nw) / 2;
      const paperY = by + (ch - nh) / 2;
      if (p.x >= paperX + 12 * s && p.x <= paperX + nw - 12 * s) {
        const listY = paperY + 59 * (s / 1.21);
        const row = this.reportLayout(E.ctx, s, nw).rows.find(item => item.kind === 'openingSetupGroup' &&
          p.y >= listY + item.y - this.scroll && p.y <= listY + item.y + item.height - this.scroll);
        if (row) { this.openingExpanded = !this.openingExpanded; this._reportLayout = null; this.scroll = 0; return; }
      }
      this.drag = { y: p.y, scroll: this.scroll };
      return;
    }

    // 8. Signature and revocation use the same delegation entry points as the old checkbox.
    if (this.activeTab === 'autoplay') {
      const r = this.signatureGeom(g);
      const hit = box => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
      const state = this.battle.zhengwuSignature;
      if (this.battle.autoPlayer.enabled && hit(r.revoke)) {
        this.battle.stopAutoPlay();
        state.authorized = false;
        state.revokedAt = performance.now();
        this.signatureHintUntil = 0;
        return;
      }
      if (hit(r) && !this.battle.autoPlayer.enabled && state.revokedAt == null) {
        this.drag = null;
        const point = this.signaturePoint(p, r);
        this.signatureStroke = { points: [point], length: 0, minX: point.x, maxX: point.x };
        state.strokes.push(this.signatureStroke);
        this.signatureHintUntil = 0;
      }
    }
  }

  // Runtime must not convert handwriting into touch scrolling or map pinching.
  get ownTouch() { return this.activeTab === 'autoplay'; }
  pinch() { this.cancelGesture(); }

  signatureGeom(g = this.geom()) {
    const s = g.scale;
    const center = g.px + g.sw + (g.pw - g.sw) / 2;
    return { x: center - 145 * s, y: g.py + 252 * s, w: 340 * s, h: 82 * s,
      revoke: { x: center + 215 * s, y: g.py + 309 * s, w: 100 * s, h: 30 * s } };
  }

  signaturePoint(p, r) {
    return { x: (p.x - r.x) * 340 / r.w, y: (p.y - r.y) * 82 / r.h,
      t: performance.now(), width: 2.6 };
  }

  appendSignaturePoint(p) {
    const stroke = this.signatureStroke;
    if (!stroke || stroke.leftArea || !p) return;
    const r = this.signatureGeom();
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) {
      stroke.leftArea = true; // Keep ownership until release; never bridge an excursion outside the paper.
      return;
    }
    const point = this.signaturePoint(p, r);
    const last = stroke.points[stroke.points.length - 1];
    const distance = Math.hypot(point.x - last.x, point.y - last.y);
    if (distance < 0.65) return;
    const speed = distance / Math.max(1, point.t - last.t);
    point.width = last.width * 0.55 + (0.85 + 2.6 / (1 + speed * 2.5)) * 0.45;
    stroke.points.push(point);
    stroke.length += distance;
    stroke.minX = Math.min(stroke.minX, point.x);
    stroke.maxX = Math.max(stroke.maxX, point.x);
  }

  finishSignature(p) {
    this.appendSignaturePoint(p);
    this.signatureStroke = null;
    const state = this.battle.zhengwuSignature;
    const strokes = state.strokes.filter(stroke => stroke.length >= 2);
    const length = strokes.reduce((total, stroke) => total + stroke.length, 0);
    const valid = length >= 340 * 0.4 && (strokes.length >= 2 || strokes.some(stroke => stroke.maxX - stroke.minX > 340 * 0.5));
    if (!valid) {
      this.signatureHintUntil = performance.now() + 1800;
      return;
    }
    this.battle.startAutoPlay();
    if (this.battle.autoPlayer.enabled) {
      state.authorized = true;
      this.signatureStampAt = performance.now();
      E.playSfx('pop.wav');
    }
  }

  cancelGesture() {
    this.situationPanel.up();
    if (this.signatureStroke) {
      const strokes = this.battle.zhengwuSignature.strokes;
      const index = strokes.indexOf(this.signatureStroke);
      if (index >= 0) strokes.splice(index, 1);
      this.signatureStroke = null;
    }
    this.drag = null;
  }

  getMaxScroll() {
    const g = this.geom();
    const s = g.scale;
    const contentH = g.ph - 165 * s;
    if (this.activeTab === 'situation') {
      const report = buildSituationReport(this.game, this.sortType);
      const rowH = this.situationRowH(s);
      return Math.max(0, report.rows.length * rowH - contentH + 40 * s);
    } else if (this.activeTab === 'diplomacy') {
      const dg = this.diplomacyGeom(g);
      const listH = (dg.cy + dg.ch) - dg.listTop;
      return Math.max(0, this.otherCountries.length * dg.rowH - listH + 24 * s);
    } else if (this.activeTab === 'events') {
      const { w: cw, h: ch } = this.bodyRect(g);
      const nw = Math.min(cw - 20 * s, 720 * (s / 1.21));
      const nh = Math.min(ch - 10 * s, 340 * (s / 1.21));
      return Math.max(0, this.reportLayout(E.ctx, s, nw).height - (nh - 75 * (s / 1.21)));
    }
    return 0;
  }

  move(p) {
    if (this.activeTab === 'situation') { this.situationPanel.move(p); return; }
    if (this.activeTab === 'theater') this.theaterPanel.move(p);
    if (this.signatureStroke) {
      if (!E.pointer.down) this.cancelGesture();
      else this.appendSignaturePoint(p);
      return;
    }
    if (this.drag) {
      const dy = p.y - this.drag.y;
      const max = this.getMaxScroll();
      this.scroll = Math.max(0, Math.min(max, this.drag.scroll - dy));
    }
  }

  up(p) {
    if (this.activeTab === 'situation') { this.situationPanel.up(); return; }
    if (this.activeTab === 'theater') this.theaterPanel.up(p);
    if (this.signatureStroke) this.finishSignature(p);
    this.drag = null;
  }

  wheel(delta) {
    if (this.activeTab === 'situation') { this.situationPanel.wheel(delta); return; }
    if (this.activeTab === 'theater') { this.theaterPanel.wheel(delta); return; }
    const max = this.getMaxScroll();
    this.scroll = Math.max(0, Math.min(max, this.scroll + delta));
  }

  key(e) {
    if (e.key === 'Escape' && this.activeTab === 'theater' && this.theaterPanel.menu) { this.theaterPanel.menu=null; return; }
    // Esc or Zhengwu hotkey closes the panel
    if (e.key === 'Escape' || (E.hotkeys && E.hotkeys.match(e) === 'zhengwu')) {
      if (this.confirmDialog) {
        this.confirmDialog = null;
        E.playSfx('cancel.wav');
        return;
      }
      this.close();
      return;
    }

    // 1-4 number keys to switch tabs
    if (e.key === '1') { this.switchTab('situation'); return; }
    if (e.key === '2') { this.switchTab((this.game.spectating || this.game.bridgeSpectating)?'events':'diplomacy'); return; }
    if (e.key === '3'&&!(this.game.spectating || this.game.bridgeSpectating)) { this.switchTab('events'); return; }
    if (e.key === '4'&&!(this.game.spectating || this.game.bridgeSpectating)) { this.switchTab('autoplay'); return; }

    // Arrow keys to navigate tabs
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const tabs=this.tabs(),curIdx = tabs.findIndex(t => t.id === this.activeTab);
      const nextIdx = e.key === 'ArrowUp' ? Math.max(0, curIdx - 1) : Math.min(tabs.length - 1, curIdx + 1);
      this.switchTab(tabs[nextIdx].id);
      return;
    }
  }

  update(dt) {
    // Blur / lost capture is dispatched to Battle, so also release our local gesture here.
    if (this.signatureStroke && !E.pointer.down) this.cancelGesture();
    const state = this.battle.zhengwuSignature;
    if (state.revokedAt != null && performance.now() - state.revokedAt >= 650) {
      state.strokes = [];
      state.revokedAt = null;
    }
    if (state.authorized && !this.battle.autoPlayer.enabled) {
      state.authorized = false;
      state.revokedAt = performance.now();
    }
  }

  draw() {
    const c = E.ctx;
    const g = this.geom();
    this._traitHits = [];
    const ui1 = this.battle.ui1;
    const now = performance.now();

    // 0.2s smooth fade-in
    const progress = Math.min(1, (now - this.t0) / 200);
    const alpha = progress;

    c.save();
    c.globalAlpha = alpha;

    // 1. Darkened map backdrop (45% opacity)
    c.fillStyle = 'rgba(0, 0, 0, 0.45)';
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:558').fillRect(0, 0, g.W, g.H);

    // 2. Main paper board: board_common@2x.webp (1024x530 centered)
    if (this.assets.boardCommon) {
      // The source's right and bottom pixels are a transparent drop shadow.
      // Crop to the opaque leather rim so its visible edges match barRect.
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:562').drawImage(this.assets.boardCommon,
        40, 0, 940, 505, g.boardRect.x, g.boardRect.y, g.boardRect.w, g.boardRect.h);
    } else {
      E.panel(g.px, g.py, g.pw, g.ph, { fill: '#e6dac0', stroke: '#56381e', lineWidth: 4, r: 8 });
    }

    // 3. Left leather spine: board_selbattle@2x.webp
    if (this.assets.boardSelbattle) {
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:569').drawImage(this.assets.boardSelbattle,
        g.barRect.x, g.barRect.y, g.barRect.w, g.barRect.h);
    } else {
      E.panel(g.px, g.py, g.sw, g.ph, { fill: '#281a0e', stroke: '#56381e', lineWidth: 3, r: 6 });
    }

    // 4. Vertical tabs on spine
    const spineStartY = g.py + 85 * g.scale;
    const tabH = 64 * g.scale;
    const tabGap = 10 * g.scale;
    const tabs=this.tabs();
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const ty = spineStartY + i * (tabH + tabGap);
      const isSelected = this.activeTab === tab.id;

      if (isSelected) {
        const selected = this.selectedTabRect(g, i);
        const tabX = selected.x, tabW = selected.w;
        // 2px shadow
        c.fillStyle = 'rgba(0,0,0,0.35)';
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:589').beginPath();
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:590').roundRect(tabX + 2, ty + 2, tabW, tabH, [6, 12, 12, 6]);
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:591').fill();
        // Paper background
        c.fillStyle = '#efdcb0';
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:594').beginPath();
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:595').roundRect(tabX, ty, tabW, tabH, [6, 12, 12, 6]);
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:596').fill();
        c.strokeStyle = '#5a3b1d';
        c.lineWidth = 1.2;
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:599').stroke();

        // Ink text
        E.text(tab.label, tabX + tabW / 2, ty + tabH / 2, {
          size: Math.round(26 * g.scale),
          bold: true,
          align: 'center',
          base: 'middle',
          font: SERIF,
          color: '#2a1d12',
        });
      } else {
        // Gold foil text on leather with 1px dark shadow
        E.text(tab.label, g.px + g.sw / 2, ty + tabH / 2, {
          size: Math.round(26 * g.scale),
          bold: true,
          align: 'center',
          base: 'middle',
          font: SERIF,
          color: '#e8c989',
          stroke: '#2a1608',
          strokeW: 2,
        });
      }
    }

    // 5. All page content shares the paper's safe bounds.
    const safe = this.contentRect(g), body = this.bodyRect(g);
    c.save(); c.beginPath(); c.rect(safe.x, safe.y, safe.w, safe.h); c.clip();
    const titleX = safe.x + safe.w / 2;
    const titleText = {
      situation: '局 势 总 览',
      diplomacy: '外 交 公 署',
      events: '战 况 简 报',
      theater: '\u6218 \u533a \u6307 \u6325',
      autoplay: '委 任 参 谋',
    }[this.activeTab];

    // Main title
    E.text(titleText, titleX, g.py + 56 * g.scale, {
      size: Math.round(36 * g.scale),
      bold: true,
      align: 'center',
      base: 'middle',
      font: SERIF,
      color: '#2a1d12',
    });

    // Subtitle flanked by thin lines
    const subText = `第 ${this.game.round} 回合 · ${this.game.info?.age || '1939.9'}`;
    const subY = g.py + 90 * g.scale;
    E.text(subText, titleX, subY, {
      size: Math.round(18 * g.scale),
      font: SERIF,
      align: 'center',
      base: 'middle',
      color: '#6b4f33',
    });
    // Flanking lines
    c.save();
    c.strokeStyle = 'rgba(90, 60, 30, 0.45)';
    c.lineWidth = 1;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:658').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:659').moveTo(titleX - 220 * g.scale, subY);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:660').lineTo(titleX - 110 * g.scale, subY);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:661').moveTo(titleX + 110 * g.scale, subY);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:662').lineTo(titleX + 220 * g.scale, subY);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:663').stroke();
    c.restore();

    // 6. Draw Content Area (Clipped within paper borders)
    const contentX = body.x, contentY = body.y;
    const contentW = body.w, contentH = body.h;

    c.save();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:673').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:674').rect(contentX, contentY, contentW, contentH);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js/clip').clip();

    if (this.activeTab === 'theater') {
      E.layout.region('battle/theater/panel', {x:contentX,y:contentY,w:contentW,h:contentH}, () => this.theaterPanel.draw(c, g, contentX, contentY, contentW, contentH));
    } else if (this.activeTab === 'situation') {
      this.situationPanel.draw(c, contentX, contentY, contentW, contentH, g.scale);
    } else if (this.activeTab === 'diplomacy') {
      this.drawDiplomacy(c, g, contentX, contentY, contentW, contentH);
    } else if (this.activeTab === 'events') {
      this.drawEvents(c, g, contentX, contentY, contentW, contentH);
    } else if (this.activeTab === 'autoplay') {
      this.drawAutoplay(c, g, contentX, contentY, contentW, contentH);
    }
    c.restore();
    this.drawTraitTooltip(c);
    c.restore();

    // 7. Bottom Centered Green OK Button (Opening Briefing style)
    const okW = 140 * (g.scale / 1.21), okH = 64 * (g.scale / 1.21);
    const okX = titleX - okW / 2;
    const okY = g.py + g.ph - 68 * (g.scale / 1.21);
    const okHover = E.pointer.x >= okX && E.pointer.x <= okX + okW && E.pointer.y >= okY && E.pointer.y <= okY + okH;
    const okDy = okHover && E.pointer.down ? 2 : 0;
    E.layout.button({x:okX,y:okY,w:okW,h:okH,label:'确认',layoutInput:true}, 'battle/chain_menu/close');

    if (ui1 && ui1.green_normal && ui1.buttontext_ok) {
      E.drawFrame(ui1.green_normal, okX, okY + okDy, {
        sx: okW / ui1.green_normal.w,
        sy: okH / ui1.green_normal.h,
        noRef: true,
        filter: okHover ? 'brightness(1.1)' : 'none'
      });
      const tw = ui1.buttontext_ok.w * 0.85 * (g.scale / 1.21);
      const th = ui1.buttontext_ok.h * 0.85 * (g.scale / 1.21);
      E.drawFrame(ui1.buttontext_ok, okX + (okW - tw) / 2, okY + (okH - th) / 2 + okDy, {
        sx: tw / ui1.buttontext_ok.w,
        sy: th / ui1.buttontext_ok.h,
        noRef: true
      });
    } else {
      E.panel(okX, okY + okDy, okW, okH, { fill: '#3d6e24', stroke: '#d8b66c', lineWidth: 2, r: 6 });
      E.text('✓', okX + okW / 2, okY + okH / 2 + okDy, { size: 30, color: '#fff', bold: true, align: 'center', base: 'middle' });
    }

    // 8. Confirm Dialog Modal if open
    if (this.confirmDialog) {
      this.drawConfirmModal(c, g);
    }

    c.restore();
  }

  // ---- Situation Page ----
  drawSituation(c, g, cx, cy, cw, ch) {
    const report = buildSituationReport(this.game, this.sortType);
    const rows = report.rows;
    const s = g.scale;

    // 1. Sort Dimension Text Links: "按 综合实力 · 领地 · 军力 · 经济"
    const sortY = cy + 6 * s;
    const titleX = g.px + g.sw + (g.pw - g.sw) / 2;
    E.text('按', titleX - 180 * s, sortY, { size: Math.round(17 * s), font: SERIF, color: '#6b4f33', base: 'middle' });

    const startX = titleX - 150 * s;
    let curX = startX;
    for (let i = 0; i < SITUATION_SORTS.length; i++) {
      const item = SITUATION_SORTS[i];
      const isSelected = this.sortType === item.id;
      const itemW = item.label.length * (17 * s);

      E.text(item.label, curX, sortY, {
        size: Math.round(17 * s),
        bold: isSelected,
        font: SERIF,
        color: isSelected ? '#2a1d12' : '#6b4f33',
        base: 'middle'
      });

      if (isSelected) {
        // Underline for active sort
        c.save();
        c.strokeStyle = '#2a1d12';
        c.lineWidth = 1.5;
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:754').beginPath();
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:755').moveTo(curX - 2, sortY + 11 * s);
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:756').lineTo(curX + itemW + 2, sortY + 11 * s);
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:757').stroke();
        c.restore();
      }

      curX += itemW;

      if (i < SITUATION_SORTS.length - 1) {
        const gap = 20 * s;
        const dotX = curX + gap / 2;
        E.text('·', dotX, sortY, {
          size: Math.round(18 * s),
          font: SERIF,
          color: '#8c6b4b',
          align: 'center',
          base: 'middle'
        });
        curX += gap;
      }
    }

    // 2. Table Headers (No background, dark brown serif)
    const headerY = cy + 34 * s;
    const colRank = cx + 22 * s;
    const colName = cx + 80 * s;
    const colArea = cx + 320 * s;
    const colArmy = cx + 420 * s;
    const colEco = cx + 520 * s;
    const colStab = cx + 630 * s;

    const hOpt = { size: Math.round(17 * s), bold: true, font: SERIF, color: '#4a3018', base: 'middle' };
    E.text('名次', colRank, headerY, hOpt);
    E.text('国家', colName, headerY, hOpt);
    E.text('领地', colArea, headerY, hOpt);
    E.text('军力', colArmy, headerY, hOpt);
    E.text('经济', colEco, headerY, hOpt);
    E.text('稳定度', colStab, headerY, hOpt);

    // 1px dividing line under headers
    c.save();
    c.strokeStyle = 'rgba(90, 60, 30, 0.35)';
    c.lineWidth = 1;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:798').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:799').moveTo(cx + 10 * s, headerY + 14 * s);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:800').lineTo(cx + cw - 10 * s, headerY + 14 * s);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:801').stroke();
    c.restore();

    // 3. Table Rows clipped below the header
    const rowH = this.situationRowH(s);
    const traitLayout = !!this.game?.diplomacy?.enabled;
    const listTop = headerY + 16 * s;
    const listH = (cy + ch) - listTop;

    c.save();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:811').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:812').rect(cx, listTop, cw, listH);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js/clip').clip();

    const allStageCountries = this.game.stage.data.countries;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = listTop + 4 * s + i * rowH - this.scroll;
      if (ry + rowH < listTop || ry > listTop + listH) continue;

      // Rank
      E.text(`${i + 1}.`, colRank, ry + rowH / 2, {
        size: Math.round(16 * s),
        font: E.NUM || 'sans-serif',
        bold: true,
        color: '#6b4f33',
        base: 'middle'
      });

      // Clear flag from flag_hd (fallback to armyAtlas)
      const flagKey = 'flag_' + (r.flag || r.id);
      const cleanKey = 'flag_' + (r.flag || r.id || '').replace(/\d+$/, '');
      const flagH = 22 * (s / 1.21);
      const fFrame = (this.assets.flagAtlas && (this.assets.flagAtlas[flagKey] || this.assets.flagAtlas[cleanKey]))
        || (this.assets.armyAtlas && (this.assets.armyAtlas[flagKey] || this.assets.armyAtlas[cleanKey]));
      if (fFrame) {
        const flagScale = flagH / (fFrame.h || 68);
        E.drawFrame(fFrame, colName, ry + rowH / 2 - flagH / 2, {
          scale: flagScale,
          noRef: true,
        });
      }

      // Country Display Name
      const cObj = allStageCountries.find(x => x.id === r.id) || { id: r.id, flag: r.flag, name: r.name };
      const displayName = formatCountryDisplayName(cObj, r.isPlayer, allStageCountries);
      const nameX = colName + 38 * s;
      const isActuallyDefeated = r.areaCount === 0 || r.defeated === true;
      const nameY = traitLayout ? ry + rowH * 0.34 : ry + rowH / 2;

      E.text(isActuallyDefeated ? `${displayName} · 灭国` : displayName, nameX, nameY, {
        size: Math.round(18 * s),
        bold: r.isPlayer,
        font: SERIF,
        color: isActuallyDefeated ? '#8b1e16' : '#2a1d12',
        base: 'middle'
      });

      // If Player: Red wavy underline + small "我方" mark
      if (r.isPlayer) {
        c.save();
        c.strokeStyle = '#a3322a'; // Hand-drawn red pencil
        c.lineWidth = 1.8;
        const textWidth = displayName.length * 18 * s;
        const waveY = nameY + 12 * s;
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:867').beginPath();
        for (let x = 0; x <= textWidth; x += 3) {
          const dy = Math.sin(x * 0.45) * 1.5 + (Math.sin(x * 1.2) * 0.6);
          if (x === 0) E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:870').moveTo(nameX + x, waveY + dy);
          else E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:871').lineTo(nameX + x, waveY + dy);
        }
        E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:873').stroke();
        c.restore();

        // Small "★我方" mark
        E.text('★我方', nameX + textWidth + 8 * s, nameY, {
          size: Math.round(14 * s),
          bold: true,
          font: SERIF,
          color: '#a3322a',
          base: 'middle'
        });
      }

      if (traitLayout) {
        this.drawTraitChips(c, nameX, ry + rowH * 0.74, this.traitView(r.id), s, Math.max(40, colArea - nameX - 8 * s));
      }

      // Territory
      E.text(String(r.areaCount), colArea, ry + rowH / 2, {
        size: Math.round(17 * s),
        font: E.NUM || 'sans-serif',
        color: '#2a1d12',
        base: 'middle'
      });

      // Army Power
      E.text(String(r.armyCount), colArmy, ry + rowH / 2, {
        size: Math.round(17 * s),
        font: E.NUM || 'sans-serif',
        color: '#2a1d12',
        base: 'middle'
      });

      // Economy
      const totalEco = Math.max(0, r.money) + Math.max(0, r.industry);
      E.text(`$${totalEco}`, colEco, ry + rowH / 2, {
        size: Math.round(17 * s),
        font: E.NUM || 'sans-serif',
        color: '#2a1d12',
        base: 'middle'
      });

      // Stability
      const stab = this.game.getStability ? this.game.getStability(r.id) : (r.stability ?? 100);
      E.text(String(stab), colStab, ry + rowH / 2, {
        size: Math.round(17 * s),
        bold: true,
        font: E.NUM || 'sans-serif',
        color: stab < 30 ? '#8b1e16' : '#2a1d12',
        base: 'middle'
      });

      // 1px dividing line
      c.save();
      c.strokeStyle = 'rgba(90, 60, 30, 0.28)';
      c.lineWidth = 1;
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:929').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:930').moveTo(cx + 10 * s, ry + rowH);
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:931').lineTo(cx + cw - 10 * s, ry + rowH);
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:932').stroke();
      c.restore();
    }
    c.restore();
  }

  drawTreatyStamp(c, x, y, text, color, s, rot = -10) {
    const fontSize = Math.round(13 * s);
    c.save();
    c.font = `bold ${fontSize}px ${SERIF}`;
    const textW = c.measureText(text).width;
    const padX = 11 * s, padY = 7 * s;
    const tw = textW + padX * 2;
    const th = fontSize + padY * 2;
    c.translate(x, y);
    c.rotate(rot * Math.PI / 180);
    c.globalAlpha = 0.88;
    c.strokeStyle = color;
    c.lineWidth = 1.8;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:951').strokeRect(-tw / 2, -th / 2, tw, th);
    c.lineWidth = 0.8;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:953').strokeRect(-tw / 2 + 2.5, -th / 2 + 2.5, tw - 5, th - 5);
    E.text(text, 0, 1, {
      size: fontSize, bold: true, font: SERIF, color, align: 'center', base: 'middle'
    });
    c.restore();
  }

  drawActionButton(ui1, x, y, w, h, label, kind, opts = {}) {
    return E.layout.region('battle/chain_menu/action/'+label,{x,y,w,h,label},()=>this.drawActionButtonContents(ui1,x,y,w,h,label,kind,opts),'button');
  }
  drawActionButtonContents(ui1, x, y, w, h, label, kind, opts = {}) {
    const disabled = !!opts.disabled;
    const hover = !disabled && E.pointer.x >= x && E.pointer.x <= x + w && E.pointer.y >= y && E.pointer.y <= y + h;
    const dy = hover && E.pointer.down ? 2 : 0;
    const frame = kind === 'red' ? ui1?.longred_normal : kind === 'green' ? ui1?.longgreen_normal : null;
    const ctx = E.ctx;
    ctx.save();
    if (disabled) ctx.globalAlpha = 0.38;
    if (frame) {
      E.drawFrame(frame, x, y + dy, { sx: w / frame.w, sy: h / frame.h, noRef: true });
    } else if (kind === 'seal') {
      ctx.fillStyle = '#7a4e24';
      ctx.strokeStyle = '#d8b66c';
      ctx.lineWidth = 1.6;
      E.layout.canvas(ctx, 'scenes/battle/ui/chain_menu.js:974').beginPath();
      E.layout.canvas(ctx, 'scenes/battle/ui/chain_menu.js:975').roundRect(x, y + dy, w, h, 5);
      E.layout.canvas(ctx, 'scenes/battle/ui/chain_menu.js:976').fill();
      E.layout.canvas(ctx, 'scenes/battle/ui/chain_menu.js:977').stroke();
    }
    E.text(label, x + w / 2, y + h / 2 + dy, {
      size: Math.round(opts.size || 15), bold: true, font: SERIF, align: 'center', base: 'middle',
      color: '#fff5dc', stroke: '#3a2410', strokeW: 2.4
    });
    ctx.restore();
    if (opts.caption) {
      const capS = opts.scale || 1;
      const capSize = Math.max(14, Math.round(14 * capS));
      E.text(opts.caption, x + w / 2, y + h + 12 * capS / 1.21, {
        size: capSize, font: SERIF, align: 'center', base: 'middle',
        color: opts.captionColor || '#8b1e16'
      });
    }
  }

  // ---- Diplomacy Page ----
  drawDiplomacy(c, g, cx, cy, cw, ch) {
    const list = this.otherCountries;
    const dg = this.diplomacyGeom(g);
    const s = dg.s;
    const player = this.game.player;
    const allStageCountries = this.game.stage.data.countries;
    const ui1 = this.battle.ui1;

    c.save();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1004').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1005').rect(cx, dg.listTop, cw, (cy + ch) - dg.listTop);
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js/clip').clip();

    for (let i = 0; i < list.length; i++) {
      const country = list[i];
      const ry = dg.startY + i * dg.rowH - this.scroll;
      if (ry + 8 * s < dg.listTop || ry > cy + ch) continue;

      const flagKey = 'flag_' + (country.flag || country.id);
      const cleanKey = 'flag_' + (country.flag || country.id || '').replace(/\d+$/, '');
      const flagH = 24 * (s / 1.21);
      const fFrame = (this.assets.flagAtlas && (this.assets.flagAtlas[flagKey] || this.assets.flagAtlas[cleanKey]))
        || (this.assets.armyAtlas && (this.assets.armyAtlas[flagKey] || this.assets.armyAtlas[cleanKey]));
      if (fFrame) {
        const flagScale = flagH / (fFrame.h || 68);
        E.drawFrame(fFrame, cx + 20 * s, ry + dg.rowH / 2 - flagH / 2, { scale: flagScale, noRef: true });
      }

      const displayName = formatCountryDisplayName(country, false, allStageCountries);
      const maxNameW = 250 * s;
      let displayStr = displayName;
      c.save();
      c.font = `bold ${Math.round(18 * s)}px ${SERIF}`;
      if (c.measureText(displayStr).width > maxNameW) {
        while (displayStr.length > 2 && c.measureText(displayStr + '…').width > maxNameW) {
          displayStr = displayStr.slice(0, -1);
        }
        displayStr += '…';
      }
      c.restore();

      const defeated = country.eliminated || this.game.stage.countries.get(country.id)?.eliminated;
      if (defeated) {
        E.text(`${displayStr} · 灭国`, cx + 66 * s, ry + dg.rowH / 2, {
          size: Math.round(18 * s), bold: true, font: SERIF, color: '#8b1e16', base: 'middle'
        });
        this.drawTreatyStamp(c, cx + 340 * s, ry + dg.rowH / 2, '灭 国', '#8b1e16', s, -12);
        continue;
      }
      const nap = hasNap(this.game, player, country.id);
      const truce = this.truceLeft(player, country.id);
      const hasTag = nap || truce > 0;
      const traitRow = this.traitView(country.id);
      const nameY = ry + dg.rowH / 2 + ((hasTag || traitRow) ? -16 * s : 0);

      E.text(displayStr, cx + 66 * s, nameY, {
        size: Math.round(18 * s),
        bold: true,
        font: SERIF,
        color: '#2a1d12',
        base: 'middle'
      });

      if (traitRow) {
        this.drawTraitChips(c, cx + 66 * s, nameY + 18 * s, traitRow, s, 230 * s);
      }

      if (hasTag) {
        const tags = [];
        if (nap) tags.push('互不侵犯');
        if (truce > 0) tags.push(`停战剩余 ${truce} 回合`);
        E.text(tags.join('  ·  '), cx + 66 * s, nameY + (traitRow ? 36 : 18) * s, {
          size: Math.round(13 * s),
          font: SERIF,
          color: nap && truce > 0 ? '#8b1e16' : nap ? '#6b3a12' : '#8b1e16',
          base: 'middle'
        });
      }

      const rel = getDiplomaticRelation(this.game, player, country.id);
      const stampText = rel === DIPLOMACY_STATE.WAR ? '交 战' : rel === DIPLOMACY_STATE.ALLIANCE ? '同 盟' : '中 立';
      const stampColor = rel === DIPLOMACY_STATE.WAR ? '#8b1e16' : rel === DIPLOMACY_STATE.ALLIANCE ? '#2f5d1e' : '#6b4f33';
      this.drawTreatyStamp(c, cx + 340 * s, ry + dg.rowH / 2, stampText, stampColor, s, -12);

      const btnY = ry + 10 * s;
      const { btnW, btnH, btn1X, btn2X, btn3X } = dg;

      const warCost = declareWarStabilityCost(this.game, player, country.id);
      if (rel === DIPLOMACY_STATE.WAR) {
        const bill = this.reparationsBill(player, country.id);
        this.drawActionButton(ui1, btn1X, btnY, btnW, btnH, '求 和', 'green', {
          caption: `${bill.rate.toFixed(1)}倍 赔$${bill.paid} 🔧${bill.industry}`,
          scale: s,
        });
      } else if (rel === DIPLOMACY_STATE.ALLIANCE) {
        this.drawActionButton(ui1, btn1X, btnY, btnW, btnH, '宣 战', 'red', {
          caption: `背盟−${warCost}`,
          scale: s,
        });
      } else {
        const warDisabled = truce > 0;
        this.drawActionButton(ui1, btn1X, btnY, btnW, btnH, '宣 战', 'red', {
          disabled: warDisabled,
          caption: warDisabled
            ? `停战余${truce}`
            : (nap ? `背约−${warCost}` : `稳−${warCost}`),
          captionColor: warDisabled ? '#6b4f33' : '#8b1e16',
          scale: s,
        });
        this.drawActionButton(ui1, btn2X, btnY, btnW, btnH, '结 盟', 'green', {
          caption: '或被拒',
          captionColor: '#2f5d1e',
          scale: s,
        });
        if (!nap) {
          this.drawActionButton(ui1, btn3X, btnY, btnW, btnH, '互不侵犯', 'seal', {
            caption: '或被拒',
            captionColor: '#6b3a12',
            scale: s,
            size: 13,
          });
        }
      }

      c.save();
      c.strokeStyle = 'rgba(90, 60, 30, 0.32)';
      c.lineWidth = 1;
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1114').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1115').moveTo(cx + 10 * s, ry + dg.rowH);
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1116').lineTo(cx + cw - 10 * s, ry + dg.rowH);
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1117').stroke();
      c.restore();
    }
    c.restore();
  }

  // ---- Events Page ----
  eventLines(c, text, maxW, fontSize) {
    c.save();
    c.font = `${fontSize}px ${SERIF}`;
    const res = [];
    let cur = '';
    for (const ch of text) {
      if (cur && c.measureText(cur + ch).width > maxW) {
        res.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) res.push(cur);
    c.restore();
    return res.length ? res : [''];
  }

  reportRows() {
    const cacheKey = `${this.reportFilter}:${this.diplomacyOnlyMine ? 1 : 0}:${this.openingExpanded}:${this.game.reportRevision || 0}:${this.game.scenarioEvents?.history?.length || 0}:${this.game.gameLog?.length || 0}`;
    if (this._reportRowsCache?.key === cacheKey && this._reportRowsCache.source === this.game.reportLog)
      return this._reportRowsCache.rows;
    const history = this.game.scenarioEvents?.history || [];
    const definitions = this.game.scenarioEvents?.definitions || [];
    const recorded = new Set((this.game.reportLog || []).map(row => row.detail?.scenarioId));
    const scenario = history.filter(id => !recorded.has(id)).map((id, index) => {
      const def = definitions.find(item => item.id === id);
      return { id: `scenario:${index}`, round: def?.round || index + 1, category: 'scenario',
        text: def ? `${def.title || '战略通报'}：${def.body || ''}` : `突发战地事件通报 [${id}]`, actors: [] };
    });
    const operationIds = new Set((this.game.reportLog || []).map(row => row.detail?.operationGameLogId));
    const operation = (this.game.gameLog || []).filter(entry => entry.event === 'operationReason' && !operationIds.has(entry.id))
      .map(entry => ({ id: `operation:${entry.id}`, round: entry.round || 1, category: 'operation',
        text: entry.data?.display || entry.data?.reason || '', actors: [] }));
    const all = foldOpeningReports([...(this.game.reportLog || []), ...scenario, ...operation], this.openingExpanded);
    const rows = all
      .filter(row => row.text && (this.reportFilter === 'all' || row.category === this.reportFilter))
      .filter(row => {
        if (this.reportFilter === 'diplomacy' && this.diplomacyOnlyMine) {
          return row.actors?.includes(this.game.player);
        }
        return true;
      });
    rows.sort((a, b) => (b.round || 0) - (a.round || 0) ||
      (typeof a.id === 'number' && typeof b.id === 'number' ? b.id - a.id : String(b.id).localeCompare(String(a.id))));
    this._reportRowsCache = { key: cacheKey, source: this.game.reportLog, rows };
    return rows;
  }

  reportLayout(c, s, nw) {
    const rows = this.reportRows(), unit = s / 1.21;
    const fontSize = Math.max(12, Math.round(13 * s));
    const tagFontSize = Math.max(10, Math.round(11 * s));
    const key = `${this.reportFilter}:${this.diplomacyOnlyMine ? 1 : 0}:${this.openingExpanded}:${this.game.reportRevision || 0}:${s}:${nw}:${rows.length}:${rows[0]?.id}:${rows[rows.length - 1]?.id}`;
    if (this._reportLayout?.key === key) return this._reportLayout;
    let height = 0;
    c.save();
    c.font = `bold ${tagFontSize}px ${SERIF}`;
    const laid = rows.map(row => {
      const tag = row.category === 'diplomacy' ? (DIPLOMACY_TAGS[row.source] || DIPLOMACY_TAGS.unclassified) : null;
      let tagW = 0;
      if (tag) {
        c.font = `bold ${tagFontSize}px ${SERIF}`;
        tagW = Math.round(c.measureText(tag.text).width + 8 * unit);
      }
      const textXOffset = tag ? tagW + 6 * unit : 0;
      const maxW = nw - 100 * unit - textXOffset - 25 * unit;
      const lines = this.eventLines(c, row.text, maxW, fontSize);
      const detailLines = row.category !== 'scenario' && row.detail?.scenarioText
        ? this.eventLines(c, row.detail.scenarioText, maxW, Math.max(11, fontSize - 2)) : [];
      const item = { ...row, tag, tagW, textXOffset, lines, detailLines, y: height,
        height: Math.max(34 * unit, (lines.length * 16 + detailLines.length * 14 + 8) * unit) };
      height += item.height;
      return item;
    });
    c.restore();
    return (this._reportLayout = { key, rows: laid, height, fontSize, tagFontSize });
  }

  drawEvents(c, g, cx, cy, cw, ch) {
    const s = g.scale, unit = s / 1.21;
    const nw = Math.min(cw - 20 * s, 720 * unit);
    const nh = Math.min(ch - 10 * s, 340 * unit);
    const nx = cx + (cw - nw) / 2, ny = cy + (ch - nh) / 2;
    c.save();
    c.translate(nx + nw / 2, ny + nh / 2);
    c.rotate(-0.0175);
    if (this.assets.chooseBoard) c.drawImage(this.assets.chooseBoard, -nw / 2, -nh / 2, nw, nh);
    else E.panel(-nw / 2, -nh / 2, nw, nh, { fill: '#faf3e3', stroke: '#8c6b4b', lineWidth: 2, r: 6 });
    c.beginPath(); c.rect(-nw / 2 + 10, -nh / 2 + 10, nw - 20, nh - 20); c.clip();
    const filters = [['all', '全部'], ['diplomacy', '外交'], ['military', '军事'], ['scenario', '剧本']];
    filters.forEach(([key, label], i) => {
      E.text(label, -nw / 2 + 25 * s + i * 68 * s, -nh / 2 + 25 * unit,
        { size: Math.max(12, 13 * s), font: SERIF, bold: key === this.reportFilter,
          color: key === this.reportFilter ? '#8b1e16' : '#6b5846', base: 'middle' });
    });
    if (this.reportFilter === 'diplomacy') {
      const subX = -nw / 2 + 25 * s + 4 * 68 * s + 10 * s;
      const active = !!this.diplomacyOnlyMine;
      const boxW = 100 * s, boxH = 22 * unit;
      c.save();
      c.fillStyle = active ? 'rgba(139, 30, 22, 0.12)' : 'rgba(0,0,0,0.03)';
      c.strokeStyle = active ? '#8b1e16' : '#a8947f';
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(subX, -nh / 2 + 25 * unit - boxH / 2, boxW, boxH, 4);
      c.fill();
      c.stroke();
      E.text(`${active ? '✓ ' : ''}只看涉及我国`, subX + boxW / 2, -nh / 2 + 25 * unit,
        { size: Math.max(11, 12 * s), font: SERIF, bold: active, align: 'center', base: 'middle',
          color: active ? '#8b1e16' : '#5c4a3b' });
      c.restore();
    }
    c.save(); c.beginPath(); c.rect(-nw / 2 + 12, -nh / 2 + 48 * unit, nw - 24, nh - 60 * unit); c.clip();
    const layout = this.reportLayout(c, s, nw), rows = layout.rows;
    const top = -nh / 2 + 59 * unit;
    const color = { diplomacy: '#285f91', military: '#9c322a', scenario: '#9b7429', operation: '#77716a' };
    for (const row of rows) {
      const y = top + row.y - this.scroll;
      if (y + row.height < -nh / 2 + 34 * unit || y > nh / 2) continue;
      const own = row.actors?.includes(this.game.player);
      if (own) {
        c.fillStyle = row.category === 'diplomacy' ? 'rgba(235, 185, 80, 0.22)' : 'rgba(217,175,81,.16)';
        c.fillRect(-nw / 2 + 12, y - 4 * unit, nw - 24, row.height);
        if (row.category === 'diplomacy') {
          c.fillStyle = '#b8860b';
          c.fillRect(-nw / 2 + 12, y - 4 * unit, 3 * unit, row.height);
        }
      }
      c.fillStyle = color[row.category] || '#77716a';
      c.fillRect(-nw / 2 + 18, y + 4 * unit, 4 * unit, 16 * unit);
      E.text(`第${row.round || 1}回合`, -nw / 2 + 28 * unit, y,
        { size: Math.max(11, 12 * s), font: SERIF, bold: true, color: color[row.category], base: 'middle' });

      if (row.tag) {
        const badgeX = -nw / 2 + 100 * unit;
        const badgeY = y - 9 * unit;
        const badgeH = 18 * unit;
        const badgeW = row.tagW;
        c.save();
        c.fillStyle = row.tag.bg;
        c.strokeStyle = row.tag.border;
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
        c.fill();
        c.stroke();
        E.text(row.tag.text, badgeX + badgeW / 2, y,
          { size: layout.tagFontSize, font: SERIF, bold: true, align: 'center', base: 'middle', color: row.tag.color });
        c.restore();
      }

      const textLeft = -nw / 2 + 100 * unit + (row.textXOffset || 0);
      for (let j = 0; j < row.lines.length; j++)
        E.text(row.lines[j], textLeft, y + j * 16 * unit,
          { size: layout.fontSize, font: SERIF, color: '#2a1d12', base: 'middle' });
      for (let j = 0; j < row.detailLines.length; j++)
        E.text(row.detailLines[j], textLeft, y + (row.lines.length * 16 + j * 14) * unit,
          { size: Math.max(11, layout.fontSize - 2), font: SERIF, color: '#766a5c', base: 'middle' });
    }
    if (!rows.length) E.text('暂无战报。', -nw / 2 + 28 * unit, top,
      { size: Math.max(13, 14 * s), font: SERIF, color: '#6b5846', base: 'middle' });
    c.restore();
    c.restore();
  }

  // ---- Autoplay Page ----
  drawAutoplay(c, g, cx, cy, cw, ch) {
    const s = g.scale;
    const isAuto = this.battle.autoPlayer.enabled;

    // Centered delegation document
    const titleX = g.px + g.sw + (g.pw - g.sw) / 2;

    E.text('战区委任参谋授权指令书', titleX, cy + 30 * s, {
      size: Math.round(24 * s), bold: true, font: SERIF, align: 'center', base: 'middle', color: '#2a1d12'
    });

    const descLines = [
      '委任陆海空战区前线参谋部自主裁决战役战术。',
      '参谋部将依照各兵种射程、机动力及克制关系，自动执行战术走位、攻击与领地接管。',
      '玩家可随时在对局中终止委任，重掌三军统帅全权指挥。'
    ];
    for (let i = 0; i < descLines.length; i++) {
      E.text(descLines[i], titleX, cy + 72 * s + i * 26 * s, {
        size: Math.round(16 * s), font: SERIF, align: 'center', base: 'middle', color: '#6b4f33'
      });
    }

    const r = this.signatureGeom(g);
    const state = this.battle.zhengwuSignature;
    const now = performance.now();
    const revoking = state.revokedAt != null;
    E.text('指挥官签署：', r.x - 12 * s, r.y + r.h - 15 * s, {
      size: Math.round(18 * s), font: SERIF, color: '#2a1d12', align: 'right', base: 'middle'
    });
    E.layout.region('battle/chain_menu/signature', { ...r, label: '指挥官签名栏' }, () => {
      E.text('签名处', r.x + r.w / 2, r.y + r.h / 2, {
        size: Math.round(25 * s), font: SERIF, color: 'rgba(90,60,30,0.13)', align: 'center', base: 'middle'
      });
      c.save();
      const line = E.layout.canvas(c, 'battle/chain_menu/signature/line');
      c.strokeStyle = 'rgba(75,50,28,0.55)'; c.lineWidth = s;
      line.beginPath(); line.moveTo(r.x, r.y + r.h); line.lineTo(r.x + r.w, r.y + r.h); line.stroke();
      const ink = E.layout.canvas(c, 'battle/chain_menu/signature/ink');
      ink.beginPath(); ink.rect(r.x, r.y, r.w, r.h); ink.clip();
      c.strokeStyle = '#172d40'; c.fillStyle = 'rgba(15,34,51,0.88)';
      c.lineCap = 'round'; c.lineJoin = 'round';
      const xy = p => ({ x: r.x + p.x * s, y: r.y + p.y * s });
      for (const stroke of state.strokes) {
        const pts = stroke.points;
        if (!pts.length) continue;
        let start = xy(pts[0]);
        for (let i = 1; i < pts.length; i++) {
          const prev = xy(pts[i - 1]), next = xy(pts[i]);
          const end = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
          c.lineWidth = (pts[i - 1].width + pts[i].width) / 2 * s;
          ink.beginPath(); ink.moveTo(start.x, start.y);
          ink.quadraticCurveTo(prev.x, prev.y, end.x, end.y); ink.stroke();
          start = end;
        }
        const last = xy(pts[pts.length - 1]);
        c.lineWidth = pts[pts.length - 1].width * s;
        ink.beginPath(); ink.moveTo(start.x, start.y); ink.lineTo(last.x, last.y); ink.stroke();
        // A restrained ink bead at each pen-down / pen-up.
        for (const point of [pts[0], pts[pts.length - 1]]) {
          const pos = xy(point);
          ink.beginPath(); ink.ellipse(pos.x, pos.y, point.width * 0.64 * s, point.width * 0.48 * s, -0.4, 0, Math.PI * 2); ink.fill();
        }
      }
      if (revoking) {
        const progress = Math.min(1, (now - state.revokedAt) / 220);
        c.strokeStyle = '#56524b'; c.lineWidth = 2.3 * s;
        const strike = E.layout.canvas(c, 'battle/chain_menu/signature/revoked');
        strike.beginPath(); strike.moveTo(r.x + 5 * s, r.y + r.h * 0.68);
        strike.lineTo(r.x + 5 * s + (r.w - 10 * s) * progress, r.y + r.h * (0.68 - 0.32 * progress)); strike.stroke();
      }
      c.restore();
    }, 'button');

    // Scenario metadata is the game's date source; rounds have no calendar-day conversion.
    const scenarioDate = this.game.info?.conquest ? this.game.info?.year : this.game.info?.age;
    E.text(`${scenarioDate || this.game.info?.year || '日期未载'} · 第 ${this.game.round} 回合`, r.x, r.y + r.h + 18 * s, {
      size: Math.round(13 * s), font: SERIF, color: '#6b4f33', base: 'middle'
    });
    if (isAuto || revoking) {
      const elapsed = this.signatureStampAt == null ? 1 : Math.min(1, (now - this.signatureStampAt) / 260);
      const stampScale = elapsed < 0.7 ? 1.28 - 0.34 * elapsed / 0.7 : 0.94 + 0.06 * (elapsed - 0.7) / 0.3;
      const stampX = r.revoke.x + r.revoke.w / 2, stampY = r.y + 31 * s;
      E.layout.region('battle/chain_menu/signature/stamp', { x: stampX - 48 * s, y: stampY - 23 * s, w: 96 * s, h: 46 * s, label: '已授权印章' }, () => {
        this.drawTreatyStamp(c, stampX, stampY - (1 - elapsed) * 8 * s, '已授权', revoking ? '#77736b' : '#9b2922', s * 1.15 * stampScale, -9);
      });
    }
    if (isAuto) {
      E.layout.region('battle/chain_menu/signature/revoke', { ...r.revoke, label: '撤销委任' }, () => {
        E.text('撤销委任', r.revoke.x + r.revoke.w / 2, r.revoke.y + r.revoke.h / 2, {
          size: Math.round(16 * s), font: SERIF, color: '#8b1e16', align: 'center', base: 'middle'
        });
      }, 'button');
    }
    const status = now < this.signatureHintUntil ? '请完整签署' : revoking ? '委任已撤销' : isAuto ? '参谋部已接管指挥' : '签署后即刻授权参谋部';
    E.text(status, titleX, cy + 300 * s, {
      size: Math.round(16 * s), font: SERIF, align: 'center', base: 'middle',
      color: now < this.signatureHintUntil ? '#8b1e16' : isAuto ? '#2f5d1e' : '#6b4f33'
    });
  }

  // ---- Confirm Modal Dialog (Postcard style: board_intro@2x.webp) ----
  drawConfirmModal(c, g) {
    const s = g.scale;
    const ui1 = this.battle.ui1;

    // Dark overlay for modal
    c.fillStyle = 'rgba(0, 0, 0, 0.55)';
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1294').fillRect(0, 0, g.W, g.H);

    const mw = 700 * (s / 1.21);
    const mh = 430 * (s / 1.21);
    const mx = (g.W - mw) / 2;
    const my = (g.H - mh) / 2;

    // Modal background: use pure document board (boardCommon) without pre-baked crowns or envelopes
    if (this.assets.boardCommon) {
      E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1303').drawImage(this.assets.boardCommon, mx, my, mw, mh);
    } else {
      E.panel(mx, my, mw, mh, { fill: '#efe3c2', stroke: '#56381e', lineWidth: 4, r: 8 });
    }

    const modalTitle = this.confirmDialog.title || '外交决议确认';
    E.text(modalTitle, mx + mw / 2, my + 56 * (s / 1.21), {
      size: Math.round(23 * s), bold: true, font: SERIF, align: 'center', base: 'middle', color: '#1c1208'
    });

    // Thin line under title
    c.save();
    c.strokeStyle = 'rgba(70, 45, 20, 0.45)';
    c.lineWidth = 1;
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1317').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1318').moveTo(mx + 50 * s, my + 80 * (s / 1.21));
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1319').lineTo(mx + mw - 50 * s, my + 80 * (s / 1.21));
    E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1320').stroke();
    c.restore();

    let textY = my + 115 * (s / 1.21);
    if (this.confirmDialog.warning) {
      this.drawTreatyStamp(c, mx + mw / 2, textY + 4 * s, this.confirmDialog.warning, '#8b1e16', s * 1.15, -8);
      textY += 42 * (s / 1.21);
    }

    // Body text
    const rawLines = (this.confirmDialog.content || '').split('\n');
    const lines = rawLines.flatMap(line => {
      if (E.wrap) return E.wrap(line, mw - 100 * (s / 1.21), Math.round(16 * s));
      return [line];
    });
    for (let i = 0; i < lines.length; i++) {
      E.text(lines[i], mx + mw / 2, textY + i * 25 * (s / 1.21), {
        size: Math.round(16 * s), font: SERIF, align: 'center', base: 'middle',
        color: this.confirmDialog.warning ? '#8b1e16' : '#2a1c0c'
      });
    }

    // Cascaded alliance countries display
    const cascades = this.confirmDialog.cascadedCountries || [];
    if (cascades.length > 0) {
      const allStageCountries = this.game.stage.data.countries;
      const warnY = textY + lines.length * 25 * (s / 1.21) + 12 * (s / 1.21);
      E.text('⚠️ 将同时与以下同盟国进入战争状态：', mx + mw / 2, warnY, {
        size: Math.round(15 * s), bold: true, font: SERIF, align: 'center', base: 'middle', color: '#8b1e16'
      });

      // Calculate total width of country chips to center them and wrap if needed
      const chipH = 26 * (s / 1.21);
      const flagH = 18 * (s / 1.21);
      const flagW = Math.round(flagH * (100 / 68));
      const chips = cascades.map(ctry => {
        const name = formatCountryDisplayName(ctry, false, allStageCountries);
        const w = flagW + 8 * (s / 1.21) + name.length * 15 * (s / 1.21) + 16 * (s / 1.21);
        return { ctry, name, w };
      });

      const maxRowW = mw - 80 * (s / 1.21);
      const chipRows = [];
      let curRow = [], curRowW = 0;
      for (const chip of chips) {
        if (curRow.length > 0 && curRowW + 10 * (s / 1.21) + chip.w > maxRowW) {
          chipRows.push({ items: curRow, w: curRowW });
          curRow = [chip];
          curRowW = chip.w;
        } else {
          curRow.push(chip);
          curRowW += (curRow.length > 1 ? 10 * (s / 1.21) : 0) + chip.w;
        }
      }
      if (curRow.length > 0) chipRows.push({ items: curRow, w: curRowW });

      let chipRowY = warnY + 28 * (s / 1.21);
      for (const row of chipRows) {
        let chipX = mx + (mw - row.w) / 2;
        for (const chip of row.items) {
          c.save();
          c.fillStyle = 'rgba(139, 30, 22, 0.12)';
          c.strokeStyle = 'rgba(139, 30, 22, 0.45)';
          c.lineWidth = 1;
          E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1384').beginPath();
          E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1385').roundRect(chipX, chipRowY - chipH / 2, chip.w, chipH, 4);
          E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1386').fill();
          E.layout.canvas(c, 'scenes/battle/ui/chain_menu.js:1387').stroke();
          c.restore();

          const flagKey = 'flag_' + (chip.ctry.flag || chip.ctry.id);
          const cleanKey = 'flag_' + (chip.ctry.flag || chip.ctry.id || '').replace(/\d+$/, '');
          const fFrame = (this.assets.flagAtlas && (this.assets.flagAtlas[flagKey] || this.assets.flagAtlas[cleanKey]))
            || (this.assets.armyAtlas && (this.assets.armyAtlas[flagKey] || this.assets.armyAtlas[cleanKey]));
          if (fFrame) {
            const fScale = flagH / (fFrame.h || 68);
            E.drawFrame(fFrame, chipX + 8 * (s / 1.21), chipRowY - flagH / 2, { scale: fScale, noRef: true });
          }

          E.text(chip.name, chipX + 8 * (s / 1.21) + flagW + 6 * (s / 1.21), chipRowY, {
            size: Math.round(14 * s), bold: true, font: SERIF, base: 'middle', color: '#8b1e16'
          });

          chipX += chip.w + 10 * (s / 1.21);
        }
        chipRowY += chipH + 6 * (s / 1.21);
      }
    }

    // Cancel Button ✗ (Left) and OK Button ✓ (Right) - safely inside parchment paper surface
    const btnW = 120 * (s / 1.21), btnH = 46 * (s / 1.21);
    const btnY = my + mh - 82 * (s / 1.21);
    const ackOnly = !!this.confirmDialog.ackOnly;
    const cancelX = mx + mw * 0.28 - btnW / 2;
    const okX = ackOnly ? mx + mw * 0.5 - btnW / 2 : mx + mw * 0.72 - btnW / 2;

    if (!ackOnly) {
      const cancelHover = E.pointer.x >= cancelX && E.pointer.x <= cancelX + btnW && E.pointer.y >= btnY && E.pointer.y <= btnY + btnH;
      const cancelDy = cancelHover && E.pointer.down ? 2 : 0;
      E.layout.button({x:cancelX,y:btnY,w:btnW,h:btnH,label:'取消',layoutInput:true}, 'battle/chain_menu/cancel');
      if (ui1 && ui1.longred_normal) {
        E.drawFrame(ui1.longred_normal, cancelX, btnY + cancelDy, {
          sx: btnW / ui1.longred_normal.w, sy: btnH / ui1.longred_normal.h, noRef: true
        });
      }
      E.text('✗ 取消', cancelX + btnW / 2, btnY + btnH / 2 + cancelDy, {
        size: Math.round(18 * s), bold: true, font: SERIF, align: 'center', base: 'middle',
        color: '#fff5dc', stroke: '#3a2410', strokeW: 2.5
      });
    }

    const okHover = E.pointer.x >= okX && E.pointer.x <= okX + btnW && E.pointer.y >= btnY && E.pointer.y <= btnY + btnH;
    const okDy = okHover && E.pointer.down ? 2 : 0;
    E.layout.button({x:okX,y:btnY,w:btnW,h:btnH,label:'确认',layoutInput:true}, 'battle/chain_menu/confirm');
    if (ui1 && ui1.green_normal) {
      E.drawFrame(ui1.green_normal, okX, btnY + okDy, {
        sx: btnW / ui1.green_normal.w, sy: btnH / ui1.green_normal.h, noRef: true
      });
    }
    E.text(ackOnly ? '✓ 知道了' : '✓ 确认', okX + btnW / 2, btnY + btnH / 2 + okDy, {
      size: Math.round(18 * s), bold: true, font: SERIF, align: 'center', base: 'middle',
      color: '#fff5dc', stroke: '#3a2410', strokeW: 2.5
    });
  }
}

export const ChainMenuDialog = ZhengwuDialog;
