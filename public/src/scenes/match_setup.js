// Per-match rules. Keep the source page instance to preserve selection and scroll.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { Slider, drawSliderTrack } from '../ui/slider.js';
import { newBridgeGameId, bridgeUrlFor } from '../game/bridge_controller.js';
import { playerCountryName } from '../game/describe.js';
import { LlmSetup, ensureBridge } from './match_llm.js';
const RECRUIT_MAX = 8;
const RATE_MIN = 0.5, RATE_MAX = 3.0, RATE_STEP = 0.1;
const LIST = { x: 300, y: 246, w: 1000, h: 492, rowH: 82, rows: 6 };

export class MatchSetup extends Page {
  constructor(source, stage, options = {}, title = '') {
    super();
    this.source = source; this.stage = stage; this.options = options; this.title = title;
    // Reload returns to the picker rather than starting an unconfigured match.
    this.route = source.route;
    this.fogOfWar = !!options.sandboxConfig?.features?.fogOfWar; this.reparationRate = 1.8; this.turnOrder = 'first'; this.recruitWait = 0; this.supplyByInfrastructure = true; this.row = 0;
    this.llm = { enabled: false, countries: new Set(), gameId: newBridgeGameId(), url: bridgeUrlFor(E.state.bridgeUrl), countryList: [] };
    this.scroll = 0; this.gesture = null;
    this.isConquest = stage.startsWith('conquest_') || !!options.sandbox; this.freeDiplomacy = !!options.freeDiplomacy || !!options.sandbox;
  }
  async init() {
    this.paper = await E.image('assets/board_paper@2x.webp');
    this.fogBtns = [new E.Button({ label: '战争迷雾', onClick: () => { this.row = 0; this.fogOfWar = !this.fogOfWar; } })];
    this.rateSlider = new Slider({
      tx: 670, ty: 440, tw: 430, step: RATE_STEP / (RATE_MAX - RATE_MIN),
      label: '停战赔款倍率'
    });
    this.rateSlider.get = () => (this.reparationRate - RATE_MIN) / (RATE_MAX - RATE_MIN);
    this.rateSlider.set = v => {
      this.row = 1;
      this.reparationRate = Math.round((RATE_MIN + E.clamp(v, 0, 1) * (RATE_MAX - RATE_MIN)) * 10) / 10;
    };
    this.turnBtns = [new E.Button({ label: '行动顺序', onClick: () => { this.row = 2; this.turnOrder = this.turnOrder === 'first' ? 'second' : 'first'; } })];
    this.recruitSlider = new Slider({ tx: 670, ty: 666, tw: 430, step: 1 / RECRUIT_MAX, label: '征兵规则' });
    this.recruitSlider.get = () => this.recruitWait / RECRUIT_MAX;
    this.recruitSlider.set = v => { this.row = 3; this.recruitWait = Math.round(E.clamp(v, 0, 1) * RECRUIT_MAX); };
    for (const slider of [this.rateSlider, this.recruitSlider]) {
      slider.h = 64;
      Object.defineProperty(slider, 'y', { get() { return this.ty - this.h / 2; }, set() {} });
    }
    this.supplyBtns = [new E.Button({ label: '地区产出补给', onClick: () => { this.row = 4; this.supplyByInfrastructure = !this.supplyByInfrastructure; } })];
    this.llmBtns = [new E.Button({ label: 'LLM 接管', onClick: () => this.llm.enabled ? this.openLlm() : this.setLlm(true) })];
    this.start = new E.Button({ label: '开始作战', onClick: () => this.onOk() });
    this.diplomacyBtn = new E.Button({ label: '外交背景', onClick: () => { this.row = 6; if (!this.options.sandbox) this.freeDiplomacy = !this.freeDiplomacy; } });
    this.widgets = [...this.fogBtns, this.rateSlider, ...this.turnBtns, this.recruitSlider, ...this.supplyBtns, ...this.llmBtns, this.start];
    if (this.isConquest) this.widgets.push(this.diplomacyBtn);
    this.loadLlmCountries();
  }
  async loadLlmCountries() {
    try {
      const data = await E.json('data/stages/' + this.stage + '.json');
      const player = this.options.player || data.player || data.countries?.find(c => c.ai === false)?.id || data.countries?.[0]?.id; // 与 Stage 选玩家的规则一致
      this.llm.player = player; this.llm.playerName = playerCountryName(player);
      this.llm.countryList = (this.options.sandboxConfig?.countries || data.countries || []).filter(c => c.id && (!this.options.sandbox || this.options.participatingCountries.includes(c.id))).map(c => ({ id: c.id, name: playerCountryName(c.id) }));
    } catch { this.llm.countryList = []; }
  }
  setLlm(on) {
    this.llm.enabled = on;
    if (on) { if (!this.llm.countries.size && this.llm.countryList[0]) this.llm.countries.add(this.llm.countryList[0].id); ensureBridge(); this.openLlm(); }
  }
  openLlm() { E.go(new LlmSetup(this, this.llm, { stage: this.stage, title: this.title, playerName: this.llm.playerName || '' })); }
  onBack() { E.go(this.source); }
  async onOk() {
    const l = this.llm, on = l.enabled && l.countries.size > 0;
    if (on) await ensureBridge();
    E.go('battle', this.stage, null, { ...this.options, fogOfWar: this.fogOfWar, reparationRate: this.reparationRate, turnOrder: this.turnOrder, recruitWait: this.recruitWait, supplyByInfrastructure: this.supplyByInfrastructure,
      ...(this.isConquest ? { freeDiplomacy: this.freeDiplomacy, historicalDiplomacy: !this.freeDiplomacy } : {}),
      ...(on ? { bridge: { enabled: true, countries: [...l.countries], gameId: l.gameId, url: l.url } } : {}) });
  }
  key(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.onOk(); return; }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault(); E.keyboard = true;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        this.row = (this.row + (e.key === 'ArrowDown' ? 1 : this.rowCount - 1)) % this.rowCount;
        this.revealRow(this.row);
      }
      else {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (this.row === 0) this.fogOfWar = !this.fogOfWar;
        else if (this.row === 1) this.rateSlider.adjust(dir);
        else if (this.row === 3) this.recruitSlider.adjust(dir);
        else if (this.row === 4) this.supplyByInfrastructure = !this.supplyByInfrastructure;
        else if (this.row === 5) this.setLlm(!this.llm.enabled);
        else if (this.row === 6) { if (!this.options.sandbox) this.freeDiplomacy = !this.freeDiplomacy; }
        else this.turnOrder = this.turnOrder === 'first' ? 'second' : 'first';
      }
      E.focus = this.rowControl(this.row);
      return;
    }
    super.key(e);
    if (this.fogBtns.includes(E.focus)) this.row = 0;
    if (E.focus === this.rateSlider) this.row = 1;
    if (this.turnBtns.includes(E.focus)) this.row = 2;
    if (E.focus === this.recruitSlider) this.row = 3;
    if (this.supplyBtns.includes(E.focus)) this.row = 4;
    if (this.llmBtns.includes(E.focus)) this.row = 5;
    if (E.focus === this.diplomacyBtn) this.row = 6;
  }
  rowControl(row) { return [this.fogBtns[0], this.rateSlider, this.turnBtns[0], this.recruitSlider, this.supplyBtns[0], this.llmBtns[0], this.diplomacyBtn][row]; }
  get rowCount() { return this.isConquest ? 7 : 6; }
  get maxScroll() { return Math.max(0, this.rowCount * LIST.rowH - LIST.h); }
  revealRow(row) {
    const top = row * LIST.rowH, bottom = top + LIST.rowH;
    if (top < this.scroll) this.scroll = top;
    else if (bottom > this.scroll + LIST.h) this.scroll = bottom - LIST.h;
    this.scroll = E.clamp(this.scroll, 0, this.maxScroll);
  }
  wheel(dy) { this.scroll = E.clamp(this.scroll + Math.sign(dy) * 84, 0, this.maxScroll); }
  pointerDown(p) {
    const c = this.cp(p);
    if (!this.dialog && c.x >= LIST.x && c.x <= LIST.x + LIST.w && c.y >= LIST.y && c.y <= LIST.y + LIST.h) {
      this.gesture = { x: c.x, y: c.y, scroll: this.scroll, dragging: false, rate: this.rateSlider.get(), recruit: this.recruitSlider.get() };
    }
    super.pointerDown(p);
  }
  onMove(p) {
    const g = this.gesture;
    if (g && !g.dragging && (this.rateSlider.drag || this.recruitSlider.drag) && Math.abs(p.y - g.y) > 10 && Math.abs(p.y - g.y) > Math.abs(p.x - g.x)) {
      if (this.rateSlider.drag) { this.rateSlider.up(); this.rateSlider.set(g.rate); }
      if (this.recruitSlider.drag) { this.recruitSlider.up(); this.recruitSlider.set(g.recruit); }
      g.dragging = true;
    }
    if (this.rateSlider.drag) { this.rateSlider.set(this.rateSlider.valueAt(p)); return; }
    if (this.recruitSlider.drag) { this.recruitSlider.set(this.recruitSlider.valueAt(p)); return; }
    if (g && (g.dragging || Math.abs(p.y - g.y) > 10)) {
      g.dragging = true;
      this.widgets.forEach(b => b.disarm());
      this.scroll = E.clamp(g.scroll + g.y - p.y, 0, this.maxScroll);
    }
  }
  pointerUp(p) {
    if (this.gesture?.dragging) { this.pointerCancel(); return; }
    super.pointerUp(p); this.gesture = null;
  }
  pointerCancel() {
    this.gesture = null;
    this.rateSlider.up(); this.recruitSlider.up();
    this.focusables().forEach(b => b.disarm());
  }
  renderBg() { this.source.renderBg(); }
  drawChoice(btn, selected, label, x, y, w = 112, h = 68) {
    Object.assign(btn, { x, y, w, h });
    E.layout.group(btn, 'scenes/match_setup/choice', () => {
      const f = E.fx(btn, false), frame = selected ? this.ui1.green_normal : this.ui1.blue_normal;
      E.drawFrameCentered(frame, x + w / 2, y + h / 2 + f.dy, { sx: w / frame.w, sy: h / frame.h, filter: f.filter });
      E.label(label, x + w / 2, y + h / 2 + f.dy, h <= 48 ? 25 : 30, { align: 'center', font: E.CJK_SERIF });
    });
  }
  render() {
    const c = E.ctx;
    E.layout.canvas(c, 'scenes/match_setup/paper').drawImage(this.paper, 200, 40, 1200, 820);
    E.text('对局配置', 800, 132, { size: 48, bold: true, align: 'center', color: '#2a1608', font: E.CJK_SERIF });
    const title = E.wrap(this.title, 1000, 26).slice(0, 2);
    title.forEach((line, i) => E.text(line, 800, 180 + i * 30, { size: 26, align: 'center', color: '#5a3d18' }));
    E.drawInkRule(300, 230, 1300);
    this.scroll = E.clamp(this.scroll, 0, this.maxScroll);
    const descriptions = [
      '开启后，只能看到己方掌握的战场情报。',
      '按对方在本次战争中损失部队的造价计算赔款。',
      this.turnOrder === 'first' ? '由你先行动，对手随后行动。' : '对手先行动，随后轮到你。',
      this.recruitWait ? `新占领地区需等待 ${this.recruitWait} 回合才能征兵。` : '新占领地区可以立即征兵。',
      this.supplyByInfrastructure ? '金币×2＋工业×5，整格共享，最多250点恢复。' : '任意己方地块补给，整格共享200点恢复。',
      this.llm.enabled ? `已选 ${this.llm.countries.size} 国，点击配置席位与桥地址。` : '选择由外部助手接管的国家。'
    ];
    const labels = ['战争迷雾', '停战赔款倍率', '行动顺序', '征兵等待', '地区产出补给', 'Agent 席位接管'];
    const values = [this.fogOfWar ? '已开启' : '已关闭', '', this.turnOrder === 'first' ? '先手' : '后手', '', this.supplyByInfrastructure ? '已开启' : '已关闭', this.llm.enabled ? '配置接管' : '开启接管'];
    descriptions.push(this.freeDiplomacy ? '无预设战争、同盟或条约，后续自由外交。' : '使用关卡原有的外交关系和历史事件。');
    labels.push('外交背景'); values.push(this.freeDiplomacy ? '自由外交' : '历史背景');
    c.save();
    const clip = E.layout.canvas(c, 'scenes/match_setup/list');
    clip.beginPath(); clip.rect(LIST.x, LIST.y, LIST.w, LIST.h); clip.clip();
    for (let i = 0; i < this.rowCount; i++) {
      const y = LIST.y + i * LIST.rowH - this.scroll, btn = this.rowControl(i);
      const controlY = y + 14;
      btn.visible = y + 6 >= LIST.y && y + 70 <= LIST.y + LIST.h;
      if (y + LIST.rowH <= LIST.y || y >= LIST.y + LIST.h) continue;
      if (E.keyboard && this.row === i) E.panel(310, y + 4, 960, LIST.rowH - 12, { fill: 'rgba(255,244,214,0.3)', stroke: null, r: 10 });
      E.text(labels[i], 330, y + 31, { size: 26, bold: true, color: '#2a1608' });
      E.text(descriptions[i], 330, y + 62, { size: 20, color: '#796244' });
      if (i === 1 || i === 3) {
        btn.tx = 970; btn.ty = y + 38; btn.tw = 190; btn.w = 250; btn.h = 64;
        if (btn.visible) E.layout.group(btn, 'scenes/match_setup/slider', () => drawSliderTrack(btn, btn.get(), 'scenes/match_setup/slider-track'));
        E.text(i === 1 ? `${this.reparationRate.toFixed(1)} 倍` : this.recruitWait ? `${this.recruitWait} 回合` : '立即', 1245, y + 45, { size: 22, bold: true, align: 'center', color: '#5a3d18' });
      } else if (btn.visible) {
        const on = i === 0 ? this.fogOfWar : i === 2 ? this.turnOrder === 'first' : i === 4 ? this.supplyByInfrastructure : i === 6 ? this.freeDiplomacy : this.llm.enabled;
        this.drawChoice(btn, on, values[i], 1060, controlY, 180, 48);
      }
      E.drawInkRule(330, y + LIST.rowH - 2, 1250, 'rgba(60,44,20,0.2)');
    }
    c.restore();
    if (this.maxScroll > 0) {
      const trackH = LIST.h - 16, thumbH = Math.max(52, trackH * LIST.h / (this.rowCount * LIST.rowH));
      E.panel(1280, LIST.y + 8, 6, trackH, { fill: 'rgba(60,44,20,0.15)', stroke: null, r: 3 });
      E.panel(1277, LIST.y + 8 + (trackH - thumbH) * this.scroll / this.maxScroll, 12, thumbH, { fill: '#8a6b3f', stroke: null, r: 6 });
    }
    E.drawInkRule(300, 744, 1300);
    E.text(this.maxScroll > 0 ? '滑动或滚轮查看更多设置' : '全部6项配置', 330, 802, { size: 23, color: '#796244' });
    this.drawChoice(this.start, true, '开始作战', 1050, 770, 270, 70);
  }
}
