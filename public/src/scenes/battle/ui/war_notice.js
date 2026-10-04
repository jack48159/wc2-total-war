// War event notice dialog: presents historical war events, consequences, and confirms application.
import { E } from '../../../core/index.js';
import { World } from '../../../game/world.js';

// Deduplicate body text if it redundantly repeats the title as a prefix
export function deduplicateBody(title, body) {
  if (!body) return '';
  const rawBody = String(body).trim();
  if (!title) return rawBody;
  const cleanTitle = String(title).trim();
  if (!cleanTitle) return rawBody;
  if (rawBody === cleanTitle) return '';

  const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reg = new RegExp(`^(?:【?${escaped}】?)[：:，,、\\s\\-—]+`, 'u');
  if (reg.test(rawBody)) {
    return rawBody.replace(reg, '').trim();
  }
  if (rawBody.startsWith(cleanTitle)) {
    const rest = rawBody.slice(cleanTitle.length).trim();
    return rest.replace(/^[：:，,、\\s\\-—]+/, '').trim();
  }
  return rawBody;
}

const COUNTRY_MAP = {
  de: { code: 'de', name: '德国', emoji: '🇩🇪', color: '#566573' },
  ru: { code: 'ru', name: '苏联', emoji: '🇷🇺', color: '#922b21' },
  gb: { code: 'gb', name: '英国', emoji: '🇬🇧', color: '#2471a3' },
  fr: { code: 'fr', name: '法国', emoji: '🇫🇷', color: '#2e86c1' },
  it: { code: 'it', name: '意大利', emoji: '🇮🇹', color: '#27ae60' },
  ja: { code: 'ja', name: '日本', emoji: '🇯🇵', color: '#c0392b' },
  us: { code: 'am', name: '美国', emoji: '🇺🇸', color: '#2980b9' },
  am: { code: 'am', name: '美国', emoji: '🇺🇸', color: '#2980b9' },
  cn: { code: 'cn', name: '中国', emoji: '🇨🇳', color: '#d35400' },
  tw: { code: 'tw', name: '中国', emoji: '🇨🇳', color: '#2980b9' },
  pl: { code: 'pl', name: '波兰', emoji: '🇵🇱', color: '#ba4a00' },
  fi: { code: 'fl', name: '芬兰', emoji: '🇫🇮', color: '#2980b9' },
  fl: { code: 'fl', name: '芬兰', emoji: '🇫🇮', color: '#2980b9' },
  ro: { code: 'ro', name: '罗马尼亚', emoji: '🇷🇴', color: '#b7950b' },
  hu: { code: 'hu', name: '匈牙利', emoji: '🇭🇺', color: '#1e8449' },
  bg: { code: 'bg', name: '保加利亚', emoji: '🇧🇬', color: '#117864' },
  ca: { code: 'ca', name: '加拿大', emoji: '🇨🇦', color: '#922b21' },
  au: { code: 'au', name: '澳大利亚', emoji: '🇦🇺', color: '#1f618d' },
  in: { code: 'in', name: '印度', emoji: '🇮🇳', color: '#d68910' },
  eg: { code: 'eg', name: '埃及', emoji: '🇪🇬', color: '#b7950b' },
  es: { code: 'es', name: '西班牙', emoji: '🇪🇸', color: '#b9770e' },
  tr: { code: 'tr', name: '土耳其', emoji: '🇹🇷', color: '#a93226' },
  gr: { code: 'gr', name: '希腊', emoji: '🇬🇷', color: '#2471a3' },
  yu: { code: 'yu', name: '南斯拉夫', emoji: '🇷🇸', color: '#2e4053' },
  nl: { code: 'nl', name: '荷兰', emoji: '🇳🇱', color: '#e67e22' },
  be: { code: 'be', name: '比利时', emoji: '🇧🇪', color: '#2c3e50' },
  no: { code: 'no', name: '挪威', emoji: '🇳🇴', color: '#922b21' },
  se: { code: 'se', name: '瑞典', emoji: '🇸🇪', color: '#2471a3' },
  dk: { code: 'dk', name: '丹麦', emoji: '🇩🇰', color: '#922b21' },
  ch: { code: 'ch', name: '瑞士', emoji: '🇨🇭', color: '#a93226' },
  cu: { code: 'cu', name: '古巴', emoji: '🇨🇺', color: '#2e86c1' },
  kp: { code: 'kp', name: '朝鲜', emoji: '🇰🇵', color: '#922b21' },
  nk: { code: 'kp', name: '朝鲜', emoji: '🇰🇵', color: '#922b21' },
  rk: { code: 'rk', name: '韩国', emoji: '🇰🇷', color: '#2471a3' },
  kr: { code: 'rk', name: '韩国', emoji: '🇰🇷', color: '#2471a3' }
};

