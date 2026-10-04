import { E } from '../core/index.js';
import { bridgePrompt, bridgeUrlFor } from '../game/bridge_controller.js';
import { playerCountryName } from '../game/describe.js';

const PANEL_X = 640;
const PANEL_R = 1500;
const SERIF = '"Songti SC","Noto Serif CJK SC","SimSun","Source Han Serif SC",serif';

function flagOf(countryId, stage) {
  const info = stage?.countries?.get(countryId);
  if (info?.flag) return info.flag;
  return String(countryId || '').replace(/\d+$/, '') || null;
}

export class OptionsBridgeManager {
  constructor(opt) {
    this.opt = opt;
    this.statusTimer = null;
    this.bridgeOnline = false;
    this.activeSessions = 0;
    this.lastCheckTime = '--:--:--';
    this.seatsMap = new Map();
    this.note = '';
    this.noteTimer = null;
    this.advancedExpanded = false;

    // 常用按钮
    this.toggleEnabledBtn = new E.Button({ w: PANEL_R - PANEL_X, h: 56, label: '', onClick: () => this.toggleEnabled() });
    this.checkStatusBtn = new E.Button({ w: 140, h: 48, label: '检测桥', onClick: () => this.refreshStatus(true) });
    this.copyStartCmdBtn = new E.Button({ w: 220, h: 48, label: '复制启动命令', onClick: () => this.copyStartCmd() });
    this.selectAllBtn = new E.Button({ w: 160, h: 46, label: '全选全部席位', onClick: () => this.selectAllAi() });
    this.clearAllBtn = new E.Button({ w: 100, h: 46, label: '清空', onClick: () => this.clearAll() });
    this.copyAllPromptsBtn = new E.Button({ w: 200, h: 46, label: '复制全部指令', onClick: () => this.copyAllPrompts() });
    this.copyIdBtn = new E.Button({ w: 160, h: 48, label: '仅复制ID', onClick: () => this.copyGameId() });

    // 高级设置折叠按钮与配置按钮
    this.advToggleBtn = new E.Button({ w: PANEL_R - PANEL_X, h: 48, label: '高级设置', onClick: () => this.toggleAdvanced() });
    this.bridgeUrlBtn = new E.Button({ w: PANEL_R - PANEL_X, h: 50, label: '', onClick: () => this.editField('bridgeUrl') });
    this.timeoutMinutesBtn = new E.Button({ w: 380, h: 50, label: '', onClick: () => this.editField('bridgeTimeoutMinutes') });
    this.timeoutActionBtn = new E.Button({ w: 380, h: 50, label: '', onClick: () => this.toggleTimeoutAction() });

    // 动态行按钮缓存
    this.countryRowBtns = [];
  }

  init() {
    this.statusTimer = setInterval(() => this.refreshStatus(false), 2000);
    this.refreshStatus(true);
  }

