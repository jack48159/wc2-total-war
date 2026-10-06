// Options: left sidebar (音量 / 游戏 / 特效 / 接管 / 日志) + right content panel.
//   音量  - independent BGM and sound effect levels.
//   游戏  - unit walking speed.
//   特效  - smoke, fire, selection transparency, fatigue multiplier, and desktop selection.
//   接管  - AI takeover configuration (LLM / MCP).
//   日志  - game log controls.
// OK saves everything, back discards.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { Slider, drawSliderTrack } from '../ui/slider.js';
import { loadRooms, roomById } from './battle/render/rooms.js';
import { frameDesktop } from './battle/render/desk_frame.js';
import { bridgePrompt, bridgeUrlFor } from '../game/bridge_controller.js';
import { playerCountryName } from '../game/describe.js';
import { OptionsBridgeManager } from './options_bridge.js';
const SERIF = '"Songti SC","Noto Serif CJK SC","SimSun","Source Han Serif SC",serif';

export let DESKTOPS = [
  { id: 'solid_wood_mahogany', file: 'assets/desktop/solid_wood_mahogany.png' },
  { id: 'solid_wood_black_walnut', file: 'assets/desktop/solid_wood_black_walnut.png' },
  { id: 'empty_desktop_warm_oak', file: 'assets/desktop/empty_desktop_warm_oak.png' },
  { id: 'empty_desktop_olive_canvas', file: 'assets/desktop/empty_desktop_olive_canvas.png' },
  { id: 'empty_desktop_mahogany_leather', file: 'assets/desktop/empty_desktop_mahogany_leather.png' },
  { id: 'empty_desktop_charcoal_composite', file: 'assets/desktop/empty_desktop_charcoal_composite.png' },
  { id: 'desktop_cowhide_brown', file: 'assets/desktop/desktop_cowhide_brown.png' },
  { id: 'ivory_hard_maple', file: 'assets/desktop/ivory_hard_maple.png' },
  { id: 'ivory_natural_birch', file: 'assets/desktop/ivory_natural_birch.png' },
  { id: 'ivory_solid_oak', file: 'assets/desktop/ivory_solid_oak.png' },
];

export async function loadDesktops() {
  try {
    const res = await fetch(E.platform?.assetIndex('desktops') || '/api/desktops');
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        DESKTOPS = list;
      }
    }
  } catch (e) {}
  return DESKTOPS;
}

export function desktopById(id = 'solid_wood_mahogany') {
  return DESKTOPS.find(d => d.id === id)
    || DESKTOPS.find(d => d.id === `${id}_aged_2x`)
    || DESKTOPS.find(d => d.id === 'solid_wood_mahogany_aged_2x')
    || DESKTOPS[0];
}

const DEFAULT_AI = () => ({
  scheme: 0, all_ai_countries: true, max_actions_per_turn: 40,
  scheme0: {},
  scheme1: { base_url: 'https://openrouter.ai/api/v1', api_key: '', model: 'deepseek/deepseek-v4.1-flash' },
});
const SCHEMES = [
  { name: '内置 AI', scheme: 0, key: 'scheme0',
    status: '当前方案：内置 AI',
    statusColor: '#5a3d18',
    desc: '由游戏内置规则处理各国回合行动。',
    fields: [] },
  { name: 'LLM 接管', scheme: 1, key: 'scheme1',
    status: 'LLM 接口配置',
    statusColor: '#5a3d18',
    desc: '设置兼容 OpenAI 的接口地址、密钥和模型名称。',
    fields: [
      { key: 'base_url', label: 'API 地址 (Base URL)', placeholder: 'https://openrouter.ai/api/v1' },
      { key: 'api_key', label: 'API 密钥 (API Key)', secret: true, placeholder: 'sk-or-...' },
      { key: 'model', label: '模型名称 (Model)', placeholder: 'deepseek/deepseek-v4.1-flash' }] },
];
const TABS = [{ id: 'volume', name: '音量' }, { id: 'game', name: '游戏' }, { id: 'effects', name: '特效' }, { id: 'takeover', name: '接管' }, { id: 'hotkeys', name: '快捷键' }, { id: 'logs', name: '日志' }];
const speedOf = v => { const m = Math.pow(4, 2 * v - 1); return Math.abs(m - 1) < 0.04 ? 1 : Math.round(m * 20) / 20; };
const posOf = m => (Math.log(m) / Math.log(4) + 1) / 2;
const PANEL_X = 640, PANEL_R = 1500;


class Options extends Page {
  constructor(tab, returnTo) {
    super(); this.ownTouch = true; this.returnTo = returnTo; this.hasOk = true;
    this.tab = TABS.some(t => t.id === (tab || E.state.lastOptionsTab)) ? (tab || E.state.lastOptionsTab) : 'volume';
    this.route = this.tab === 'takeover' ? 'ai' : 'options';
    this.bgmVol = E.state.music; this.sfxVol = E.state.sfx; this.moveSpeed = E.state.moveSpeed || 1;
    this.smoke = E.state.smoke ?? 0.4; this.fire = E.state.fire ?? 1;
    this.selectionTransparency = E.state.selectionTransparency ?? E.state.selectionBlur ?? 0.5;
    this.groupGlowIntensity = E.state.groupGlowIntensity ?? 0.85;
    this.fatigueMultiplier = E.clamp(Math.round(E.state.fatigueMultiplier ?? 1), 1, 5);
    this.desktopRatio = E.state.desktopRatio ?? 1.5;
    this.desktopRebound = E.state.desktopRebound !== false;
    this.desktopTexture = E.state.desktopTexture || 'solid_wood_mahogany';
    this.roomBackdrop = E.state.roomBackdrop;                            // the 3D room round the desk (battle/render/rooms.js)
    this.logEnabled = E.state.logEnabled !== false;
    this.autoFs = E.state.autoFullscreen !== false;
    this.aiFollowCamera = E.state.aiFollowCamera ?? (localStorage.getItem('wc2-ai-follow-camera') !== 'false');
    this.input = null; this.cfg = DEFAULT_AI(); this.subIdx = 0;
    this.sideScrollY = 0; this.sideMaxScroll = 0;
    this.contentScrollY = 0; this.contentMaxScroll = 0;
    this.desktopScrollX = 0; this.roomScrollX = 0;
    this.dragScroll = null;
    this.bridgeEnabled = E.state.bridgeEnabled === true;
    const candidates = this.bridgeCountries();
    const stored = Array.isArray(E.state.bridgeCountries) ? E.state.bridgeCountries : (E.state.bridgeCountry ? [E.state.bridgeCountry] : []);
    this.bridgeCountriesSelected = new Set(stored.filter(c => candidates.includes(c)));
    if (!this.bridgeCountriesSelected.size && candidates.length > 0) {
      this.bridgeCountriesSelected.add(candidates[0]);
    }
    this.bridgeCountry = Array.from(this.bridgeCountriesSelected)[0] || candidates[0] || '';
    if (this.returnTo?.game) {
      this.bridgeEnabled = this.returnTo.bridgeEnabled === true;
      if (Array.isArray(this.returnTo.bridgeCountries) && this.returnTo.bridgeCountries.length > 0) {
        this.bridgeCountriesSelected = new Set(this.returnTo.bridgeCountries);
        this.bridgeCountry = this.returnTo.bridgeCountries[0] || this.bridgeCountry;
      }
    }
    this.bridgeUrl = bridgeUrlFor(E.state.bridgeUrl);
    this.bridgeTimeoutMinutes = String(E.state.bridgeTimeoutMinutes || 10);
    this.bridgeTimeoutAction = E.state.bridgeTimeoutAction || 'wait';
    this.bridgeNote = '';
    this.bridgeMgr = new OptionsBridgeManager(this);
  }
  get widgets() {
    if (!this.side) return [];
    let list = [...this.side];
    if (this.tab === 'volume') list.push(this.bgmSlider, this.sfxSlider);
    else if (this.tab === 'game') list.push(this.moveSlider, this.fsToggle, this.aiFollowToggle);
    else if (this.tab === 'effects') list.push(this.smokeSlider, this.fireSlider, this.blurSlider, this.glowSlider, this.fatigueSlider, this.desktopRatioSlider, this.desktopReboundBtn, ...this.desktopBtns, ...(this.desktopArrows || []), ...(this.roomBtns || []), ...(this.roomArrows || []));
    else if (this.tab === 'hotkeys') list.push(...this.hkBtns, this.hkReset);
    else if (this.tab === 'logs') list.push(this.logToggle, this.clearLogs);
    else if (SCHEMES[this.subIdx]?.name === '对战桥') {
      const { widgets } = this.bridgeMgr ? this.bridgeMgr.collectWidgets(this.contentScrollY) : { widgets: [] };
      list.push(...this.subTabs, ...widgets);
    }
    else list.push(...this.subTabs, ...(this.fieldBtns[this.subIdx] || []), this.useBtn);
    return list;
  }
  set widgets(v) { }