const CHAR_TO_CODE = {
  '英': 'gb', '法': 'fr', '德': 'de', '苏': 'ru', '美': 'am',
  '意': 'it', '日': 'ja', '中': 'cn', '波': 'pl', '芬': 'fl',
  '罗': 'ro', '匈': 'hu', '保': 'bg', '荷': 'nl', '比': 'be',
  '挪': 'no', '丹': 'dk', '瑞': 'se', '希': 'gr', '加': 'ca',
  '澳': 'au', '朝': 'kp', '韩': 'rk'
};

const CATEGORY_THEMES = {
  war: {
    ribbonBg: '#6c1c1c',
    ribbonGrad: '#8a2323',
    accent: '#e5c17b',
    icon: '⚔',
    tag: '战地通报'
  },
  diplomacy: {
    ribbonBg: '#1d3b56',
    ribbonGrad: '#294f73',
    accent: '#93c2ec',
    icon: '🕊',
    tag: '外交通报'
  },
  major: {
    ribbonBg: '#614717',
    ribbonGrad: '#7d5c1e',
    accent: '#f7d67b',
    icon: '👑',
    tag: '战略转折'
  },
  general: {
    ribbonBg: '#472a1b',
    ribbonGrad: '#5d3723',
    accent: '#d5bb93',
    icon: '📢',
    tag: '战况通报'
  }
};

export class WarNoticeDialog {
  constructor(game, event, hooks = {}) {
    this.game = game;
    this.event = event || {};
    this.hooks = hooks;
    this.portrait = null;
    this.flagAtlas = null;
    this.armyAtlas = null;
    this.board = null;
    this.scrollY = 0;
    this.dragStart = null;
    this.animT = 0;
    this.hoverBtn = null;

    if (this.event.image) {
      E.image(`assets/${this.event.image}`).then(img => { this.portrait = img; }).catch(() => {});
    }

    Promise.all([
      E.atlas('flag_hd').catch(() => null),
      E.atlas('army_hd').catch(() => null),
      E.image('assets/board_result@2x.webp').catch(() => null)
    ]).then(([flags, armys, board]) => {
      this.flagAtlas = flags;
      this.armyAtlas = armys;
      this.board = board;
    }).catch(() => {});

    this.category = this.inferCategory();
    this.theme = CATEGORY_THEMES[this.category] || CATEGORY_THEMES.general;
    this.targetAreaId = this.detectTargetArea();
  }

  inferCategory() {
    const ev = this.event;
    if (ev.category && CATEGORY_THEMES[ev.category]) return ev.category;
    if (ev.kind && CATEGORY_THEMES[ev.kind]) return ev.kind;

    const text = `${ev.id || ''} ${ev.title || ''} ${ev.body || ''} ${ev.effect || ''}`.toLowerCase();
    if (/沦陷|陷落|灭国|消灭|倒戈|投降|战败|政变|组阁|转折|危机|fall|annex|defeat|surrender|coup|crisis/.test(text)) {
      return 'major';
    }
    if (/停战|和平|结盟|盟约|条约|休战|互不侵犯|armistice|peace|treaty|alliance|neutral/.test(text)) {
      return 'diplomacy';
    }
    if (/战|进攻|全面作战|突击|开战|作战|交战|反击|轰炸|登陆|动员|宣战|war|offensive|attack|strike|battle/.test(text)) {
      return 'war';
    }
    return 'general';
  }