  dispose() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.noteTimer) clearTimeout(this.noteTimer);
  }

  showNote(msg) {
    this.note = msg;
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      if (this.note === msg) this.note = '';
    }, 2000);
  }

  async copyText(text, successMsg = '已复制') {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      this.showNote(successMsg);
    } catch {
      const box = document.createElement('textarea');
      box.value = text;
      Object.assign(box.style, { position: 'fixed', left: '10%', top: '20%', width: '80%', height: '40%', zIndex: 100 });
      document.body.appendChild(box);
      box.focus();
      box.select();
      if (document.execCommand('copy')) {
        box.remove();
        this.showNote(successMsg);
      } else {
        this.showNote('请手动复制');
        box.addEventListener('blur', () => box.remove(), { once: true });
      }
    }
  }

  toggleEnabled() {
    if (this.opt.returnTo?.options?.multiplayerRoom) {
      this.showNote('联机房间不能启用对战桥');
      return;
    }
    this.opt.bridgeEnabled = !this.opt.bridgeEnabled;
  }

  toggleAdvanced() {
    this.advancedExpanded = !this.advancedExpanded;
  }

  toggleTimeoutAction() {
    this.opt.bridgeTimeoutAction = this.opt.bridgeTimeoutAction === 'fallback' ? 'wait' : 'fallback';
  }

  selectAllAi() {
    const candidates = this.opt.bridgeCountries();
    if (!candidates.length) return;
    for (const c of candidates) this.opt.bridgeCountriesSelected.add(c);
    this.showNote('已全选所有席位，包括玩家');
  }

  clearAll() {
    this.opt.bridgeCountriesSelected.clear();
    this.showNote('已清空接管国家');
  }

  copyStartCmd() {
    this.copyText('node tools/mcp/bridge_server.mjs', '已复制启动命令');
  }

  copyGameId() {
    const g = this.opt.returnTo?.game;
    if (!g?.gameId) {
      this.showNote('开始对局后生成对局ID');
      return;
    }
    this.copyText(g.gameId, '已复制对局ID');
  }

  async copySinglePrompt(country) {
    const g = this.opt.returnTo?.game;
    if (!g) {
      this.showNote('请先进入对局');
      return;
    }
    const name = playerCountryName(country, g.stage);
    const text = bridgePrompt({
      gameId: g.gameId,
      country,
      countryName: name,
      stage: g.name,
      player: g.player,
      url: this.opt.bridgeUrl
    });
    await this.copyText(text, `已复制【${name}】指令`);
  }

  async copyAllPrompts() {
    const g = this.opt.returnTo?.game;
    if (!g) {
      this.showNote('请先进入对局');
      return;
    }
    const list = Array.from(this.opt.bridgeCountriesSelected);
    if (!list.length) {
      this.showNote('请先勾选要接管的国家');
      return;
    }
    const parts = list.map(c => {
      const name = playerCountryName(c, g.stage);
      return bridgePrompt({
        gameId: g.gameId,
        country: c,
        countryName: name,
        stage: g.name,
        player: g.player,
        url: this.opt.bridgeUrl
      });
    });
    const combined = parts.join('\n\n----------------------------------------\n\n');
    await this.copyText(combined, `已复制 ${parts.length} 个国家的接管指令`);
  }

  editField(key) {
    this.opt.commit?.();
    const isTimeout = key === 'bridgeTimeoutMinutes';
    const targetBtn = isTimeout ? this.timeoutMinutesBtn : this.bridgeUrlBtn;
    const rect = E.logicalRect();
    const scale = E.view.scale / E.view.dpr;
    const el = document.createElement('input');
    el.type = isTimeout ? 'number' : 'text';
    el.value = this.opt[key];
    Object.assign(el.style, {
      position: 'fixed',
      left: rect.left + (targetBtn.x + E.ox) * scale + 'px',
      top: rect.top + (targetBtn.y + E.oy) * scale + 'px',
      width: targetBtn.w * scale + 'px',
      height: targetBtn.h * scale + 'px',
      boxSizing: 'border-box',
      background: '#fff8e1',
      border: '3px solid #e6a33a',
      fontSize: '18px',
      zIndex: 20
    });
    document.body.appendChild(el);
    el.focus();
    el.select();
    const done = () => {
      if (el.value.trim()) this.opt[key] = el.value.trim();
      el.remove();
    };
    el.addEventListener('blur', done, { once: true });
    el.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') el.blur();
    });
  }

  async refreshStatus(manual = false) {
    const url = bridgeUrlFor(this.opt.bridgeUrl).replace(/\/$/, '');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    try {
      const res = await fetch(`${url}/bridge/status`);
      if (res.ok) {
        const data = await res.json();
        this.bridgeOnline = true;
        this.activeSessions = data.activeSessions || 0;
        this.lastCheckTime = timeStr;
      } else {
        this.bridgeOnline = false;
        this.lastCheckTime = timeStr;
      }
    } catch {
      this.bridgeOnline = false;
      this.lastCheckTime = timeStr;
    }

    // 查询当前对局各席位状态
    const g = this.opt.returnTo?.game;
    if (this.bridgeOnline && g?.gameId) {
      try {
        const gRes = await fetch(`${url}/bridge/game?gameId=${encodeURIComponent(g.gameId)}`);
        if (gRes.ok) {
          const gData = await gRes.json();
          this.seatsMap.clear();
          for (const s of (gData.game?.seats || [])) {
            this.seatsMap.set(s.country, s);
          }
        }
      } catch {}
    }
    if (manual) this.showNote(this.bridgeOnline ? '检测成功：桥已连接' : '检测完成：桥未启动');
  }

  // 收集可点击 widgets 并更新布局
  collectWidgets(sy) {
    const widgets = [];
    const enabled = this.opt.bridgeEnabled;
    let cy = 230;

    // 总开关按钮
    this.toggleEnabledBtn.x = PANEL_X;
    this.toggleEnabledBtn.y = cy - sy;
    this.toggleEnabledBtn.w = PANEL_R - PANEL_X;
    this.toggleEnabledBtn.h = 56;
    this.toggleEnabledBtn.enabled = this.toggleEnabledBtn.y + this.toggleEnabledBtn.h >= 140 && this.toggleEnabledBtn.y <= 790;
    widgets.push(this.toggleEnabledBtn);
    cy += 70;

    // 分区 A 状态栏按钮
    this.checkStatusBtn.x = PANEL_X + 460;
    this.checkStatusBtn.y = cy + 4 - sy;
    this.checkStatusBtn.enabled = this.checkStatusBtn.y + this.checkStatusBtn.h >= 140 && this.checkStatusBtn.y <= 790;
    widgets.push(this.checkStatusBtn);

    this.copyStartCmdBtn.x = PANEL_X + 615;
    this.copyStartCmdBtn.y = cy + 4 - sy;
    this.copyStartCmdBtn.enabled = this.copyStartCmdBtn.y + this.copyStartCmdBtn.h >= 140 && this.copyStartCmdBtn.y <= 790;
    widgets.push(this.copyStartCmdBtn);

    cy += this.bridgeOnline ? 68 : 110;

    // 分区 B 国家列表
    cy += 30; // 标题
    this.selectAllBtn.x = PANEL_X + 330;
    this.selectAllBtn.y = cy - 6 - sy;
    this.selectAllBtn.enabled = enabled && (this.selectAllBtn.y + this.selectAllBtn.h >= 140 && this.selectAllBtn.y <= 790);
    widgets.push(this.selectAllBtn);

    this.clearAllBtn.x = PANEL_X + 505;
    this.clearAllBtn.y = cy - 6 - sy;
    this.clearAllBtn.enabled = enabled && (this.clearAllBtn.y + this.clearAllBtn.h >= 140 && this.clearAllBtn.y <= 790);
    widgets.push(this.clearAllBtn);

    this.copyAllPromptsBtn.x = PANEL_X + 620;
    this.copyAllPromptsBtn.y = cy - 6 - sy;
    this.copyAllPromptsBtn.enabled = enabled && (this.copyAllPromptsBtn.y + this.copyAllPromptsBtn.h >= 140 && this.copyAllPromptsBtn.y <= 790);
    widgets.push(this.copyAllPromptsBtn);

    cy += 48;

    // 国家行按钮更新
    const candidates = this.opt.bridgeCountries();
    if (this.countryRowBtns.length !== candidates.length) {
      this.countryRowBtns = candidates.map(country => ({
        country,
        chkBtn: new E.Button({
          w: 48, h: 48, label: '',
          onClick: () => {
            if (this.opt.bridgeCountriesSelected.has(country)) {
              this.opt.bridgeCountriesSelected.delete(country);
            } else {
              this.opt.bridgeCountriesSelected.add(country);
            }
          }
        }),
        copyBtn: new E.Button({
          w: 130, h: 46, label: '复制指令',
          onClick: () => this.copySinglePrompt(country)
        })
      }));
    }

    for (let i = 0; i < this.countryRowBtns.length; i++) {
      const row = this.countryRowBtns[i];
      const rowY = cy + i * 58;
      row.chkBtn.x = PANEL_X + 10;
      row.chkBtn.y = rowY + 5 - sy;
      row.chkBtn.enabled = enabled && (row.chkBtn.y + row.chkBtn.h >= 140 && row.chkBtn.y <= 790);
      widgets.push(row.chkBtn);

      row.copyBtn.x = PANEL_R - 150;
      row.copyBtn.y = rowY + 6 - sy;
      row.copyBtn.enabled = enabled && (row.copyBtn.y + row.copyBtn.h >= 140 && row.copyBtn.y <= 790);
      widgets.push(row.copyBtn);
    }
    cy += Math.max(1, candidates.length) * 58 + 20;

    // 分区 C 对局 ID
    this.copyIdBtn.x = PANEL_R - 180;
    this.copyIdBtn.y = cy - 6 - sy;
    this.copyIdBtn.enabled = enabled && (this.copyIdBtn.y + this.copyIdBtn.h >= 140 && this.copyIdBtn.y <= 790);
    widgets.push(this.copyIdBtn);
    cy += 60;

    // 分区 D 高级设置
    this.advToggleBtn.x = PANEL_X;
    this.advToggleBtn.y = cy - sy;
    this.advToggleBtn.w = PANEL_R - PANEL_X;
    this.advToggleBtn.enabled = enabled && (this.advToggleBtn.y + this.advToggleBtn.h >= 140 && this.advToggleBtn.y <= 790);
    widgets.push(this.advToggleBtn);
    cy += 58;

    if (this.advancedExpanded) {
      this.bridgeUrlBtn.x = PANEL_X;
      this.bridgeUrlBtn.y = cy - sy;
      this.bridgeUrlBtn.enabled = enabled && (this.bridgeUrlBtn.y + this.bridgeUrlBtn.h >= 140 && this.bridgeUrlBtn.y <= 790);
      widgets.push(this.bridgeUrlBtn);
      cy += 58;

      this.timeoutMinutesBtn.x = PANEL_X;
      this.timeoutMinutesBtn.y = cy - sy;
      this.timeoutMinutesBtn.enabled = enabled && (this.timeoutMinutesBtn.y + this.timeoutMinutesBtn.h >= 140 && this.timeoutMinutesBtn.y <= 790);
      widgets.push(this.timeoutMinutesBtn);

      this.timeoutActionBtn.x = PANEL_X + 410;
      this.timeoutActionBtn.y = cy - sy;
      this.timeoutActionBtn.enabled = enabled && (this.timeoutActionBtn.y + this.timeoutActionBtn.h >= 140 && this.timeoutActionBtn.y <= 790);
      widgets.push(this.timeoutActionBtn);
      cy += 65;
    }

    // 分区 E 说明文本高
    cy += 170;
    return { widgets, totalHeight: cy + 40 };
  }

  draw(c, sy) {
    const enabled = this.opt.bridgeEnabled;
    const g = this.opt.returnTo?.game;
    let cy = 230;

    // 0. 总开关
    const tb = this.toggleEnabledBtn;
    const tf = E.fx(tb);
    E.panel(tb.x, tb.y + tf.dy, tb.w, tb.h, {
      fill: enabled ? (tb.hover ? '#3a7d25' : '#2d681c') : (tb.hover ? '#60421e' : '#452f16'),
      stroke: enabled ? '#8dec6e' : '#b28d54',
      lineWidth: 2.5
    });
    E.text(`对手由外部 LLM 接管（对战桥）：${enabled ? '✔ 开启' : '✖ 关闭'}`, tb.x + 20, tb.y + tb.h / 2 + tf.dy + 1, {
      size: 24, bold: true, color: '#ffffff'
    });
    if (this.note) {
      E.text(`【${this.note}】`, tb.x + tb.w - 24, tb.y + tb.h / 2 + tf.dy + 1, {
        size: 21, bold: true, align: 'right', color: '#ffe494'
      });
    }
    cy += 70;

    // 分区 A 状态栏
    const statBoxY = cy - sy;
    c.save();
    c.fillStyle = this.bridgeOnline ? 'rgba(38, 88, 22, 0.45)' : 'rgba(120, 36, 18, 0.55)';
    c.strokeStyle = this.bridgeOnline ? '#85dc60' : '#ea6b4e';
    c.lineWidth = 2;
    E.layout.canvas(c, 'options_bridge/stat').beginPath();
    E.layout.canvas(c, 'options_bridge/stat').roundRect(PANEL_X, statBoxY, PANEL_R - PANEL_X, this.bridgeOnline ? 56 : 98, 8);
    E.layout.canvas(c, 'options_bridge/stat').fill();
    E.layout.canvas(c, 'options_bridge/stat').stroke();
    c.restore();

    // 状态文字
    const dotColor = this.bridgeOnline ? '#64dd17' : '#ff5252';
    c.save();
    c.fillStyle = dotColor;
    E.layout.canvas(c, 'options_bridge/dot').beginPath();
    E.layout.canvas(c, 'options_bridge/dot').arc(PANEL_X + 24, statBoxY + 28, 8, 0, Math.PI * 2);
    E.layout.canvas(c, 'options_bridge/dot').fill();
    c.restore();

    E.text(
      `桥状态：${this.bridgeOnline ? '已连接' : '未启动'}  (检测时间: ${this.lastCheckTime})   在线会话: ${this.activeSessions}`,
      PANEL_X + 42, statBoxY + 28,
      { size: 20, bold: true, color: this.bridgeOnline ? '#d9ffcc' : '#ffc4ba' }
    );

    // 检测桥按钮 & 复制命令按钮
    const cb = this.checkStatusBtn;
    const cf = E.fx(cb);
    E.panel(cb.x, cb.y + cf.dy, cb.w, cb.h, { fill: cb.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
    E.text('检测桥', cb.x + cb.w / 2, cb.y + cb.h / 2 + cf.dy, { size: 20, bold: true, align: 'center', color: '#fff4cf' });

    const scb = this.copyStartCmdBtn;
    const scf = E.fx(scb);
    E.panel(scb.x, scb.y + scf.dy, scb.w, scb.h, { fill: scb.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
    E.text('复制启动命令', scb.x + scb.w / 2, scb.y + scb.h / 2 + scf.dy, { size: 20, bold: true, align: 'center', color: '#fff4cf' });

    if (!this.bridgeOnline) {
      E.text('提示：对战桥未启动，LLM 无法接入对局。请在终端执行命令：node tools/mcp/bridge_server.mjs', PANEL_X + 20, statBoxY + 74, {
        size: 19, bold: true, color: '#ffc8be'
      });
    }
    cy += this.bridgeOnline ? 68 : 110;

    // 分区 B 接管国家列表
    E.text('接管国家列表（多选）', PANEL_X, cy + 18 - sy, { size: 24, bold: true, font: SERIF, color: '#3d220a' });
    const bAll = this.selectAllBtn, bClr = this.clearAllBtn, bCpAll = this.copyAllPromptsBtn;
    [bAll, bClr, bCpAll].forEach(b => {
      const f = E.fx(b);
      E.panel(b.x, b.y + f.dy, b.w, b.h, {
        fill: !enabled ? 'rgba(70,50,30,0.5)' : (b.hover ? '#7e5b27' : '#5a4020'),
        stroke: !enabled ? '#887050' : '#d8b66c'
      });
      E.text(b.opts.label, b.x + b.w / 2, b.y + b.h / 2 + f.dy, {
        size: 19, bold: true, align: 'center', color: !enabled ? '#aaa' : '#fff4cf'
      });
    });
    cy += 48;

    const candidates = this.opt.bridgeCountries();
    if (!candidates.length) {
      E.text('（当前未开始对局或无可选 AI 国家）', PANEL_X + 20, cy + 24 - sy, { size: 20, color: '#6d4c22' });
      cy += 50;
    } else {
      for (let i = 0; i < this.countryRowBtns.length; i++) {
        const row = this.countryRowBtns[i];
        const co = row.country;
        const rowY = cy + i * 58 - sy;
        const isChecked = this.opt.bridgeCountriesSelected.has(co);

        // 背景卡片
        c.save();
        c.fillStyle = isChecked ? 'rgba(255, 248, 225, 0.85)' : 'rgba(230, 215, 185, 0.4)';
        c.strokeStyle = isChecked ? '#bba172' : 'rgba(160, 130, 90, 0.4)';
        c.lineWidth = 1.5;
        E.layout.canvas(c, 'options_bridge/row').beginPath();
        E.layout.canvas(c, 'options_bridge/row').roundRect(PANEL_X, rowY, PANEL_R - PANEL_X, 52, 6);
        E.layout.canvas(c, 'options_bridge/row').fill();
        E.layout.canvas(c, 'options_bridge/row').stroke();
        c.restore();

        // 复选框
        const chk = row.chkBtn;
        c.save();
        c.fillStyle = isChecked ? '#2e7d32' : 'rgba(255,255,255,0.7)';
        c.strokeStyle = '#4a2d10';
        c.lineWidth = 2;
        E.layout.canvas(c, 'options_bridge/chk').beginPath();
        E.layout.canvas(c, 'options_bridge/chk').roundRect(chk.x + 8, rowY + 10, 32, 32, 5);
        E.layout.canvas(c, 'options_bridge/chk').fill();
        E.layout.canvas(c, 'options_bridge/chk').stroke();
        if (isChecked) {
          E.text('✔', chk.x + 24, rowY + 26, { size: 22, bold: true, align: 'center', color: '#ffffff' });
        }
        c.restore();

        // 国旗
        const flag = flagOf(co, g?.stage);
        const fl = this.opt.flags?.['sflag_' + flag];
        if (fl) {
          c.save();
          E.drawFrameCentered(fl, PANEL_X + 90, rowY + 26, { scale: 1.15 });
          c.restore();
        }

        // 中文名称与代码
        const cName = playerCountryName(co, g?.stage) || co;
        E.text(cName, PANEL_X + 135, rowY + 26, { size: 22, bold: true, color: '#3a220b' });
        E.text(`[${co}]`, PANEL_X + 135 + cName.length * 22 + 10, rowY + 27, { size: 18, color: '#7a5a32' });

        // 席位状态胶囊
        const seat = this.seatsMap.get(co);
        let tagText = '未接管';
        let tagBg = '#7a7062';
        let tagBorder = '#a09686';
        if (isChecked) {
          if (!this.bridgeOnline) {
            tagText = '桥未启动';
            tagBg = '#8d4332';
            tagBorder = '#c26550';
          } else if (!seat || seat.status === 'offline') {
            tagText = '等待连接';
            tagBg = '#7c5825';
            tagBorder = '#bda062';
          } else if (seat.status === 'attached') {
            tagText = '已连接·等待回合';
            tagBg = '#1e5f8a';
            tagBorder = '#55aee6';
          } else if (seat.status === 'thinking') {
            tagText = '决策中';
            tagBg = '#ad6200';
            tagBorder = '#ffaa33';
          } else if (seat.status === 'fallback') {
            tagText = '本回合内置 AI';
            tagBg = '#6d2b78';
            tagBorder = '#ba62ca';
          } else if (seat.status === 'done') {
            tagText = '已提交';
            tagBg = '#276822';
            tagBorder = '#6ec766';
          }
        }

        const tagW = 160;
        const tagH = 34;
        const tagX = PANEL_X + 460;
        const tagY = rowY + 9;
        c.save();
        c.fillStyle = tagBg;
        c.strokeStyle = tagBorder;
        c.lineWidth = 1.5;
        E.layout.canvas(c, 'options_bridge/tag').beginPath();
        E.layout.canvas(c, 'options_bridge/tag').roundRect(tagX, tagY, tagW, tagH, 6);
        E.layout.canvas(c, 'options_bridge/tag').fill();
        E.layout.canvas(c, 'options_bridge/tag').stroke();
        c.restore();
        E.text(tagText, tagX + tagW / 2, tagY + tagH / 2 + 1, {
          size: 17, bold: true, align: 'center', color: '#ffffff'
        });

        // 专属复制指令按钮
        const cp = row.copyBtn;
        const cpf = E.fx(cp);
        E.panel(cp.x, cp.y + cpf.dy, cp.w, cp.h, {
          fill: !enabled ? 'rgba(70,50,30,0.5)' : (cp.hover ? '#7e5b27' : '#5a4020'),
          stroke: !enabled ? '#887050' : '#d8b66c'
        });
        E.text('复制指令', cp.x + cp.w / 2, cp.y + cp.h / 2 + cpf.dy, {
          size: 19, bold: true, align: 'center', color: !enabled ? '#aaa' : '#fff4cf'
        });
      }
      cy += candidates.length * 58 + 20;
    }

    // 分区 C 对局 ID
    const gid = g?.gameId || '对局未开始（进入战斗生成）';
    E.text('对局 ID：', PANEL_X, cy + 18 - sy, { size: 22, bold: true, color: '#3d220a' });
    E.text(gid, PANEL_X + 110, cy + 18 - sy, { size: 24, font: 'monospace', bold: true, color: '#1a3350' });

    const cid = this.copyIdBtn;
    const cidf = E.fx(cid);
    E.panel(cid.x, cid.y + cidf.dy, cid.w, cid.h, {
      fill: !enabled ? 'rgba(70,50,30,0.5)' : (cid.hover ? '#7e5b27' : '#5a4020'),
      stroke: !enabled ? '#887050' : '#d8b66c'
    });
    E.text('仅复制ID', cid.x + cid.w / 2, cid.y + cid.h / 2 + cidf.dy, {
      size: 19, bold: true, align: 'center', color: !enabled ? '#aaa' : '#fff4cf'
    });
    cy += 60;

    // 分区 D 高级设置
    const at = this.advToggleBtn;
    const atf = E.fx(at);
    E.panel(at.x, at.y + atf.dy, at.w, at.h, {
      fill: at.hover ? '#60421e' : '#452f16',
      stroke: '#9a7442',
      lineWidth: 2
    });
    E.text(
      `${this.advancedExpanded ? '▼' : '▶'} 高级设置（点击${this.advancedExpanded ? '折叠' : '展开'}：桥地址、超时、默认降级）`,
      at.x + 20, at.y + at.h / 2 + atf.dy + 1,
      { size: 21, bold: true, color: '#fff4cf' }
    );
    cy += 58;

    if (this.advancedExpanded) {
      // 桥地址
      const ub = this.bridgeUrlBtn;
      const ubf = E.fx(ub);
      E.panel(ub.x, ub.y + ubf.dy, ub.w, ub.h, { fill: ub.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
      E.text(`桥地址：${this.opt.bridgeUrl}  (点击修改)`, ub.x + 20, ub.y + ub.h / 2 + ubf.dy, {
        size: 21, bold: true, color: '#fff4cf'
      });
      cy += 58;

      // 超时分钟数
      const tmb = this.timeoutMinutesBtn;
      const tmbf = E.fx(tmb);
      E.panel(tmb.x, tmb.y + tmbf.dy, tmb.w, tmb.h, { fill: tmb.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
      E.text(`LLM 超时：${this.opt.bridgeTimeoutMinutes} 分钟  (点击修改)`, tmb.x + 20, tmb.y + tmb.h / 2 + tmbf.dy, {
        size: 20, bold: true, color: '#fff4cf'
      });

      // 超时后行为
      const tab = this.timeoutActionBtn;
      const tabf = E.fx(tab);
      const isFallback = this.opt.bridgeTimeoutAction === 'fallback';
      E.panel(tab.x, tab.y + tabf.dy, tab.w, tab.h, { fill: tab.hover ? '#7e5b27' : '#5a4020', stroke: '#d8b66c' });
      E.text(`超时后行为：${isFallback ? '改用内置 AI' : '继续等待'}  (点击切换)`, tab.x + 20, tab.y + tab.h / 2 + tabf.dy, {
        size: 20, bold: true, color: '#fff4cf'
      });
      cy += 65;
    }

    // 分区 E 简短说明与区别
    const infoBoxY = cy - sy;
    c.save();
    c.fillStyle = 'rgba(255, 248, 225, 0.7)';
    c.strokeStyle = '#bba172';
    c.lineWidth = 1.5;
    E.layout.canvas(c, 'options_bridge/info').beginPath();
    E.layout.canvas(c, 'options_bridge/info').roundRect(PANEL_X, infoBoxY, PANEL_R - PANEL_X, 150, 8);
    E.layout.canvas(c, 'options_bridge/info').fill();
    E.layout.canvas(c, 'options_bridge/info').stroke();
    c.restore();

    E.text('【3步快速使用指南】', PANEL_X + 16, infoBoxY + 26, { size: 20, bold: true, color: '#3d2412' });
    E.text('1. 启动桥：点击上方「复制启动命令」，在本地终端运行 node tools/mcp/bridge_server.mjs；', PANEL_X + 24, infoBoxY + 54, { size: 19, color: '#4a2d10' });
    E.text('2. 勾选要交给 agent 托管的国家（支持多选不同国家控制权）；', PANEL_X + 24, infoBoxY + 80, { size: 19, color: '#4a2d10' });
    E.text('3. 为每个国家复制接管指令，分别粘贴到独立的 Codex / Claude Code 会话中运行。', PANEL_X + 24, infoBoxY + 106, { size: 19, color: '#4a2d10' });
    E.text('★ 区别说明：对战桥让外部 Agent 操控当前浏览器正在进行的对局；与 MCP 服务端无界面的游戏进程不同。', PANEL_X + 24, infoBoxY + 132, { size: 18, bold: true, color: '#7a2810' });

    // 未开启遮罩提示
    if (!enabled) {
      c.save();
      c.fillStyle = 'rgba(40, 25, 10, 0.45)';
      E.layout.canvas(c, 'options_bridge/mask').beginPath();
      E.layout.canvas(c, 'options_bridge/mask').rect(PANEL_X, 290 - sy, PANEL_R - PANEL_X, cy + 180 - 290);
      E.layout.canvas(c, 'options_bridge/mask').fill();
      c.restore();
    }
  }
}