  async init() {
    const [board, bg, , rooms, flags] = await Promise.all([
      E.image('assets/board_common@2x.webp'), E.image('assets/commonbg@2x.png'),
      loadDesktops(), loadRooms(), E.atlas('selcountry_hd').catch(() => null)
    ]);
    this.board = board; this.bg = bg;
    this.desktopTexture = desktopById(this.desktopTexture)?.id || this.desktopTexture;
    this.rooms = rooms;
    this.roomBackdrop = (roomById(this.rooms, this.roomBackdrop) || {}).id;
    try {
      const saved = JSON.parse(localStorage.getItem('wc2.aiconfig') || 'null'); if (saved) this.merge(saved);
    } catch (e) {}
    this.flags = flags;
    this.bridgeMgr?.init();
    this.side = TABS.map((t, i) => Object.assign(new E.Button({
      x: 77, y: 195 + i * 106, w: 461, h: 93, label: t.name,
      onClick: () => {
        this.commit(); this.capture = null; this.tab = t.id; this.contentScrollY = 0;
        this.route = t.id === 'takeover' ? 'ai' : 'options';
        try { history.replaceState(null, '', new URL('#' + this.route, location.href).href); } catch (e) {}
      }
    }), { t, i, baseY: 195 + i * 106 }));

    // 快捷键 tab: one key box per action
    const HK_Y0 = 250, HK_PITCH = 88, n = E.hotkeys.actions.length;
    this.hkBtns = E.hotkeys.actions.map((a, i) => Object.assign(new E.Button({ x: 1120, y: HK_Y0 + i * HK_PITCH, w: 380, h: 70, label: a.name, onClick: () => this.startCapture(a.id) }), { a, baseY: HK_Y0 + i * HK_PITCH }));
    this.hkReset = Object.assign(new E.Button({ x: PANEL_X, y: HK_Y0 + n * HK_PITCH + 20, w: 400, h: 76, label: '恢复默认快捷键', onClick: () => { E.hotkeys.reset(); this.capture = null; this.hkNote = '已恢复默认'; } }), { baseY: HK_Y0 + n * HK_PITCH + 20 });

    this.fsToggle = Object.assign(new E.Button({ x: PANEL_X, y: 470, w: 520, h: 90, label: '启动时全屏', onClick: () => {
      this.autoFs = !this.autoFs;
      // apply now (this click is the user gesture the browser needs): on = enter full screen, off = leave it
      try { if (this.autoFs && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); else if (!this.autoFs && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
    } }), { baseY: 470 });

    this.aiFollowToggle = Object.assign(new E.Button({
      x: PANEL_X, y: 620, w: 640,
      h: Math.max(90, Math.ceil(44 * (E.view?.dpr || 1) / (E.view?.scale || 1))),
      label: 'AI 回合镜头自动跟随',
      onClick: () => { this.aiFollowCamera = !this.aiFollowCamera; }
    }), { baseY: 620 });

    this.bgmSlider = new Slider({ tx: 800, ty: 300, label: 'BGM 音量' });
    this.bgmSlider.get = () => this.bgmVol;
    this.bgmSlider.set = v => { this.bgmVol = v; E.setMusicVolume(v); };
    this.bgmSlider.baseTy = 300;
    this.sfxSlider = new Slider({ tx: 800, ty: 450, label: '音效音量' });
    this.sfxSlider.get = () => this.sfxVol;
    this.sfxSlider.set = v => { this.sfxVol = v; };
    this.sfxSlider.onRelease = () => { const old = E.state.sfx; E.state.sfx = this.sfxVol; E.playSfx('btn.wav'); E.state.sfx = old; };
    this.sfxSlider.baseTy = 450;

    this.moveSlider = new Slider({ tx: 800, ty: 340, label: '单位移动速度' });
    this.moveSlider.get = () => posOf(this.moveSpeed);
    this.moveSlider.set = v => { this.moveSpeed = speedOf(v); };
    this.moveSlider.baseTy = 340;

    this.smokeSlider = new Slider({ tx: 800, ty: 220, label: '烟雾浓度' });
    this.smokeSlider.get = () => this.smoke;
    this.smokeSlider.set = v => { this.smoke = Math.round(v * 20) / 20; };
    this.smokeSlider.baseTy = 220;

    this.fireSlider = new Slider({ tx: 800, ty: 340, label: '爆炸火光' });
    this.fireSlider.get = () => this.fire;
    this.fireSlider.set = v => { this.fire = Math.round(v * 20) / 20; };
    this.fireSlider.baseTy = 340;

    this.blurSlider = new Slider({ tx: 800, ty: 460, label: '待选框透明' });
    this.blurSlider.get = () => this.selectionTransparency;
    this.blurSlider.set = v => { this.selectionTransparency = Math.round(v * 20) / 20; };
    this.blurSlider.baseTy = 460;

    this.glowSlider = new Slider({ tx: 800, ty: 580, label: '集团军光晕浓度' });
    this.glowSlider.get = () => this.groupGlowIntensity / 3;
    this.glowSlider.set = v => { this.groupGlowIntensity = Math.round(v * 300) / 100; };
    this.glowSlider.baseTy = 580;

    this.fatigueSlider = new Slider({ tx: 800, ty: 700, label: '疲惫倍率' });
    this.fatigueSlider.steps = 5;
    this.fatigueSlider.get = () => (this.fatigueMultiplier - 1) / 4;
    this.fatigueSlider.set = v => { this.fatigueMultiplier = Math.round(v * 4) + 1; };
    this.fatigueSlider.baseTy = 700;

    this.desktopRatioSlider = new Slider({ tx: 800, ty: 820, label: '桌面比例' });
    this.desktopRatioSlider.get = () => (this.desktopRatio - 1.0) / 9.0;                    // 1x .. 10x the map
    this.desktopRatioSlider.set = v => { this.desktopRatio = Math.round((1.0 + v * 9.0) * 10) / 10; };
    this.desktopRatioSlider.baseTy = 820;

    this.desktopReboundBtn = new E.Button({
      x: 800, y: 920, w: 500, h: 54, label: '',
      onClick: () => { this.desktopRebound = !this.desktopRebound; }
    });
    this.desktopReboundBtn.baseX = 800;
    this.desktopReboundBtn.baseY = 920;

    this.desktopBtns = DESKTOPS.map((d, i) => {
      return Object.assign(new E.Button({
        w: 236, h: 96, label: '',
        onClick: () => { this.selectDesktop(d); }
      }), { d, baseX: 730 + i * 246, baseY: 1080 });
    });
    this.desktopArrows = [-1, 1].map(dir => Object.assign(new E.Button({
      w: 34, h: 74, label: '',
      onClick: () => { this.desktopScrollX = E.clamp(this.desktopScrollX + dir * 246, 0, this.desktopMaxScroll()); this.updateScrollLayout(); }
    }), { dir, baseX: dir < 0 ? 687 : 1470, baseY: 1091 }));
    // 房间背景: a horizontal, draggable three-card carousel below the desktop grid.
    this.roomTitleY = 1240;
    this.roomBtns = (this.rooms || []).map((r, i) => {
      return Object.assign(new E.Button({
        w: 236, h: 132, label: '',
        onClick: () => { this.roomBackdrop = r.id; }
      }), { r, baseX: 730 + i * 246, baseY: this.roomTitleY + 40 });
    });
    this.roomArrows = [-1, 1].map(dir => Object.assign(new E.Button({
      w: 34, h: 74, label: '',
      onClick: () => { this.roomScrollX = E.clamp(this.roomScrollX + dir * 246, 0, this.roomMaxScroll()); this.updateScrollLayout(); }
    }), { dir, baseX: dir < 0 ? 687 : 1470, baseY: this.roomTitleY + 68 }));

    this.logToggle = new E.Button({ x: PANEL_X, y: 250, w: 520, h: 90, label: '日志开关', onClick: () => { this.logEnabled = !this.logEnabled; } });
    this.logToggle.baseY = 250;
    this.clearLogs = new E.Button({ x: PANEL_X, y: 390, w: 520, h: 90, label: '清理日志', onClick: () => {
      import('../core/game_log.js').then(({ LogStore }) => LogStore.clearAll());
      const g = this.returnTo?.game; if (g) { g.gameLog.length = 0; g.nextGameLogId = 1; }
    } });
    this.clearLogs.baseY = 390;

    this.subTabs = SCHEMES.map((t, i) => Object.assign(new E.Button({ x: PANEL_X + i * 215, y: 148, w: 205, h: 62, label: t.name, onClick: () => { this.commit(); this.subIdx = i; this.contentScrollY = 0; } }), { t, i, baseY: 148 }));
    this.fieldBtns = SCHEMES.map(t => t.fields.map(f => Object.assign(new E.Button({ w: PANEL_R - PANEL_X, h: 48, sfx: null, label: f.label, onClick: () => this.edit(f) }), { f })));
    this.useBtn = new E.Button({ w: 380, h: 52, label: '使用此方案', onClick: () => { this.commit(); this.cfg.scheme = SCHEMES[this.subIdx].scheme; } });
    const bridgeHit = Math.max(56, Math.ceil(44 * (E.view?.dpr || 1) / (E.view?.scale || 1)));
    this.bridgeBtns = [
      new E.Button({ w: 760, h: 56, label: '对手由外部 LLM 接管(MCP 桥)', onClick: () => {
        if (this.returnTo?.options?.multiplayerRoom) { this.bridgeNote = '联机房间不能启用'; return; }
        this.bridgeEnabled = !this.bridgeEnabled;
      } }),
      new E.Button({ w: 760, h: 56, label: '选择接管国家', onClick: () => {
        const ids = this.bridgeCountries(); if (!ids.length) return;
        this.bridgeCountry = ids[(ids.indexOf(this.bridgeCountry) + 1) % ids.length];
      } }),
      new E.Button({ w: 760, h: 56, label: '桥地址', onClick: () => this.editBridge('bridgeUrl') }),
      new E.Button({ w: 760, h: 56, label: 'LLM 超时分钟', onClick: () => this.editBridge('bridgeTimeoutMinutes') }),
      new E.Button({ w: 760, h: 56, label: '一键复制接管指令', onClick: () => this.copyBridge(false) }),
      new E.Button({ w: 380, h: 56, label: '仅复制ID', onClick: () => this.copyBridge(true) }),
    ];
    this.bridgeBtns.forEach(b => { b.h = bridgeHit; });
    this.bridgeStatusTimer = setInterval(() => this.refreshBridgeStatus(), 5000);
    this.refreshBridgeStatus();

    this.updateScrollLayout();
  }
  merge(o) {
    const d = this.cfg;
    if (o.scheme === 2) {
      d.scheme = 0; // 旧“MCP 服务”方案已移除；对战桥改在对局配置里设置
    } else if (o.scheme != null) {
      d.scheme = o.scheme;
    }
    for (const k of ['all_ai_countries', 'max_actions_per_turn']) if (o[k] != null) d[k] = o[k];
    if (o.scheme1) Object.assign(d.scheme1, o.scheme1);
  }

  updateScrollLayout() {
    const sideContentH = TABS.length * 106 + 30;
    this.sideMaxScroll = Math.max(0, sideContentH - 580);
    this.sideScrollY = E.clamp(this.sideScrollY, 0, this.sideMaxScroll);
    if (this.side) {
      for (const b of this.side) {
        b.y = b.baseY - this.sideScrollY;
        b.enabled = (b.y + b.h >= 140 && b.y <= 790);
      }
    }

    let contentH = 600;
    if (this.tab === 'effects') {
      contentH = 1220;
      if (this.roomBtns?.length) contentH = this.roomTitleY + 225;
    } else if (this.tab === 'takeover') {
      const fieldCount = this.fieldBtns[this.subIdx]?.length || 0;
      if (SCHEMES[this.subIdx]?.name === '对战桥') {
        const res = this.bridgeMgr ? this.bridgeMgr.collectWidgets(this.contentScrollY) : { totalHeight: 800 };
        contentH = res.totalHeight || 800;
      } else {
        contentH = 360 + fieldCount * 82 + 100;
      }
    } else if (this.tab === 'logs') {
      contentH = 650;
    } else if (this.tab === 'hotkeys') {
      contentH = 250 + E.hotkeys.actions.length * 88 + 20 + 76 + 380;
    }
    this.contentMaxScroll = Math.max(0, contentH - 620);
    this.contentScrollY = E.clamp(this.contentScrollY, 0, this.contentMaxScroll);

    const sy = this.contentScrollY;
    if (this.tab === 'volume' && this.bgmSlider) {
      for (const slider of [this.bgmSlider, this.sfxSlider]) {
        slider.ty = slider.baseTy - sy;
        slider.enabled = slider.ty >= 140 && slider.ty <= 790;
      }
    } else if (this.tab === 'game' && this.moveSlider) {
      this.moveSlider.ty = this.moveSlider.baseTy - sy;
      this.moveSlider.enabled = (this.moveSlider.ty >= 140 && this.moveSlider.ty <= 790);
      this.fsToggle.y = this.fsToggle.baseY - sy; this.fsToggle.enabled = (this.fsToggle.y + this.fsToggle.h >= 140 && this.fsToggle.y <= 790);
      this.aiFollowToggle.y = this.aiFollowToggle.baseY - sy;
      this.aiFollowToggle.enabled = (this.aiFollowToggle.y + this.aiFollowToggle.h >= 140 && this.aiFollowToggle.y <= 790);
    } else if (this.tab === 'effects') {
      for (const s of [this.smokeSlider, this.fireSlider, this.blurSlider, this.glowSlider, this.fatigueSlider, this.desktopRatioSlider]) {
        if (s) {
          s.ty = s.baseTy - sy;
          s.enabled = (s.ty >= 140 && s.ty <= 790);
        }
      }
      if (this.desktopReboundBtn) {
        this.desktopReboundBtn.y = this.desktopReboundBtn.baseY - sy;
        this.desktopReboundBtn.x = this.desktopReboundBtn.baseX;
        this.desktopReboundBtn.enabled = (this.desktopReboundBtn.y + this.desktopReboundBtn.h >= 140 && this.desktopReboundBtn.y <= 790);
      }
      if (this.desktopBtns) {
        this.desktopScrollX = E.clamp(this.desktopScrollX, 0, this.desktopMaxScroll());
        for (const b of this.desktopBtns) {
          b.y = b.baseY - sy;
          b.x = b.baseX - this.desktopScrollX;
          b.enabled = b.x >= 730 && b.x + b.w <= 1458 && b.y + b.h >= 140 && b.y <= 790;
        }
        for (const b of this.desktopArrows || []) {
          b.x = b.baseX; b.y = b.baseY - sy;
          b.enabled = b.y + b.h >= 140 && b.y <= 790 && (b.dir < 0 ? this.desktopScrollX > 0 : this.desktopScrollX < this.desktopMaxScroll());
        }
        this.roomScrollX = E.clamp(this.roomScrollX, 0, this.roomMaxScroll());
        for (const b of this.roomBtns || []) {
          b.y = b.baseY - sy; b.x = b.baseX - this.roomScrollX;
          b.enabled = b.x >= 730 && b.x + b.w <= 1458 && b.y + b.h >= 140 && b.y <= 790;
        }
        for (const b of this.roomArrows || []) {
          b.x = b.baseX; b.y = b.baseY - sy;
          b.enabled = b.y + b.h >= 140 && b.y <= 790 && (b.dir < 0 ? this.roomScrollX > 0 : this.roomScrollX < this.roomMaxScroll());
        }
      }
    } else if (this.tab === 'hotkeys' && this.hkBtns) {
      for (const b of [...this.hkBtns, this.hkReset]) { b.y = b.baseY - sy; b.enabled = (b.y + b.h >= 140 && b.y <= 790); }
    } else if (this.tab === 'logs' && this.logToggle) {
      this.logToggle.y = this.logToggle.baseY - sy;
      this.clearLogs.y = this.clearLogs.baseY - sy;
      this.logToggle.enabled = (this.logToggle.y + this.logToggle.h >= 140 && this.logToggle.y <= 790);
      this.clearLogs.enabled = (this.clearLogs.y + this.clearLogs.h >= 140 && this.clearLogs.y <= 790);
    } else if (this.tab === 'takeover' && this.subTabs) {
      this.subTabs.forEach(b => {
        b.y = b.baseY - sy;
        b.enabled = (b.y + b.h >= 140 && b.y <= 790);
      });
      const btns = this.fieldBtns[this.subIdx] || [];
      const y0 = 366, step = 82;
      btns.forEach((b, i) => {
        b.x = PANEL_X;
        b.y = (y0 + i * step + 26) - sy;
        b.enabled = (b.y + b.h >= 140 && b.y <= 790);
      });
      if (this.useBtn) {
        this.useBtn.x = PANEL_X;
        this.useBtn.y = (btns.length ? y0 + btns.length * step + 16 : 430) - sy;
        this.useBtn.enabled = (this.useBtn.y + this.useBtn.h >= 140 && this.useBtn.y <= 790);
      }
      this.bridgeBtns?.forEach((b, i) => {
        b.x = PANEL_X; b.y = 300 + i * Math.max(70, b.h + 8) - sy;
        b.enabled = b.y + b.h >= 140 && b.y <= 790;
      });
    }
  }

  // ---- scrolling & pointer interaction ----
  desktopMaxScroll() { return Math.max(0, ((this.desktopBtns?.length || 0) - 3) * 246); }
  roomMaxScroll() { return Math.max(0, ((this.roomBtns?.length || 0) - 3) * 246); }
  overCarousel(c) {
    if (this.tab !== 'effects' || c.x < 730 || c.x > 1458) return null;
    const deskTop = 1080 - this.contentScrollY, roomTop = this.roomTitleY + 40 - this.contentScrollY;
    if (c.y >= deskTop && c.y <= deskTop + 100) return 'desks';
    if (c.y >= roomTop && c.y <= roomTop + 160) return 'rooms';
    return null;
  }
  pointerDown(p) {
    if (this.dialog) { this.dialog.down(p); return; }
    const c = this.cp(p);
    this.updateScrollLayout();
    const carousel = this.overCarousel(c);
    this.dragScroll = {
      area: carousel || (c.x < PANEL_X ? 'side' : 'content'),
      startX: c.x, startY: c.y,
      startScroll: carousel === 'rooms' ? this.roomScrollX : carousel === 'desks' ? this.desktopScrollX : c.x < PANEL_X ? this.sideScrollY : this.contentScrollY,
      moved: false,
    };
    super.pointerDown(p);
  }
  pointerMove(p) {
    if (this.dialog) { if (this.dialog.move) this.dialog.move(p); return; }
    const c = this.cp(p);
    if (this.dragScroll) {
      const dy = c.y - this.dragScroll.startY, dx = c.x - this.dragScroll.startX;
      if (Math.abs(['rooms', 'desks'].includes(this.dragScroll.area) ? dx : dy) > 8) {
        this.dragScroll.moved = true;
        const isSliderDragging = [this.bgmSlider, this.sfxSlider, this.moveSlider, this.smokeSlider, this.fireSlider, this.blurSlider, this.glowSlider, this.fatigueSlider, this.desktopRatioSlider].some(s => s && s.drag);
        if (!isSliderDragging) {
          if (this.dragScroll.area === 'desks') {
            this.desktopScrollX = E.clamp(this.dragScroll.startScroll - dx, 0, this.desktopMaxScroll());
          } else if (this.dragScroll.area === 'rooms') {
            this.roomScrollX = E.clamp(this.dragScroll.startScroll - dx, 0, this.roomMaxScroll());
          } else if (this.dragScroll.area === 'side') {
            this.sideScrollY = E.clamp(this.dragScroll.startScroll - dy, 0, this.sideMaxScroll);
          } else {
            this.contentScrollY = E.clamp(this.dragScroll.startScroll - dy, 0, this.contentMaxScroll);
          }
          this.updateScrollLayout();
        }
      }
    }
    super.pointerMove(p);
  }
  pointerUp(p) {
    if (this.dragScroll && this.dragScroll.moved) {
      const isSliderDragging = [this.bgmSlider, this.sfxSlider, this.moveSlider, this.smokeSlider, this.fireSlider, this.blurSlider, this.glowSlider, this.fatigueSlider, this.desktopRatioSlider].some(s => s && s.drag);
      if (!isSliderDragging) {
        this.focusables().forEach(b => { if (b.pressed) b.pressed = false; });
        this.dragScroll = null;
        return;
      }
    }
    this.dragScroll = null;
    super.pointerUp(p);
  }
  wheel(dy) {
    if (this.dialog) { if (this.dialog.wheel) this.dialog.wheel(dy); return; }
    const c = this.cp(E.pointer);
    const delta = dy < 0 ? -60 : 60;
    this.updateScrollLayout();
    if (this.overCarousel(c) === 'desks') {
      this.desktopScrollX = E.clamp(this.desktopScrollX + (dy < 0 ? -246 : 246), 0, this.desktopMaxScroll());
    } else if (this.overCarousel(c) === 'rooms') {
      this.roomScrollX = E.clamp(this.roomScrollX + (dy < 0 ? -246 : 246), 0, this.roomMaxScroll());
    } else if (c.x < PANEL_X) {
      this.sideScrollY = E.clamp(this.sideScrollY + delta, 0, this.sideMaxScroll);
    } else {
      this.contentScrollY = E.clamp(this.contentScrollY + delta, 0, this.contentMaxScroll);
    }
    this.updateScrollLayout();
  }

  // ---- editing overlay (real <input> positioned over the canvas field) ----
  edit(f) {
    this.commit();
    const sc = SCHEMES[this.subIdx], b = this.fieldBtns[this.subIdx].find(x => x.f === f);
    const r = E.logicalRect(), k = E.view.scale / E.view.dpr;
    const el = document.createElement('input');
    el.type = 'text'; el.value = this.cfg[sc.key][f.key] || ''; el.spellcheck = false; el.autocomplete = 'off';
    Object.assign(el.style, { position: 'fixed', left: r.left + (b.x + E.ox) * k + 'px', top: r.top + (b.y + E.oy) * k + 'px', width: b.w * k + 'px', height: b.h * k + 'px',
      boxSizing: 'border-box', font: `${Math.round(30 * k)}px ${SERIF}`, padding: `0 ${Math.round(18 * k)}px`, background: '#fff8e1', color: '#2b1a08',
      border: '3px solid #e6a33a', borderRadius: '8px', outline: 'none', zIndex: 10 });
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') this.commit(); if (e.key === 'Escape') { this.input = null; el.remove(); } });
    el.addEventListener('blur', () => this.commit());
    document.body.appendChild(el); el.focus(); el.select();
    this.input = { el, key: sc.key, f };
  }
  commit() { if (!this.input) return; const { el, key, f } = this.input; this.input = null; this.cfg[key][f.key] = el.value.trim(); el.remove(); }
  onMove(p) { for (const s of [this.bgmSlider, this.sfxSlider, this.moveSlider, this.smokeSlider, this.fireSlider, this.blurSlider, this.glowSlider, this.fatigueSlider, this.desktopRatioSlider]) if (s && s.drag) s.set(s.valueAt(p)); }
  dispose() { clearInterval(this.bridgeStatusTimer); this.bridgeMgr?.dispose(); if (this.input) { this.input.el.remove(); this.input = null; } }
  bridgeCountries() {
    const game = this.returnTo?.game;
    return game?.stage?.data?.countries?.filter(c => c.id).map(c => c.id) || [];
  }
  async refreshBridgeStatus() {
    if (!this.bridgeEnabled) { this.bridgeStatus = '未启动'; return; }
    try {
      const res = await fetch(`${this.bridgeUrl.replace(/\/$/, '')}/bridge/status`);
      const status = await res.json();
      this.bridgeStatus = status.llmOnline ? '已连接且 LLM 在线' : '已连接，等待 LLM';
    } catch { this.bridgeStatus = '桥未启动'; }
  }
  editBridge(key) {
    this.commit();
    const b = this.bridgeBtns[key === 'bridgeUrl' ? 2 : 3];
    const rect = E.logicalRect(), scale = E.view.scale / E.view.dpr;
    const el = document.createElement('input');
    el.type = key === 'bridgeTimeoutMinutes' ? 'number' : 'text'; el.value = this[key];
    Object.assign(el.style, { position: 'fixed', left: rect.left + (b.x + E.ox) * scale + 'px', top: rect.top + (b.y + E.oy) * scale + 'px', width: b.w * scale + 'px', height: b.h * scale + 'px', boxSizing: 'border-box', background: '#fff8e1', border: '3px solid #e6a33a', zIndex: 20 });
    document.body.appendChild(el); el.focus(); el.select();
    const done = () => { this[key] = el.value.trim(); el.remove(); };
    el.addEventListener('blur', done, { once: true });
    el.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') el.blur(); });
  }
  async copyBridge(idOnly) {
    const game = this.returnTo?.game;
    if (!game) { this.bridgeNote = '开始对局后生成'; return; }
    if (!this.bridgeEnabled) { this.bridgeNote = '请先开启接管'; return; }
    const id = game.gameId;
    const text = idOnly ? id : bridgePrompt({ gameId: id, country: this.bridgeCountry || this.bridgeCountries()[0], stage: game.name, player: game.player, url: this.bridgeUrl });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      this.bridgeNote = '已复制';
    } catch {
      const box = document.createElement('textarea');
      box.value = text; Object.assign(box.style, { position: 'fixed', left: '10%', top: '20%', width: '80%', height: '40%', zIndex: 30 });
      document.body.appendChild(box); box.focus(); box.select();
      if (document.execCommand('copy')) { box.remove(); this.bridgeNote = '已复制'; }
      else { this.bridgeNote = '请在文本框中手动复制'; box.addEventListener('blur', () => box.remove(), { once: true }); }
    }
    setTimeout(() => { if (this.bridgeNote === '已复制') this.bridgeNote = ''; }, 1500);
  }

  async selectDesktop(d) {
    this.desktopTexture = d.id;
    E.state.desktopTexture = d.id;
    E.saveState();
    try {
      const img = d.img || await E.image(d.file);
      d.img = img;
      if (this.returnTo?.map) this.returnTo.map.desktop = d.framed || (d.framed = frameDesktop(img, 2048, d.id));
    } catch (e) {}
  }

  leave() { E.state.lastOptionsTab = this.tab; E.saveState(); E.go(this.returnTo || 'home'); }
  onBack() {
    this.dispose();
    E.setMusicVolume(E.state.music);
    if (this.returnTo?.map) {
      const deskItem = desktopById(E.state.desktopTexture);
      if (deskItem.img) this.returnTo.map.desktop = deskItem.framed || (deskItem.framed = frameDesktop(deskItem.img, 2048, deskItem.id));
    }
    this.leave();
  }
  async onOk() {
    this.commit();
    const s = E.state;
    Object.assign(s, {
      music: this.bgmVol, sfx: this.sfxVol, battleAnimation: false, gameSpeed: 5,
      moveSpeed: this.moveSpeed, smoke: this.smoke, fire: this.fire,
      selectionTransparency: this.selectionTransparency,
      groupGlowIntensity: this.groupGlowIntensity,
      fatigueMultiplier: this.fatigueMultiplier,
      desktopRatio: this.desktopRatio,
      desktopRebound: this.desktopRebound,
      desktopTexture: this.desktopTexture,
      roomBackdrop: this.roomBackdrop,
    });
    s.logEnabled = this.logEnabled; s.autoFullscreen = this.autoFs;
    s.aiFollowCamera = this.aiFollowCamera;
    s.bridgeEnabled = this.bridgeEnabled && !this.returnTo?.options?.multiplayerRoom;
    s.bridgeCountries = Array.from(this.bridgeCountriesSelected || []);
    s.bridgeCountry = s.bridgeCountries[0] || this.bridgeCountry || this.bridgeCountries()[0] || '';
    s.bridgeUrl = this.bridgeUrl;
    s.bridgeTimeoutMinutes = Math.max(1, Number(this.bridgeTimeoutMinutes) || 10);
    s.bridgeTimeoutAction = this.bridgeTimeoutAction || 'wait';
    if (this.returnTo?.game) {
      this.returnTo.bridgeEnabled = s.bridgeEnabled;
      this.returnTo.bridgeCountries = s.bridgeCountries;
      this.returnTo.bridgeCountry = s.bridgeCountry;
      this.returnTo.configureBridge?.();
    }
    try { localStorage.setItem('wc2-ai-follow-camera', String(this.aiFollowCamera)); } catch (e) {}
    if (this.returnTo?.game) this.returnTo.game.logEnabled = this.logEnabled;
    if (this.returnTo?.map) {
      const deskItem = desktopById(this.desktopTexture);
      try {
        const img = deskItem.img || await E.image(deskItem.file);
        this.returnTo.map.desktop = deskItem.framed || (deskItem.framed = frameDesktop(img, 2048, deskItem.id));
      } catch (e) {}
    }
    delete s.fatigueEffect;
    delete s.activeGlowEffect;
    E.saveState();
    const body = JSON.stringify(this.cfg);
    try { localStorage.setItem('wc2.aiconfig', body); } catch (e) {}
    if (E.updateAiConfig) {
      E.updateAiConfig(this.cfg);
    } else {
      E.aiConfig = JSON.parse(body);
    }
    this.dispose(); this.leave();
  }
  key(e) {
    if (this.capture) { this.captureKey(e); return; }               // waiting for the new key of a shortcut
    if (E.hotkeys.match(e) === 'options') { this.onBack(); return; }   // pressing the same 打开设置 hotkey again exits, same as Escape
    const f = E.focus;
    if (!this.dialog && f && f.adjust && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); E.keyboard = true; f.adjust(e.key === 'ArrowLeft' ? -1 : 1); return; }
    super.key(e);
  }