  detectTargetArea() {
    const ev = this.event;
    if (ev.area != null) return ev.area;
    if (ev.areaId != null) return ev.areaId;
    if (ev.targetArea != null) return ev.targetArea;
    if (ev.location != null) return ev.location;

    // Search actions
    const actions = ev.actions || ev.effects || [];
    for (const act of actions) {
      if (act.area != null) return act.area;
      if (act.areaId != null) return act.areaId;
      if (act.targetArea != null) return act.targetArea;
    }

    // Keyword match on cities in World
    if (World?.areas?.length) {
      const text = `${ev.title || ''} ${ev.body || ''}`;
      for (const area of World.areas) {
        if (area.name && area.name.length >= 2 && text.includes(area.name)) {
          return area.id;
        }
      }
    }
    return null;
  }

  getPendingNotices() {
    return (this.game?.scenarioEvents?.pending || []).filter(e => e.type !== 'decision');
  }

  getQueueInfo() {
    const list = this.getPendingNotices();
    if (list.length <= 1) return null;
    const curIdx = list.findIndex(e => e.id === this.event.id);
    const index = curIdx >= 0 ? curIdx + 1 : 1;
    return { current: index, total: list.length };
  }

  resolveCountries() {
    const ev = this.event;
    // 1. Explicit actors in data
    if (ev.actors) {
      if (Array.isArray(ev.actors)) {
        const list = ev.actors.map(c => COUNTRY_MAP[c]).filter(Boolean);
        if (list.length) return { left: list };
      } else if (typeof ev.actors === 'object') {
        const left = (ev.actors.left || ev.actors.attackers || []).map(c => COUNTRY_MAP[c]).filter(Boolean);
        const right = (ev.actors.right || ev.actors.defenders || []).map(c => COUNTRY_MAP[c]).filter(Boolean);
        if (left.length || right.length) {
          return { left, right, relation: ev.actors.relation || 'war' };
        }
      }
    }

    // 2. From actions (diplomacy changes)
    const actions = ev.actions || ev.effects || [];
    for (const act of actions) {
      if (act.type === 'setDiplomacy' && act.first && act.second) {
        const c1 = COUNTRY_MAP[act.first];
        const c2 = COUNTRY_MAP[act.second];
        if (c1 && c2) {
          return {
            left: [c1],
            right: [c2],
            relation: act.state === 'war' ? 'war' : act.state === 'alliance' ? 'alliance' : 'peace'
          };
        }
      }
    }

    // 3. Text pattern matching (e.g. "英法开始对德全面作战")
    const title = ev.title || '';
    const body = ev.body || '';
    const text = `${title} ${body}`;

    // Pattern: [国字列表] 对/向/与 [国字列表] [作战/宣战/停战/结盟]
    const matchVersus = text.match(/([英法德苏美意日波中荷比挪丹芬罗匈保]+)(?:开始)?(?:向|对|与|和)([英法德苏美意日波中荷比挪丹芬罗匈保]+)(?:全面)?(?:作战|交战|宣战|停战|同盟|结盟|倒戈)/u);
    if (matchVersus) {
      const leftCodes = [...matchVersus[1]].map(ch => CHAR_TO_CODE[ch]).filter(Boolean);
      const rightCodes = [...matchVersus[2]].map(ch => CHAR_TO_CODE[ch]).filter(Boolean);
      const isAlliance = /同盟|结盟|倒戈/.test(matchVersus[0]);
      const isPeace = /停战|和平/.test(matchVersus[0]);
      const relation = isAlliance ? 'alliance' : isPeace ? 'peace' : 'war';
      const left = [...new Set(leftCodes)].map(c => COUNTRY_MAP[c]).filter(Boolean);
      const right = [...new Set(rightCodes)].map(c => COUNTRY_MAP[c]).filter(Boolean);
      if (left.length && right.length) {
        return { left, right, relation };
      }
    }

    // Match individual countries in text
    const foundCodes = new Set();
    for (const [code, info] of Object.entries(COUNTRY_MAP)) {
      if (text.includes(info.name)) foundCodes.add(info.code);
    }
    if (foundCodes.size > 0) {
      const list = [...foundCodes].map(c => COUNTRY_MAP[c]).filter(Boolean);
      return { left: list };
    }

    return null;
  }

