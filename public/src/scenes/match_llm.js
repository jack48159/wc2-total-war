// Per-match LLM takeover (对战桥) setup, opened from 对局配置. Writes the choice into the shared options object.
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { bridgePrompt, bridgeTransportUrl } from '../game/bridge_controller.js';

const COLS = 3, ROWS = 4, CELL_W = 350, ROW_H = 66, GRID_X = 300, GRID_Y = 405;
// 手机/应用内页面(不是电脑本机的 http 页面)：桥在电脑上，需要填电脑的局域网地址
export const isNativeApp = () => { try { return !(location.protocol.startsWith('http') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)); } catch { return false; } };
const isLoopback = u => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u || '');
export async function ensureBridge() {
  try { const r = await fetch('api/bridge/ensure', { method: 'POST' }); return r.ok; } catch { return false; }
}

export class LlmSetup extends Page {
  // bridge: { enabled, countries:Set, gameId, url, countryList:[{id,name}] } owned by MatchSetup
  constructor(source, bridge, ctx) {
    super();
    this.source = source; this.bridge = bridge; this.ctx = ctx; this.route = source.route;
    this.online = null; this.sessions = 0; this.note = ''; this.scroll = 0;
  }
  async init() {
    this.paper = await E.image('assets/board_paper@2x.webp');
    this.toggleBtn = new E.Button({ label: '接管开关', onClick: () => this.toggle() });
    this.checkBtn = new E.Button({ label: '检测桥', onClick: () => this.refresh() });
    this.startBtn = new E.Button({ label: '重试启动', onClick: () => this.refresh(true) });
    this.urlBtn = new E.Button({ label: '桥地址', onClick: () => this.editUrl() });
    this.allBtn = new E.Button({ label: '全选', onClick: () => this.bridge.countryList.forEach(c => this.bridge.countries.add(c.id)) });
    this.noneBtn = new E.Button({ label: '清空', onClick: () => this.bridge.countries.clear() });
    this.copyAllBtn = new E.Button({ label: '复制全部指令', onClick: () => this.copyAll() });
    this.doneBtn = new E.Button({ label: '完成', onClick: () => this.onBack() });
    this.upBtn = new E.Button({ label: '上翻', onClick: () => this.wheel(-1) });
    this.downBtn = new E.Button({ label: '下翻', onClick: () => this.wheel(1) });
    this.chipBtns = []; this.copyBtns = [];
    for (const c of this.bridge.countryList) {
      this.chipBtns.push(new E.Button({ label: c.name, onClick: () => { this.bridge.countries.has(c.id) ? this.bridge.countries.delete(c.id) : this.bridge.countries.add(c.id); } }));
      this.copyBtns.push(new E.Button({ label: '复制', onClick: () => this.copyOne(c) }));
    }
    this.widgets = [this.toggleBtn, this.checkBtn, this.startBtn, this.urlBtn, this.allBtn, this.noneBtn, this.copyAllBtn, this.doneBtn, this.upBtn, this.downBtn, ...this.chipBtns, ...this.copyBtns];
    this.timer = setInterval(() => this.refresh(), 3000);
    this.refresh();
    if (isNativeApp() && isLoopback(this.bridge.url)) setTimeout(() => this.editUrl(), 400);   // 手机上 127.0.0.1 连不到电脑，先让用户填电脑地址
  }
  toggle() {
    const b = this.bridge;
    b.enabled = !b.enabled;
    if (b.enabled) { if (!b.countries.size && b.countryList[0]) b.countries.add(b.countryList[0].id); this.refresh(true); }
  }
  dispose() { clearInterval(this.timer); }
  onBack() {
    if (this.bridge.enabled && !this.bridge.countries.size) { this.bridge.enabled = false; }
    E.go(this.source);
  }
  onOk() { this.onBack(); }
  renderBg() { this.source.renderBg(); }
  async refresh(force = false) {
    if (this.bridge.enabled && !isNativeApp() && (force || this.online === false || this.online == null) && !this.starting) {
      this.starting = true; this.online = null; await ensureBridge(); this.starting = false;
    }
    try {
      const res = await fetch(`${bridgeTransportUrl(this.bridge.url)}/bridge/status`);
      const data = res.ok ? await res.json() : null;
      this.online = !!data; this.sessions = data?.activeSessions || 0; this.lan = data?.lanAddresses || []; this.port = data?.port || 8651;
    } catch { this.online = false; }
  }
  // iPhone 等设备上桥地址要填电脑的局域网 IP(桥已监听 0.0.0.0)
  editUrl() {
    const v = window.prompt('对战桥地址(手机上请填电脑的局域网地址，如 http://192.168.1.10:8651)', this.bridge.url);
    if (v && /^https?:\/\//.test(v.trim())) {
      this.bridge.url = v.trim().replace(/\/+$/, ''); E.state.bridgeUrl = this.bridge.url; try { E.saveState(); } catch (e) {}
      this.online = null; this.refresh(true);
    }
  }
  say(msg) { this.note = msg; clearTimeout(this.noteTimer); this.noteTimer = setTimeout(() => { if (this.note === msg) this.note = ''; }, 2500); }
  async copy(text, ok = '已复制') {
    try {
      if (!navigator.clipboard?.writeText) throw 0;
      await navigator.clipboard.writeText(text); this.say(ok);
    } catch {
      const box = document.createElement('textarea'); box.value = text;
      Object.assign(box.style, { position: 'fixed', left: '10%', top: '20%', width: '80%', height: '40%', zIndex: 100 });
      document.body.appendChild(box); box.focus(); box.select();
      let done = false; try { done = document.execCommand('copy'); } catch {}
      if (done) { box.remove(); this.say(ok); } else { this.say('已弹出文本框，请手动复制'); box.onblur = () => box.remove(); }
    }
  }
  prompt(c) {
    return bridgePrompt({ gameId: this.bridge.gameId, country: c.id, countryName: c.name, stage: this.ctx.title || this.ctx.stage, player: this.ctx.playerName, url: this.bridge.url });
  }
  copyOne(c) { this.copy(this.prompt(c), `已复制【${c.name}】的接管指令`); }
  copyAll() {
    const list = this.bridge.countryList.filter(c => this.bridge.countries.has(c.id));
    if (!list.length) { this.say('请先勾选要接管的国家'); return; }
    this.copy(list.map(c => this.prompt(c)).join('\n\n----------------------------------------\n\n'), `已复制 ${list.length} 个国家的指令，每国粘贴到独立会话`);
  }
  wheel(dy) {
    const rows = Math.ceil(this.bridge.countryList.length / COLS);
    this.scroll = E.clamp(this.scroll + Math.sign(dy), 0, Math.max(0, rows - ROWS));
  }
  fit(label, w, size) {
    const ctx = E.ctx; ctx.save(); let s = size;
    for (; s > 16; s -= 2) { ctx.font = `${s}px ${E.CJK_SERIF}`; if (ctx.measureText(label).width <= w - 24) break; }
    ctx.restore(); return s;
  }
  drawBtn(btn, x, y, w, h, label, tone = 'blue', size = 28) {
    Object.assign(btn, { x, y, w, h });
    E.layout.group(btn, 'scenes/match_llm/btn', () => {
      const f = E.fx(btn, false), frame = this.ui1[tone + '_normal'];
      E.drawFrameCentered(frame, x + w / 2, y + h / 2 + f.dy, { sx: w / frame.w, sy: h / frame.h, filter: f.filter });
      E.label(label, x + w / 2, y + h / 2 + f.dy, this.fit(label, w, size), { align: 'center', font: E.CJK_SERIF });
    });
  }
  render() {
    const b = this.bridge, on = b.enabled;
    E.layout.canvas(E.ctx, 'scenes/match_llm/paper').drawImage(this.paper, 200, 55, 1200, 750);
    E.text('LLM 对手接管', 800, 128, { size: 50, bold: true, align: 'center', color: '#2a1608', font: E.CJK_SERIF });
    E.drawInkRule(300, 160, 1300);
    E.text('接管开关', 330, 218, { size: 34, bold: true, color: '#2a1608' });
    this.drawBtn(this.toggleBtn, 560, 184, 200, 60, on ? '已开启' : '已关闭', on ? 'green' : 'blue', 30);
    E.text(on ? '点击关闭。所选国家由外部 LLM 接管。' : '可接管任意席位，包括玩家；全选可进行 Agent 对战。', 785, 216, { size: 24, color: '#5a3d18' });
    // bridge status
    const st = this.online == null ? '启动中…' : this.online ? `已自动启动${this.sessions ? ` · ${this.sessions} 个会话在线` : ''}` : '未启动';
    E.text('对战桥', 330, 292, { size: 34, bold: true, color: '#2a1608' });
    E.text('● ' + st, 470, 291, { size: 28, bold: true, color: this.online ? '#2a6a1c' : this.online === false ? '#a32016' : '#796244' });
    this.drawBtn(this.checkBtn, 860, 258, 150, 56, '检测桥', 'blue', 26);
    this.drawBtn(this.startBtn, 1020, 258, 150, 56, '重试', 'blue', 26);
    this.drawBtn(this.urlBtn, 1180, 258, 120, 56, '桥地址', 'blue', 24);
    if (this.online === false) E.text(on ? (isNativeApp() ? '连不上电脑上的桥：确认电脑端游戏服务在运行、手机和电脑在同一网络，并点“桥地址”填电脑地址' : '桥启动失败，请点“重试”（或检查端口 8651 是否被占用）') : (isNativeApp() ? '开启后请点“桥地址”填电脑的局域网地址。' : '开启接管后会自动启动对战桥，无需手动运行命令。'), 330, 340, { size: 24, color: on ? '#a32016' : '#5a3d18' });
    else E.text(`对局 ID：${b.gameId}${this.lan?.length ? `　手机桥地址：http://${this.lan.find(a => !a.endsWith(".1")) || this.lan[0]}:${this.port}` : ''}`, 330, 340, { size: 23, color: '#5a3d18' });
    E.drawInkRule(300, 366, 1300);
    E.text('接管国家', 330, 397, { size: 30, bold: true, color: '#2a1608' });
    this.drawBtn(this.allBtn, 1010, 366, 110, 44, '全选', 'blue', 24);
    this.drawBtn(this.noneBtn, 1130, 366, 110, 44, '清空', 'blue', 24);
    // country grid (scrollable)
    const list = b.countryList, first = this.scroll * COLS;
    this.chipBtns.forEach(x => { x.visible = false; }); this.copyBtns.forEach(x => { x.visible = false; });
    for (let i = first; i < Math.min(list.length, first + COLS * ROWS); i++) {
      const c = list[i], k = i - first, x = GRID_X + (k % COLS) * CELL_W, y = GRID_Y + 24 + Math.floor(k / COLS) * ROW_H;
      const picked = b.countries.has(c.id);
      this.chipBtns[i].visible = this.copyBtns[i].visible = true;
      this.drawBtn(this.chipBtns[i], x, y, 230, 54, (picked ? '✓ ' : '') + c.name, picked && on ? 'green' : 'blue', 26);
      this.drawBtn(this.copyBtns[i], x + 238, y, 90, 54, '复制', 'blue', 24);
    }
    if (!list.length) E.text('此关卡没有可接管的 AI 国家', 330, 470, { size: 26, color: '#796244' });
    const rows = Math.ceil(list.length / COLS);
    const paged = rows > ROWS;
    this.upBtn.visible = this.downBtn.visible = paged;
    if (paged) {
      this.drawBtn(this.upBtn, 520, 366, 100, 44, '▲', 'blue', 22);
      this.drawBtn(this.downBtn, 630, 366, 100, 44, '▼', 'blue', 22);
      E.text(`${this.scroll + 1}/${rows - ROWS + 1}`, 750, 397, { size: 24, color: '#796244' });
    }
    E.drawInkRule(300, 700, 1300);
    this.drawBtn(this.copyAllBtn, 330, 716, 300, 64, '复制全部指令', 'blue', 28);
    this.drawBtn(this.doneBtn, 1100, 716, 190, 64, '完成', 'green', 30);
    if (this.note) E.text(this.note, 660, 758, { size: 26, bold: true, color: '#2a6a1c' });
  }
}