  // ---- drawing ----
  drawChrome() {
    E.text('选项', E.W / 2, 80, { size: 44, bold: true, align: 'center', color: '#3d2412' });
    super.drawChrome();
  }
  renderBg() {
    E.cover(this.bg);
    const sx = E.W / 948, sy = E.H / 503;
    E.layout.canvas(E.ctx, 'scenes/options.js/original').drawImage(this.board, -37 * sx, -2 * sy, 1024 * sx, 530 * sy);
  }
  drawSidebar() {
    const c = E.ctx;
    c.save();
    E.layout.canvas(c, 'scenes/options.js/original').beginPath();
    E.layout.canvas(c, 'scenes/options.js/original').rect(50, 140, 520, 650);
    E.layout.canvas(c, 'scenes/options.js/original').clip();
    for (const b of this.side) {
      const on = b.t.id === this.tab, f = E.fx(b);
      c.save();
      if (on) { c.fillStyle = '#f8edd3'; E.layout.canvas(c, 'scenes/options.js/original').fillRect(b.x, b.y, b.w, b.h); c.fillStyle = '#8b1a1a'; E.layout.canvas(c, 'scenes/options.js/original').fillRect(b.x, b.y, 12, b.h); }
      else if (b.hover) { c.fillStyle = 'rgba(255,255,255,0.28)'; E.layout.canvas(c, 'scenes/options.js/original').fillRect(b.x, b.y, b.w, b.h); }
      c.restore();
      E.text(b.t.name, b.x + 42, b.y + b.h / 2 + 2 + f.dy, { size: 46, bold: true, font: SERIF, color: on ? '#2a1408' : '#5b2e12' });
      c.save(); c.strokeStyle = '#2a1408'; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
      E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').moveTo(b.x + b.w - 62, b.y + b.h / 2 - 18); E.layout.canvas(c, 'scenes/options.js/original').lineTo(b.x + b.w - 44, b.y + b.h / 2); E.layout.canvas(c, 'scenes/options.js/original').lineTo(b.x + b.w - 62, b.y + b.h / 2 + 18); E.layout.canvas(c, 'scenes/options.js/original').stroke();
      c.strokeStyle = 'rgba(70,48,22,0.6)'; c.lineWidth = 2; E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').moveTo(b.x + 8, b.y + b.h + 5); E.layout.canvas(c, 'scenes/options.js/original').lineTo(b.x + b.w - 8, b.y + b.h + 5); E.layout.canvas(c, 'scenes/options.js/original').stroke();
      c.restore();
    }
    c.restore();
  }
  drawSlider(s, v) {
    return E.layout.group(s, 'scenes/options/slider', () => this.drawSliderTrack(s, v));
  }
  drawSliderTrack(s, v) { return drawSliderTrack(s, v); }