  resolveEffects() {
    const ev = this.event;
    const chips = [];
    const actions = ev.actions || ev.effects || [];

    for (const act of actions) {
      if (act.type === 'changeStability') {
        const cName = COUNTRY_MAP[act.country]?.name || act.country || '本国';
        const sign = act.amount > 0 ? '+' : '';
        chips.push({
          text: `${cName} 稳定度 ${sign}${act.amount}`,
          type: act.amount >= 0 ? 'pos' : 'neg'
        });
      } else if (act.type === 'changeMoney') {
        const cName = act.country ? (COUNTRY_MAP[act.country]?.name || act.country) + ' ' : '';
        const sign = act.amount > 0 ? '+' : '';
        chips.push({
          text: `${cName}资金 ${sign}${act.amount}`,
          type: act.amount >= 0 ? 'pos' : 'neg'
        });
      } else if (act.type === 'changeIndustry') {
        const cName = act.country ? (COUNTRY_MAP[act.country]?.name || act.country) + ' ' : '';
        const sign = act.amount > 0 ? '+' : '';
        chips.push({
          text: `${cName}工业 ${sign}${act.amount}`,
          type: act.amount >= 0 ? 'pos' : 'neg'
        });
      } else if (act.type === 'setDiplomacy') {
        const n1 = COUNTRY_MAP[act.first]?.name || act.first;
        const n2 = COUNTRY_MAP[act.second]?.name || act.second;
        const stateName = act.state === 'war' ? '进入战争' : act.state === 'alliance' ? '结为同盟' : '达成停战';
        chips.push({
          text: `${n1} & ${n2}：${stateName}`,
          type: act.state === 'war' ? 'neg' : 'pos'
        });
      } else if (act.type === 'conquerArea') {
        const cName = COUNTRY_MAP[act.country]?.name || act.country || '势力';
        chips.push({
          text: `${cName} 夺取区域 #${act.area}`,
          type: 'neutral'
        });
      } else if (act.type === 'countryDefeated') {
        const cName = COUNTRY_MAP[act.country]?.name || act.country;
        chips.push({
          text: `${cName} 战败沦陷`,
          type: 'neg'
        });
      }
    }

    if (chips.length === 0 && ev.effect) {
      const parts = String(ev.effect).split(/[；;，,]/).map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        chips.push({ text: p, type: 'neutral' });
      }
    }

    return chips;
  }

  layout() {
    const W = E.W, H = E.H;
    const w = Math.min(680, W - 40);
    const padX = 32;
    const contentW = this.portrait ? (w - padX * 2 - 120) : (w - padX * 2);

    const title = this.event.title || '战况通报';
    const countriesData = this.resolveCountries();
    const cleanBody = deduplicateBody(title, this.event.body);
    const bodyLines = cleanBody ? E.wrap(cleanBody, contentW, 19) : [];
    const chips = this.resolveEffects();
    const queueInfo = this.getQueueInfo();

    const ribbonH = 46;
    const titleH = 42;
    const countriesH = countriesData ? 32 : 0;
    const dividerH = 8;
    const textH = Math.max(bodyLines.length * 26, this.portrait ? 110 : 0);

    let chipsH = 0;
    if (chips.length > 0) {
      let curRowW = 0;
      let rows = 1;
      const chipPad = 12;
      for (const chip of chips) {
        const chipW = chip.text.length * 14 + 32;
        if (curRowW + chipW > contentW && curRowW > 0) {
          rows++;
          curRowW = chipW + chipPad;
        } else {
          curRowW += chipW + chipPad;
        }
      }
      chipsH = rows * 28 + (rows - 1) * 6;
    }

    const buttonsH = 64;
    const totalContentH = ribbonH + 16 + titleH + countriesH + dividerH + textH + (chipsH ? chipsH + 14 : 0) + buttonsH + 20;

    const minH = 240;
    const maxH = Math.min(440, H - 24);
    const h = Math.max(minH, Math.min(totalContentH, maxH));
    const x = Math.round((W - w) / 2);
    const y = Math.round((H - h) / 2);

    const isScrollable = totalContentH > maxH;
    const maxScroll = Math.max(0, totalContentH - maxH);

    return {
      x, y, w, h,
      padX,
      contentW,
      title,
      cleanBody,
      bodyLines,
      countriesData,
      chips,
      queueInfo,
      ribbonH,
      titleH,
      countriesH,
      dividerH,
      textH,
      chipsH,
      buttonsH,
      totalContentH,
      isScrollable,
      maxScroll
    };
  }

  getButtons(lay) {
    const btns = [];
    const bh = 46;
    const hasFocus = this.targetAreaId != null;
    const hasQueue = lay.queueInfo != null && lay.queueInfo.total > 1;

    if (hasFocus && hasQueue) {
      const bw = Math.min(145, (lay.w - lay.padX * 2 - 24) / 3);
      const totalW = bw * 3 + 20;
      const startX = lay.x + (lay.w - totalW) / 2;
      const by = lay.y + lay.h - 58;
      btns.push({ id: 'focus', label: '查看战场', x: startX, y: by, w: bw, h: bh, kind: 'secondary' });
      btns.push({ id: 'confirmAll', label: '全部知悉', x: startX + bw + 10, y: by, w: bw, h: bh, kind: 'all' });
      btns.push({ id: 'confirm', label: '确认知悉', x: startX + (bw + 10) * 2, y: by, w: bw, h: bh, kind: 'primary' });
    } else if (hasFocus) {
      const bw = 150;
      const totalW = bw * 2 + 16;
      const startX = lay.x + (lay.w - totalW) / 2;
      const by = lay.y + lay.h - 58;
      btns.push({ id: 'focus', label: '查看战场', x: startX, y: by, w: bw, h: bh, kind: 'secondary' });
      btns.push({ id: 'confirm', label: '确认知悉', x: startX + bw + 16, y: by, w: bw, h: bh, kind: 'primary' });
    } else if (hasQueue) {
      const bw = 150;
      const totalW = bw * 2 + 16;
      const startX = lay.x + (lay.w - totalW) / 2;
      const by = lay.y + lay.h - 58;
      btns.push({ id: 'confirmAll', label: '全部知悉', x: startX, y: by, w: bw, h: bh, kind: 'all' });
      btns.push({ id: 'confirm', label: '确认知悉', x: startX + bw + 16, y: by, w: bw, h: bh, kind: 'primary' });
    } else {
      const bw = 180;
      const bx = lay.x + (lay.w - bw) / 2;
      const by = lay.y + lay.h - 58;
      btns.push({ id: 'confirm', label: '确认知悉', x: bx, y: by, w: bw, h: bh, kind: 'primary' });
    }
    return btns;
  }

  confirm() {
    E.playSfx('btn.wav');
    this.game.apply({ type: 'resolveEventNotice', eventId: this.event.id });
    if (this.hooks.close) this.hooks.close();
  }

  confirmAll() {
    E.playSfx('btn.wav');
    const notices = this.getPendingNotices();
    for (const ev of notices) {
      this.game.apply({ type: 'resolveEventNotice', eventId: ev.id });
    }
    if (this.hooks.close) this.hooks.close();
  }

  focusBattlefield() {
    E.playSfx('btn.wav');
    const targetId = this.targetAreaId;
    this.game.apply({ type: 'resolveEventNotice', eventId: this.event.id });
    if (this.hooks.close) this.hooks.close();
    if (targetId != null && this.hooks.focusArea) {
      this.hooks.focusArea(targetId);
    }
  }

  down(p) {
    const lay = this.layout();
    const btns = this.getButtons(lay);
    for (const b of btns) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (b.id === 'confirm') this.confirm();
        else if (b.id === 'confirmAll') this.confirmAll();
        else if (b.id === 'focus') this.focusBattlefield();
        return;
      }
    }
    if (lay.isScrollable && p.y >= lay.y + lay.ribbonH && p.y <= lay.y + lay.h - lay.buttonsH) {
      this.dragStart = { y: p.y, scrollY: this.scrollY };
    }
  }

  move(p) {
    const lay = this.layout();
    const btns = this.getButtons(lay);
    this.hoverBtn = null;
    for (const b of btns) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        this.hoverBtn = b.id;
        break;
      }
    }
    if (this.dragStart) {
      const dy = p.y - this.dragStart.y;
      this.scrollY = Math.max(0, Math.min(lay.maxScroll, this.dragStart.scrollY - dy));
    }
  }

  up(p) {
    this.dragStart = null;
  }

  wheel(dy) {
    const lay = this.layout();
    if (lay.isScrollable) {
      this.scrollY = Math.max(0, Math.min(lay.maxScroll, this.scrollY + dy));
    }
  }

  key(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      this.confirm();
    }
  }

  update(dt) {
    this.animT = Math.min(1, this.animT + dt * 6);
  }

  getFlagFrame(code) {
    if (!code) return null;
    const key = 'flag_' + code;
    const clean = 'flag_' + String(code).replace(/\d+$/, '');
    return this.flagAtlas?.[key] || this.flagAtlas?.[clean]
      || this.armyAtlas?.[key] || this.armyAtlas?.[clean];
  }

  draw() {
    const c = E.ctx;
    const lay = this.layout();
    const ev = this.event;
    const theme = this.theme;

    c.save();

    // Dim background
    c.fillStyle = 'rgba(0,0,0,0.72)';
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:dim').fillRect(0, 0, E.W, E.H);

    // Fade-in scale effect
    const scale = 0.94 + 0.06 * this.animT;
    c.globalAlpha = this.animT;

    // Outer frame & parchment
    c.save();
    c.translate(lay.x + lay.w / 2, lay.y + lay.h / 2);
    c.scale(scale, scale);
    c.translate(-(lay.x + lay.w / 2), -(lay.y + lay.h / 2));

    // Drop shadow
    c.shadowColor = 'rgba(0,0,0,0.65)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 10;

    // Dialog outer border (dark wood / military leather)
    c.fillStyle = '#2b1f15';
    c.strokeStyle = '#cda96e';
    c.lineWidth = 4;
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:frame').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:frame').roundRect(lay.x, lay.y, lay.w, lay.h, 12);
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:frame').fill();
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:frame').stroke();
    c.restore();

    // Inner parchment paper panel
    c.save();
    c.fillStyle = '#f4ebda';
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:paper').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:paper').roundRect(lay.x + 6, lay.y + lay.ribbonH + 4, lay.w - 12, lay.h - lay.ribbonH - 10, 8);
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:paper').fill();

    // Paper inner border
    c.strokeStyle = '#d8c5a2';
    c.lineWidth = 1.5;
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:paper_border').strokeRect(lay.x + 12, lay.y + lay.ribbonH + 10, lay.w - 24, lay.h - lay.ribbonH - 22);

    // Top ribbon bar (themed header)
    const ribGrad = c.createLinearGradient(lay.x, lay.y, lay.x + lay.w, lay.y + lay.ribbonH);
    ribGrad.addColorStop(0, theme.ribbonBg);
    ribGrad.addColorStop(1, theme.ribbonGrad);
    c.fillStyle = ribGrad;
    c.strokeStyle = theme.accent;
    c.lineWidth = 1.5;
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:ribbon').beginPath();
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:ribbon').roundRect(lay.x + 4, lay.y + 4, lay.w - 8, lay.ribbonH, 8);
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:ribbon').fill();
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:ribbon').stroke();

    // Header icon & title
    E.text(`${theme.icon} 战地紧急通报 / WAR NOTICE`, lay.x + 20, lay.y + 31, {
      size: 21,
      color: '#f9eee0',
      bold: true
    });

    // Right info: Round & Queue
    const roundText = this.game?.round != null ? `第 ${this.game.round} 回合` : '';
    const queueText = lay.queueInfo ? ` (${lay.queueInfo.current}/${lay.queueInfo.total})` : '';
    const headerRight = `${roundText}${queueText}`;
    if (headerRight) {
      E.text(headerRight, lay.x + lay.w - 20, lay.y + 31, {
        size: 16,
        color: theme.accent,
        bold: true,
        align: 'right'
      });
    }

    // Scrollable content area
    const clipTop = lay.y + lay.ribbonH + 12;
    const clipH = lay.h - lay.ribbonH - lay.buttonsH - 18;
    c.save();
    c.beginPath();
    c.rect(lay.x + 8, clipTop, lay.w - 16, clipH);
    c.clip();

    let curY = clipTop + 14 - this.scrollY;

    // Event Big Title
    E.text(lay.title, lay.x + lay.padX, curY + 16, {
      size: 25,
      color: '#28170c',
      bold: true
    });
    curY += lay.titleH;

    // Countries & flags row
    if (lay.countriesData) {
      this.drawCountriesRow(c, lay.countriesData, lay.x + lay.padX, curY + 6);
      curY += lay.countriesH;
    }

    // Elegant separator line
    c.fillStyle = '#caa974';
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:divider').fillRect(lay.x + lay.padX, curY + 2, lay.w - lay.padX * 2, 2);
    c.fillStyle = '#e8d8be';
    E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:divider_sub').fillRect(lay.x + lay.padX, curY + 4, lay.w - lay.padX * 2, 1);
    curY += lay.dividerH + 8;

    // Body text & portrait
    const bodyStartY = curY;
    if (lay.bodyLines.length > 0) {
      lay.bodyLines.forEach((line, i) => {
        E.text(line, lay.x + lay.padX, curY + 18 + i * 26, {
          size: 19,
          color: '#342417',
          bold: false
        });
      });
    }

    // Portrait image if present
    if (this.portrait) {
      const pw = 100, ph = 100;
      const px = lay.x + lay.w - lay.padX - pw;
      const py = bodyStartY;
      c.save();
      c.fillStyle = '#d9cbb2';
      c.strokeStyle = '#6a4c28';
      c.lineWidth = 2;
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:portrait_frame').strokeRect(px - 2, py - 2, pw + 4, ph + 4);
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:portrait').drawImage(this.portrait, px, py, pw, ph);
      c.restore();
    }
    curY += lay.textH + 6;

    // Strategic Effect Chips
    if (lay.chips.length > 0) {
      curY = this.drawChips(c, lay.chips, lay.x + lay.padX, curY + 4, lay.contentW);
    }

    c.restore(); // End clipping

    // Scrollbar indicator
    if (lay.isScrollable && lay.maxScroll > 0) {
      const trackH = clipH - 12;
      const thumbH = Math.max(20, trackH * (clipH / lay.totalContentH));
      const thumbY = clipTop + 6 + (this.scrollY / lay.maxScroll) * (trackH - thumbH);
      c.fillStyle = 'rgba(80, 50, 20, 0.28)';
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:scroll_thumb').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:scroll_thumb').roundRect(lay.x + lay.w - 14, thumbY, 4, thumbH, 2);
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:scroll_thumb').fill();
    }

    // Buttons bar
    const btns = this.getButtons(lay);
    for (const b of btns) {
      const isHover = this.hoverBtn === b.id;
      this.drawButton(c, b, isHover);
    }

    c.restore(); // Restore outer frame
  }

  drawCountriesRow(c, data, startX, y) {
    let curX = startX;

    const renderSide = (list) => {
      for (const item of list) {
        const frame = this.getFlagFrame(item.code);
        if (frame) {
          E.drawFrame(frame, curX, y - 1, { sx: 24 / frame.w, sy: 16 / frame.h, noRef: true });
        } else {
          c.fillStyle = item.color || '#445566';
          c.strokeStyle = '#2b1b11';
          c.lineWidth = 1;
          E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:flag_block').fillRect(curX, y - 1, 24, 16);
          E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:flag_block').strokeRect(curX, y - 1, 24, 16);
        }
        curX += 28;
        E.text(item.name, curX, y + 13, { size: 16, color: '#302013', bold: true });
        curX += item.name.length * 16 + 10;
      }
    };

    if (data.left && data.left.length) {
      renderSide(data.left);
    }

    if (data.relation) {
      const icon = data.relation === 'war' ? '⚔' : data.relation === 'alliance' ? '🤝' : '🕊';
      const color = data.relation === 'war' ? '#8a2323' : data.relation === 'alliance' ? '#2e6b38' : '#23588a';
      curX += 4;
      E.text(icon, curX, y + 14, { size: 18, color, bold: true });
      curX += 26;
    }

    if (data.right && data.right.length) {
      renderSide(data.right);
    }
  }

  drawChips(c, chips, startX, startY, maxW) {
    let curX = startX;
    let curY = startY;
    const chipH = 26;
    const gap = 8;

    for (const chip of chips) {
      const tw = chip.text.length * 13.5;
      const chipW = tw + 28;

      if (curX + chipW > startX + maxW && curX > startX) {
        curX = startX;
        curY += chipH + 6;
      }

      // Chip background
      c.save();
      c.fillStyle = 'rgba(100, 70, 40, 0.08)';
      c.strokeStyle = 'rgba(130, 95, 55, 0.32)';
      c.lineWidth = 1;
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip').roundRect(curX, curY, chipW, chipH, 4);
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip').fill();
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip').stroke();

      // Dot color
      const dotColor = chip.type === 'pos' ? '#2e7d32' : chip.type === 'neg' ? '#a93226' : '#6e5020';
      c.fillStyle = dotColor;
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip_dot').beginPath();
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip_dot').arc(curX + 11, curY + chipH / 2, 4, 0, Math.PI * 2);
      E.layout.canvas(c, 'scenes/battle/ui/war_notice.js:chip_dot').fill();

      // Chip text
      E.text(chip.text, curX + 20, curY + 18, {
        size: 14,
        color: '#2f2014',
        bold: true
      });
      c.restore();

      curX += chipW + gap;
    }

    return curY + chipH;
  }

  drawButton(c, b, isHover) {
    c.save();
    let bg, border, txtColor;

    if (b.kind === 'primary') {
      bg = isHover ? '#388044' : '#2b6835';
      border = '#68be75';
      txtColor = '#ffffff';
    } else if (b.kind === 'all') {
      bg = isHover ? '#294e6f' : '#1f3e58';
      border = '#5a8cb5';
      txtColor = '#ffffff';
    } else {
      bg = isHover ? '#59442a' : '#493722';
      border = '#b99557';
      txtColor = '#f5e8cf';
    }

    c.fillStyle = bg;
    c.strokeStyle = border;
    c.lineWidth = 2;
    E.layout.canvas(c, `scenes/battle/ui/war_notice.js:btn_${b.id}`).beginPath();
    E.layout.canvas(c, `scenes/battle/ui/war_notice.js:btn_${b.id}`).roundRect(b.x, b.y, b.w, b.h, 6);
    E.layout.canvas(c, `scenes/battle/ui/war_notice.js:btn_${b.id}`).fill();
    E.layout.canvas(c, `scenes/battle/ui/war_notice.js:btn_${b.id}`).stroke();

    E.text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 7, {
      size: 19,
      color: txtColor,
      bold: true,
      align: 'center'
    });
    c.restore();
  }
}