  drawVolume() {
    for (const [slider, value, label] of [[this.bgmSlider, this.bgmVol, 'BGM 音量'], [this.sfxSlider, this.sfxVol, '音效音量']]) {
      this.drawSlider(slider, value);
      E.text(label, 745, slider.ty, { size: 27, bold: true, align: 'right', color: '#3d2412' });
    }
  }
  drawGame() {
    this.drawSlider(this.moveSlider, posOf(this.moveSpeed));
    E.text('单位移动速度', 745, this.moveSlider.ty, { size: 27, bold: true, align: 'right', color: '#3d2412' });
    const b = this.fsToggle, f = E.fx(b);
    E.panel(b.x, b.y + f.dy, b.w, b.h, { fill: b.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
    E.text(this.autoFs ? '启动时全屏：开' : '启动时全屏：关', b.x + b.w / 2, b.y + b.h / 2 + f.dy, { size: 32, bold: true, align: 'center', color: '#fff' });
    E.text('开启后游戏以无边框全屏启动；进入战斗的摄影模式也会全屏。', PANEL_X, b.y + b.h + 40, { size: 24, color: '#5a3d18' });
    const follow = this.aiFollowToggle, ff = E.fx(follow);
    E.panel(follow.x, follow.y + ff.dy, follow.w, follow.h, { fill: follow.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
    E.text(`AI 回合镜头自动跟随：${this.aiFollowCamera ? '开' : '关'}`, follow.x + follow.w / 2, follow.y + follow.h / 2 + ff.dy, { size: 30, bold: true, align: 'center', color: '#fff' });
  }
  drawDesktopSelector() {
    const c = E.ctx;
    const titleY = 1040 - this.contentScrollY;
    E.text('选择桌面', 730 - 30, titleY, { size: 27, bold: true, font: SERIF, align: 'right', color: '#3d2412' });
    E.text('拖动或滚轮切换', 730, titleY, { size: 22, color: '#5a3d18' });
    c.save(); E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').rect(730, 1080 - this.contentScrollY, 728, 100); E.layout.canvas(c, 'scenes/options.js/original').clip();
    for (const b of this.desktopBtns) {
      if (b.x + b.w < 730 || b.x > 1458 || b.y + b.h < 140 || b.y > 790) continue;
      if (!b.d.img && !b.d.previewLoading && !b.d.previewFailed) {
        b.d.previewLoading = true;
        E.image(b.d.file).then(img => { b.d.img = img; b.d.preview = frameDesktop(img, 256, b.d.id); })
          .catch(() => { b.d.previewFailed = true; }).finally(() => { b.d.previewLoading = false; });
      }
      const isSel = this.desktopTexture === b.d.id;
      const f = E.fx(b);
      const bx = b.x, by = b.y + f.dy, bw = b.w, bh = b.h;

      // 1. Draw rounded thumbnail image
      c.save();
      E.layout.canvas(c, 'scenes/options.js/original').beginPath();
      E.layout.canvas(c, 'scenes/options.js/original').roundRect(bx, by, bw, bh, 8);
      E.layout.canvas(c, 'scenes/options.js/original').clip();

      if (b.d.img) {
        E.layout.canvas(c, 'scenes/options.js/original').drawImage(b.d.preview || b.d.img, bx, by, bw, bh);
      } else {
        c.fillStyle = '#4a2c0e';
        E.layout.canvas(c, 'scenes/options.js/original').fillRect(bx, by, bw, bh);
      }
      c.restore();

      // 2. Stroke border (gold when selected, white/light on hover)
      c.save();
      E.layout.canvas(c, 'scenes/options.js/original').beginPath();
      E.layout.canvas(c, 'scenes/options.js/original').roundRect(bx, by, bw, bh, 8);
      c.lineWidth = isSel ? 4 : (b.hover ? 3 : 2);
      c.strokeStyle = isSel ? '#ffe066' : (b.hover ? '#ffffff' : 'rgba(181, 143, 82, 0.7)');
      E.layout.canvas(c, 'scenes/options.js/original').stroke();

      // 3. Selection checkmark badge in bottom-right corner (NO TEXT)
      if (isSel) {
        const badgeR = 14;
        const cx = bx + bw - badgeR - 6;
        const cy = by + bh - badgeR - 6;
        E.layout.canvas(c, 'scenes/options.js/original').beginPath();
        E.layout.canvas(c, 'scenes/options.js/original').arc(cx, cy, badgeR, 0, Math.PI * 2);
        c.fillStyle = '#2c7a1e';
        E.layout.canvas(c, 'scenes/options.js/original').fill();
        c.lineWidth = 2;
        c.strokeStyle = '#ffffff';
        E.layout.canvas(c, 'scenes/options.js/original').stroke();
        E.text('✓', cx, cy + 1, { size: 18, bold: true, align: 'center', color: '#ffffff' });
      }
      c.restore();
    }
    c.restore();
    for (const b of this.desktopArrows || []) {
      if (b.y + b.h < 140 || b.y > 790) continue;
      E.panel(b.x, b.y, b.w, b.h, { fill: b.enabled ? '#604a30' : '#a99a7b', stroke: '#3d2412', r: 5 });
      E.text(b.dir < 0 ? '‹' : '›', b.x + b.w / 2, b.y + b.h / 2, { size: 36, bold: true, align: 'center', base: 'middle', color: '#f4e8c7' });
    }
  }
  // 房间背景: 3D mode's room round the desk; the name under each thumbnail, "none" drawn as the dark void
  drawRoomSelector() {
    if (!this.roomBtns?.length) return;
    const c = E.ctx;
    E.text('房间背景', 730 - 30, this.roomTitleY - this.contentScrollY, { size: 27, bold: true, font: SERIF, align: 'right', color: '#3d2412' });
    E.text('仅 3D 模式可见 · 拖动或滚轮切换', 730, this.roomTitleY - this.contentScrollY, { size: 22, color: '#5a3d18' });
    c.save(); E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').rect(730, this.roomTitleY + 40 - this.contentScrollY, 728, 160); E.layout.canvas(c, 'scenes/options.js/original').clip();
    for (const b of this.roomBtns) {
      if (b.x + b.w < 730 || b.x > 1458 || b.y + b.h < 140 || b.y > 790) continue;
      if (b.r.thumb && !b.r.img && !b.r.previewLoading && !b.r.previewFailed) {
        b.r.previewLoading = true;
        E.image(b.r.thumb).then(img => { b.r.img = img; }).catch(() => { b.r.previewFailed = true; })
          .finally(() => { b.r.previewLoading = false; });
      }
      const isSel = this.roomBackdrop === b.r.id, f = E.fx(b);
      const bx = b.x, by = b.y + f.dy, bw = b.w, bh = b.h;
      c.save();
      E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(bx, by, bw, bh, 8); E.layout.canvas(c, 'scenes/options.js/original').clip();
      if (b.r.img) {                                             // cover-fit the thumbnail
        const im = b.r.img, sc = Math.max(bw / im.width, bh / im.height);
        E.layout.canvas(c, 'scenes/options.js/original').drawImage(im, bx + (bw - im.width * sc) / 2, by + (bh - im.height * sc) / 2, im.width * sc, im.height * sc);
      } else { c.fillStyle = '#1a1612'; E.layout.canvas(c, 'scenes/options.js/original').fillRect(bx, by, bw, bh); }
      c.restore();
      c.save();
      E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(bx, by, bw, bh, 8);
      c.lineWidth = isSel ? 4 : (b.hover ? 3 : 2);
      c.strokeStyle = isSel ? '#ffe066' : (b.hover ? '#ffffff' : 'rgba(181, 143, 82, 0.7)');
      E.layout.canvas(c, 'scenes/options.js/original').stroke();
      if (isSel) {
        const R = 14, cx = bx + bw - R - 6, cy = by + bh - R - 6;
        E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').arc(cx, cy, R, 0, Math.PI * 2); c.fillStyle = '#2c7a1e'; E.layout.canvas(c, 'scenes/options.js/original').fill();
        c.lineWidth = 2; c.strokeStyle = '#ffffff'; E.layout.canvas(c, 'scenes/options.js/original').stroke();
        E.text('✓', cx, cy + 1, { size: 18, bold: true, align: 'center', color: '#ffffff' });
      }
      c.restore();
      E.text(b.r.name || b.r.id, bx + bw / 2, by + bh + 22, { size: 22, align: 'center', color: isSel ? '#2c1a08' : '#5a3d18', bold: isSel });
    }
    c.restore();
    for (const b of this.roomArrows || []) {
      if (b.y + b.h < 140 || b.y > 790) continue;
      E.panel(b.x, b.y, b.w, b.h, { fill: b.enabled ? '#604a30' : '#a99a7b', stroke: '#3d2412', r: 5 });
      E.text(b.dir < 0 ? '‹' : '›', b.x + b.w / 2, b.y + b.h / 2, { size: 36, bold: true, align: 'center', base: 'middle', color: '#f4e8c7' });
    }
  }
  drawEffects() {
    const glowPct = Math.round(this.groupGlowIntensity * 100);
    const rows = [
      [this.smokeSlider, this.smoke, '烟雾浓度'],
      [this.fireSlider, this.fire, '爆炸火光'],
      [this.blurSlider, this.selectionTransparency, '待选框透明'],
      [this.glowSlider, this.groupGlowIntensity / 3, `集团军光晕浓度 ${glowPct}%`],
      [this.fatigueSlider, (this.fatigueMultiplier - 1) / 4, `疲惫倍率 ×${this.fatigueMultiplier}`],
      [this.desktopRatioSlider, (this.desktopRatio - 1.0) / 9.0, `桌面比例 ×${this.desktopRatio.toFixed(1)}`],
    ];
    const style = { size: 27, bold: true, font: SERIF, align: 'right', color: '#3d2412' };
    for (const [slider, value, label] of rows) {
      this.drawSlider(slider, value);
      const fs = label.length > 9 ? 19 : label.length > 5 ? 24 : 27;
      E.text(label, slider.tx - 45, slider.ty, { ...style, size: fs });
    }
    if (this.desktopReboundBtn) {
      const b = this.desktopReboundBtn, f = E.fx(b);
      const on = this.desktopRebound;
      E.panel(b.x, b.y + f.dy, b.w, b.h, {
        fill: on ? (b.hover ? '#3a782b' : '#2d6320') : (b.hover ? '#634b35' : '#4a3726'),
        stroke: on ? '#9fe67e' : '#b58f52'
      });
      E.text(on ? '桌面回弹：开启' : '桌面回弹：关闭', b.x + b.w / 2, b.y + b.h / 2 + f.dy + 1, {
        size: 26, bold: true, align: 'center', color: on ? '#f0ffe6' : '#dfcca8'
      });
      E.text('拖动边界', b.x - 55, b.y + b.h / 2 + f.dy + 1, style);
    }
    this.drawDesktopSelector();
    this.drawRoomSelector();
  }
  // ---- 快捷键: every action in E.hotkeys.actions with its key; click the key box, then press the new key ----
  startCapture(id) { this.capture = id; this.hkNote = ''; E.playSfx('btn.wav'); }
  captureKey(e) {
    e.preventDefault();
    const id = this.capture;
    if (e.key === 'Escape') { this.capture = null; this.hkNote = '已取消'; return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { E.hotkeys.set(id, ''); this.capture = null; this.hkNote = '已清除'; return; }
    const k = E.hotkeys.name(e); if (!k) return;                             // a bare Shift / Ctrl / Alt: keep waiting for the real key
    const taken = E.hotkeys.set(id, k); this.capture = null;
    this.hkNote = taken ? `「${taken.name}」原来使用这个键，已被取消` : '已设置为 ' + E.hotkeys.pretty(k);
  }
  drawHotkeys() {
    const sy = this.contentScrollY;
    E.text('快捷键', PANEL_X, 150 - sy, { size: 42, bold: true, font: SERIF, color: '#3d2412' });
    E.text('点击右侧按键框，再按下想要的键；Backspace 清除，Esc 取消。同一个键只能对应一个功能。', PANEL_X, 196 - sy, { size: 22, color: '#5a3d18' });
    for (const b of this.hkBtns) {
      const on = this.capture === b.a.id, f = E.fx(b), key = E.hotkeys.of(b.a.id);
      E.text(b.a.name, PANEL_X, b.y + b.h / 2, { size: 32, bold: true, color: '#3d2412' });
      E.panel(b.x, b.y + f.dy, b.w, b.h, { fill: on ? '#8a4b12' : b.hover ? '#7e5b27' : '#5a4020', stroke: on ? '#ffd35a' : '#d8b66c' });
      E.text(on ? '请按下按键…' : E.hotkeys.pretty(key), b.x + b.w / 2, b.y + b.h / 2 + f.dy, { size: 30, bold: true, align: 'center', color: on ? '#ffe9a8' : key ? '#fff' : '#b9a67a' });
    }
    const r = this.hkReset, f = E.fx(r);
    E.panel(r.x, r.y + f.dy, r.w, r.h, { fill: r.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
    E.text('恢复默认快捷键', r.x + r.w / 2, r.y + r.h / 2 + f.dy, { size: 30, bold: true, align: 'center', color: '#fff' });
    if (this.hkNote) E.text(this.hkNote, r.x + r.w + 30, r.y + r.h / 2, { size: 26, color: '#7a2d12' });
    // what each keyboard action is on a touch screen
    const ty = r.y + r.h + 50;
    E.text('触屏对应操作', PANEL_X, ty, { size: 34, bold: true, font: SERIF, color: '#3d2412' });
    ['暂停 / 卡片 / 结束回合：屏幕右上 / 左下 / 右下角的按钮', '取消选择：点空白处', '缩放：双指捏合，或屏幕右侧的 ＋ －', '平移地图：单指拖动（双指可同时缩放和平移）',
      '切换 2D / 3D、摄影模式、摆件：屏幕右侧的按钮，或暂停菜单', '摄影模式：四击屏幕进入 / 退出', '摆件旋转 / 删除：选中后用摆件上的手柄；列表：单指上下拖动'].forEach((l, i) =>
      E.text(l, PANEL_X, ty + 48 + i * 34, { size: 24, color: '#5a3d18' }));
  }
  drawLogs() {
    const c = E.ctx;
    const sy = this.contentScrollY;
    E.text('对局日志', PANEL_X, 150 - sy, { size: 42, bold: true, font: SERIF, color: '#3d2412' });
    for (const b of [this.logToggle, this.clearLogs]) {
      const f = E.fx(b); E.panel(b.x, b.y + f.dy, b.w, b.h, { fill: b.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
      E.text(b === this.logToggle ? (this.logEnabled ? '日志：开启' : '日志：关闭') : '清理全部自动保存日志', b.x + b.w / 2, b.y + b.h / 2 + f.dy, { size: 32, bold: true, align: 'center', color: '#fff4cf' });
    }
    E.text('日志会在事件发生后自动保存；清理不会删除对局存档。', PANEL_X, 540 - sy, { size: 26, color: '#5a3d18' });
  }
  drawTakeover() {
    const c = E.ctx, sc = SCHEMES[this.subIdx], sy = this.contentScrollY;
    const bridgeIdx = SCHEMES.findIndex(s => s.name === '对战桥');
    if (this.subIdx === bridgeIdx) {
      this.subTabs.forEach(b => {
        E.panel(b.x, b.y, b.w, b.h, { fill: b.i === bridgeIdx ? '#7d5520' : '#453018', stroke: '#d8b66c' });
        E.text(b.t.name, b.x + b.w / 2, b.y + b.h / 2, { size: 25, bold: true, align: 'center', color: '#fff4cf' });
      });
      this.drawBridgeSettings();
      return;
    }
    const isCurrentActive = this.cfg.scheme === sc.scheme;

    // 1. 顶部方案 Tab (内置 AI / LLM 接管 / MCP 服务)
    this.subTabs.forEach(b => {
      const isViewing = b.i === this.subIdx, isEffective = this.cfg.scheme === b.t.scheme;
      const f = E.fx(b);
      E.panel(b.x, b.y + f.dy, b.w, b.h, {
        fill: isViewing ? (b.hover ? '#966a2a' : '#7d5520') : (b.hover ? '#5a4020' : 'rgba(55,34,14,0.85)'),
        stroke: isViewing ? '#ffe494' : '#9a7442',
        lineWidth: isViewing ? 3.5 : 2
      });
      // 方案名称文本 (字号 27，稍微左偏移以给右上角徽章留出安全空间)
      E.text(b.t.name, b.x + b.w / 2 - 14, b.y + b.h / 2 + f.dy + 1, {
        size: 27, bold: true, align: 'center', color: isViewing ? '#ffffff' : '#d2b68c'
      });
      // 若该方案是系统当前「已生效」的方案，显示醒目的绿色胶囊徽标 [已生效]
      if (isEffective) {
        c.save();
        const badgeW = 60, badgeH = 20, bx = b.x + b.w - badgeW - 5, by = b.y + f.dy + 4;
        c.fillStyle = '#2d7c18';
        E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(bx, by, badgeW, badgeH, 4); E.layout.canvas(c, 'scenes/options.js/original').fill();
        c.strokeStyle = '#a4f08e'; c.lineWidth = 1.5; E.layout.canvas(c, 'scenes/options.js/original').stroke();
        c.restore();
        E.text('已生效', bx + badgeW / 2, by + badgeH / 2 + 1, { size: 12, bold: true, align: 'center', color: '#ffffff' });
      }
    });

    // 2. 方案生效状态横幅（明确区分「当前生效」与「仅供查看预览」）
    const bannerY = 222 - sy, bannerH = 34;
    c.save();
    E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(PANEL_X, bannerY, PANEL_R - PANEL_X, bannerH, 6);
    if (isCurrentActive) {
      c.fillStyle = 'rgba(38, 88, 22, 0.88)';
      c.strokeStyle = '#85dc60';
    } else {
      c.fillStyle = 'rgba(82, 54, 20, 0.88)';
      c.strokeStyle = '#e6a33a';
    }
    c.lineWidth = 2; E.layout.canvas(c, 'scenes/options.js/original').fill(); E.layout.canvas(c, 'scenes/options.js/original').stroke();
    c.restore();

    if (isCurrentActive) {
      E.text('【✔ 当前生效方案】对局将使用本方案的配置执行决策', PANEL_X + (PANEL_R - PANEL_X) / 2, bannerY + bannerH / 2 + 1, {
        size: 20, bold: true, align: 'center', color: '#efffe6'
      });
    } else {
      E.text('【👁 正在查看（未生效）】如需启用本方案，请点击下方「使用此方案」', PANEL_X + (PANEL_R - PANEL_X) / 2, bannerY + bannerH / 2 + 1, {
        size: 20, bold: true, align: 'center', color: '#ffe9a8'
      });
    }

    // 3. 运行时就绪状态栏（如实标注 LLM/MCP 待接入状态）
    const statusY = 268 - sy;
    E.text(sc.status, PANEL_X, statusY, { size: 21, bold: true, color: sc.statusColor || '#4a2c0e' });

    // 4. 方案详细说明文字（自动折行，无溢出）
    const descY = 296 - sy;
    E.wrap(sc.desc, PANEL_R - PANEL_X, 21, false).forEach((ln, i) => {
      E.text(ln, PANEL_X, descY + i * 27, { size: 21, color: '#5a3d18' });
    });

    // 5. 字段配置与输入框区域
    const y0 = 360, step = 82;
    const btns = this.fieldBtns[this.subIdx] || [];

    if (btns.length === 0) {
      // 内置 AI：无需配置网络参数
      const noteY = 370 - sy;
      c.save();
      c.fillStyle = 'rgba(255,248,225,0.6)'; c.strokeStyle = '#bba172'; c.lineWidth = 2;
      E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(PANEL_X, noteY, PANEL_R - PANEL_X, 64, 8); E.layout.canvas(c, 'scenes/options.js/original').fill(); E.layout.canvas(c, 'scenes/options.js/original').stroke();
      c.restore();
      E.text('提示：游戏原生规则引擎直接在本地运行，无网络延迟与 API 调用成本。无需额外参数配置。', PANEL_X + 20, noteY + 33, {
        size: 21, color: '#4a2d10'
      });
    } else {
      btns.forEach((b, i) => {
        const rowLabelY = y0 + i * step + 8 - sy;
        b.x = PANEL_X; b.y = y0 + i * step + 26 - sy;
        E.text(b.f.label, PANEL_X, rowLabelY, { size: 21, bold: true, color: '#3d220a' });
        const editing = this.input && this.input.f === b.f;
        c.save();
        c.fillStyle = 'rgba(255,248,225,0.92)';
        c.strokeStyle = editing ? '#e6a33a' : (b.hover ? '#5a3d18' : '#947244');
        c.lineWidth = editing ? 3.5 : 2;
        E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(b.x, b.y, b.w, b.h, 6); E.layout.canvas(c, 'scenes/options.js/original').fill(); E.layout.canvas(c, 'scenes/options.js/original').stroke();
        c.restore();
        if (!editing) {
          let v = this.cfg[sc.key][b.f.key] || '';
          if (b.f.secret && v) {
            v = v.length > 8 ? v.slice(0, 4) + '•'.repeat(Math.min(16, v.length - 8)) + v.slice(-4) : '•'.repeat(v.length);
          }
          c.save(); E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').rect(b.x + 8, b.y, b.w - 16, b.h); E.layout.canvas(c, 'scenes/options.js/original').clip();
          E.text(v || `（点击输入 ${b.f.placeholder || ''}）`, b.x + 16, b.y + b.h / 2 + 1, {
            size: 22, color: v ? '#201406' : '#9a8460'
          });
          c.restore();
        }
      });
    }

    // 6. 「使用此方案」大按钮
    const ub = this.useBtn;
    ub.x = PANEL_X;
    ub.y = (btns.length ? y0 + btns.length * step + 16 : 460) - sy;
    const uf = E.fx(ub);
    c.save();
    E.layout.canvas(c, 'scenes/options.js/original').beginPath(); E.layout.canvas(c, 'scenes/options.js/original').roundRect(ub.x, ub.y + uf.dy, ub.w, ub.h, 8);
    if (isCurrentActive) {
      c.fillStyle = ub.hover ? '#3a8026' : '#2d6d1d';
      c.strokeStyle = '#8deb6e';
    } else {
      c.fillStyle = ub.hover ? '#8f6424' : '#734e1a';
      c.strokeStyle = '#ffd882';
    }
    c.lineWidth = 2.5; E.layout.canvas(c, 'scenes/options.js/original').fill(); E.layout.canvas(c, 'scenes/options.js/original').stroke();
    c.restore();

    if (isCurrentActive) {
      E.text('✔ 当前方案已生效 (运行中)', ub.x + ub.w / 2, ub.y + ub.h / 2 + uf.dy + 1, {
        size: 24, bold: true, align: 'center', color: '#efffe6'
      });
    } else {
      E.text('★ 使用此方案 (设为当前生效)', ub.x + ub.w / 2, ub.y + ub.h / 2 + uf.dy + 1, {
        size: 24, bold: true, align: 'center', color: '#fff5d0'
      });
    }
  }
  drawBridgeSettings() {
    const c = E.ctx, sy = this.contentScrollY;
    if (this.bridgeMgr) {
      this.bridgeMgr.draw(c, sy);
    }
  }
  render() {
    this.updateScrollLayout();
    this.drawSidebar();
    const c = E.ctx;
    c.save();
    E.layout.canvas(c, 'scenes/options.js/original').beginPath();
    E.layout.canvas(c, 'scenes/options.js/original').rect(570, 140, 1000, 650);
    E.layout.canvas(c, 'scenes/options.js/original').clip();
    if (this.tab === 'volume') this.drawVolume();
    else if (this.tab === 'game') this.drawGame();
    else if (this.tab === 'effects') this.drawEffects();
    else if (this.tab === 'logs') this.drawLogs();
    else if (this.tab === 'hotkeys') this.drawHotkeys();
    else this.drawTakeover();
    c.restore();
  }
}

export { Options };
