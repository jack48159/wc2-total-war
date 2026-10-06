// Battlefield V style In-Room Command Center Component
import { E } from '../core/index.js';
import {
  getStageMeta,
  getCountryName,
  getCountryFlagSrc,
  formatTurnSeconds,
  formatReparation,
  RELATION_LABELS,
  relationKey
} from './multiplayer_shared.js';

export class MultiplayerRoom {
  constructor(delegate) {
    this.delegate = delegate;
    this.room = null;
    this.stage = null;
    this.order = [];
    this.relations = {};
    this.isSavingSettings = false;
    this.countryPending = null;
  }

  mount(container, roomData) {
    this.container = container;
    this.updateData(roomData);
  }

  updateData(roomData) {
    if (!roomData) return;
    this.room = roomData.room || roomData;
    this.stage = this.delegate.stages?.find(s => s.id === this.room.stage);

    if (this.orderRoomId !== this.room.id || JSON.stringify(this.order) !== JSON.stringify(this.room.turnOrder || this.room.settings?.turnOrder)) {
      this.order = [...(this.room.turnOrder || this.room.settings?.turnOrder || this.stage?.countries?.map(c => c.id) || [])];
      this.orderRoomId = this.room.id;
    }

    if (this.relationRoomId !== this.room.id || JSON.stringify(this.relations) !== JSON.stringify(this.room.settings?.initialRelations || {})) {
      this.relations = { ...(this.room.settings?.initialRelations || {}) };
      this.relationRoomId = this.room.id;
    }

    this.render();
  }

  render() {
    if (!this.container || !this.room) return;
    const room = this.room;
    const stage = this.stage;
    const meta = getStageMeta(room.stage);
    const isHost = room.hostId === E.user?.id;
    const myMember = room.members.find(m => m.userId === E.user?.id);
    const mySpectator = room.spectators?.find(m=>m.userId===E.user?.id);
    const readyCount = room.members.filter(m => m.country).length;
    const allReady = room.members.length >= 1 && room.members.every(m => m.country);
    const countries = this.room.settings?.customCountries?.filter(c=>!c.dormant) || stage?.countries || [];

    this.container.innerHTML = `
      <div class="mp-room-view">
        <!-- Main Command Center (Left/Center) -->
        <main class="mp-room-main">
          <!-- Room Header Banner -->
          <div class="mp-room-header-block">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                <span class="mp-badge ${meta.type === 'campaign' ? 'is-campaign' : 'is-conquest'}">${meta.type === 'campaign' ? '特遣战役' : '征服大战略'}</span>
                <span style="color:var(--mp-text-muted); font-size:12px;">${meta.name}</span>
                ${room.settings.private ? '<span class="mp-badge">私密作战室</span>' : ''}
                ${mySpectator?'<span class="mp-badge">只读观战</span>':''}
              </div>
              <h2 style="margin:0; font-size:24px; font-weight:900; text-transform:uppercase; letter-spacing:0.05em; color:var(--mp-text);">
                ${this.escapeHtml(room.name)}${room.settings.customContentEnabled?'<span class="mp-badge">自定义沙盒 · '+this.escapeHtml((room.settings.configHash||'').slice(0,8))+'</span>':''}
              </h2>
              <div style="color:var(--mp-accent); font-size:13px; margin-top:4px;">
                ${room.started ? `对局进行中 · 第 ${room.round} 回合 · ${room.paused ? '⏸ 联机已暂停' : `🚩 ${getCountryName(room.activeCountry, stage)} 行动中`}` : `部署大厅 · ${room.members.length}/${room.settings.playerLimit} 名指挥官已就位 · ${readyCount}/${room.members.length} 人选定阵营`}
              </div>
            </div>

            <!-- Code & Copy Banner -->
            <div class="mp-room-id-banner">
              <span style="font-size:11px; text-transform:uppercase; color:var(--mp-text-weak); letter-spacing:0.08em;">房间号</span>
              <span class="mp-room-code-tag">${room.id}</span>
              <button type="button" class="mp-header-btn mp-copy-code-btn" style="padding:4px 10px; font-size:12px;">复制房间号</button>
              <button type="button" class="mp-header-btn mp-copy-link-btn" style="padding:4px 10px; font-size:12px;">复制链接</button>
            </div>
          </div>

          <!-- Country Selection Grid Section -->
          <div style="display:flex; gap:8px; flex-wrap:wrap;" aria-label="当前对局规则">
            <span class="mp-badge">征兵${room.settings.recruitWait ? `等待 ${room.settings.recruitWait} 回合` : '立即'}</span>
            <span class="mp-badge">${room.settings.supplyByInfrastructure !== false ? '地区产出补给 · 上限250点' : '固定补给 · 200点'}</span>
          </div>
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div>
                <h3 style="margin:0; font-size:16px; font-weight:900; text-transform:uppercase; letter-spacing:0.06em;">选择出战国家 SEATS</h3>
                <small style="color:var(--mp-text-muted);">${room.started ? '本战役各席位指挥官阵容' : '点击国家卡片立即选定；已被其他玩家选择的国家不可选。'}</small>
              </div>
              <span style="font-family:var(--mp-font-mono); font-size:12px; color:var(--mp-accent);">${countries.length - readyCount} 席位空闲</span>
            </div>

            <div class="mp-country-grid-bf">
              ${countries.map(c => {
                const owner = room.members.find(m => m.country === c.id);
                const isMine = owner?.userId === E.user?.id;
                const isOccupied = !!owner && !isMine;
                const flagSrc = getCountryFlagSrc(c.flag || c.id);
                const flagStyle = flagSrc ? `style="background-image:url('${flagSrc}');"` : '';

                return `
                  <button type="button" class="mp-country-btn ${isMine ? 'is-mine' : ''} ${isOccupied ? 'is-occupied' : ''}" data-country-id="${c.id}" ${mySpectator||room.started || isOccupied || this.countryPending ? 'disabled' : ''}>
                    <div class="mp-country-flag" ${flagStyle}>${flagSrc ? '' : c.id.slice(0, 2).toUpperCase()}</div>
                    <div class="mp-country-meta">
                      <span class="mp-country-name">${this.escapeHtml(c.name || getCountryName(c.id, stage))}</span>
                      <span class="mp-country-status">${isMine ? '✓ 我已选择' : isOccupied ? `${this.escapeHtml(owner.username)} 已选` : '可入驻指挥'}</span>
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Ongoing Match Return Section -->
          ${room.started ? `
            <div style="padding:16px; background:rgba(201,120,54,0.1); border:1px solid var(--mp-accent); display:flex; align-items:center; justify-content:space-between;">
              <div>
                <strong style="color:var(--mp-accent); font-size:15px;">战役正在进行中</strong>
                <p style="margin:4px 0 0; color:var(--mp-text-muted); font-size:13px;">${mySpectator?'观战为只读模式，可缩放地图、查看战报并切换国家视角。':'您可以随时点击「返回对局」重新进入战场沙盘执行指令。'}</p>
              </div>
              <button type="button" class="mp-header-btn is-primary mp-btn-return-battle" style="padding:10px 24px; font-size:14px;">${mySpectator?'进入观战':'返回对局'} →</button>
            </div>
          ` : ''}

          <!-- Wait status text for non-host -->
          ${!isHost && !room.started ? `
            <div style="margin-top:auto; padding:16px; background:rgba(0,0,0,0.4); border:1px solid var(--mp-border); text-align:center; color:var(--mp-text-muted);">
              ${mySpectator?'正在观战房间，等待房主启动战役…':`等待房主配置对局并启动战役… (${readyCount}/${room.members.length} 人已就绪)`}
            </div>
          ` : ''}
        </main>

        <!-- Sidebar (Host Controls & Lobby Actions) -->
        <aside class="mp-room-side">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 class="mp-room-side-title">指挥部控制台</h3>
            <button type="button" class="mp-header-btn mp-btn-back-lobby" style="padding:4px 10px; font-size:12px;">返回大厅</button>
          </div>

          ${isHost && !room.started ? `
            <!-- Host Setting Editor -->
            <div class="mp-host-controls">
              <div class="mp-filter-group">
                <label for="mp-host-name">战区名称</label>
                <input id="mp-host-name" class="mp-input mp-host-name" value="${this.escapeHtml(room.name)}${room.settings.customContentEnabled?'<span class="mp-badge">自定义沙盒 · '+this.escapeHtml((room.settings.configHash||'').slice(0,8))+'</span>':''}" maxlength="40">
              </div>

              <div class="mp-filter-group">
                <label for="mp-host-limit">真人席位 (最大 ${countries.length})</label>
                <input id="mp-host-limit" class="mp-input mp-host-limit" type="number" min="2" max="${Math.min(20, countries.length)}" value="${room.settings.playerLimit}">
              </div>

              <div class="mp-filter-group">
                <label for="mp-host-turn">每回合时限 (秒)</label>
                <input id="mp-host-turn" class="mp-input mp-host-turn" type="number" min="30" max="3600" step="5" value="${room.settings.turnSeconds || 180}">
              </div>

              <div class="mp-filter-group">
                <label for="mp-host-reparation">赔款倍率</label>
                <input id="mp-host-reparation" class="mp-input mp-host-reparation" type="number" min="0.1" max="10" step="0.1" value="${room.settings.reparationRate}">
              </div>

              <div class="mp-filter-group">
                <label for="mp-host-recruit">新占领地区征兵等待（0–8回合）</label>
                <input id="mp-host-recruit" class="mp-input mp-host-recruit" type="number" min="0" max="8" step="1" value="${room.settings.recruitWait ?? 0}">
                <label class="mp-checkbox-label">
                  <input type="checkbox" class="mp-host-supply" ${room.settings.supplyByInfrastructure !== false ? 'checked' : ''}>
                  <span>地区产出补给</span>
                </label>
                <small style="color:var(--mp-text-weak)">开启：金币×2＋工业×5，整格共享，上限250点；关闭：任意己方地块共享200点。</small>
                <label class="mp-checkbox-label">
                  <input type="checkbox" class="mp-host-fog" ${room.settings.fogOfWar ? 'checked' : ''}>
                  <span>开启战争迷雾</span>
                </label>
                <label class="mp-checkbox-label">
                  <input type="checkbox" class="mp-host-private" ${room.settings.private ? 'checked' : ''}>
                  <span>私密房间</span>
                </label>
                <label class="mp-checkbox-label"><input type="checkbox" class="mp-host-spectators" ${room.settings.allowSpectators!==false?'checked':''}><span>允许观战（上限 20）</span></label>
              </div>

              <div style="display:flex; justify-content:flex-end;">
                <button type="button" class="mp-header-btn mp-btn-save-settings" style="width:100%;">
                  ${this.isSavingSettings ? '正在保存…' : '保存房间设置'}
                </button>
              </div>

              <!-- Collapsible Order & Diplomacy Details -->
              <details style="background:rgba(0,0,0,0.3); border:1px solid var(--mp-border); padding:10px;">
                <summary style="cursor:pointer; font-weight:700; color:var(--mp-text);">国家行动顺序调整</summary>
                <div class="mp-turn-order-list" style="max-height:180px; margin-top:8px;">
                  ${this.order.map((cId, idx) => `
                    <div class="mp-turn-order-row" style="padding:4px 8px;">
                      <span style="font-size:12px;">${idx + 1}. ${this.escapeHtml(getCountryName(cId, stage))}</span>
                      <div class="mp-turn-order-btns">
                        <button type="button" class="mp-icon-btn mp-host-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="mp-icon-btn mp-host-down" data-idx="${idx}" ${idx === this.order.length - 1 ? 'disabled' : ''}>↓</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </details>

              <details style="background:rgba(0,0,0,0.3); border:1px solid var(--mp-border); padding:10px;">
                <summary style="cursor:pointer; font-weight:700; color:var(--mp-text);">开局外交立场调整</summary>
                <div class="mp-rel-grid" style="max-height:220px; grid-template-columns:1fr; margin-top:8px;">
                  ${this.renderHostDiplomacyRows(stage)}
                </div>
              </details>

              <!-- Start Button -->
              <button type="button" class="mp-room-action-btn is-start mp-btn-start-game" ${allReady ? '' : 'disabled'}>
                ${allReady ? '开始战役对局 START →' : `等待所有指挥官选定国家 (${readyCount}/${room.members.length})`}
              </button>
            </div>
          ` : ''}

          ${isHost && room.started ? `
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
              <button type="button" class="mp-header-btn mp-btn-toggle-pause" style="width:100%; padding:10px;">
                ${room.paused ? '▶ 继续对局' : '⏸ 暂停对局'}
              </button>
            </div>
          ` : ''}

          <div class="mp-detail-members"><h4>观战者 (${room.spectatorCount||0}/${room.settings.spectatorLimit||20})</h4><div class="mp-member-list">${(room.spectators||[]).map(s=>`<div class="mp-member-item"><span>${this.escapeHtml(s.username)}</span><span>${s.viewCountry?getCountryName(s.viewCountry,stage):'全知视角'}</span></div>`).join('')||'<small style="color:var(--mp-text-weak)">暂无观战者</small>'}</div></div>
          ${mySpectator?`<div class="mp-filter-group"><label>观战视角</label><select class="mp-select mp-spectator-view"><option value="">全知视角</option>${countries.map(c=>`<option value="${c.id}" ${mySpectator.viewCountry===c.id?'selected':''}>跟随 ${this.escapeHtml(c.name||getCountryName(c.id,stage))}</option>`).join('')}</select></div><button type="button" class="mp-room-action-btn is-dissolve mp-btn-exit-spectate">退出观战</button>`:''}

          <!-- Room Dissolve Button (Host only) -->
          ${isHost ? `
            <button type="button" class="mp-room-action-btn is-dissolve mp-btn-dissolve-room">
              解散当前房间 DISSOLVE
            </button>
          ` : ''}
        </aside>
      </div>
    `;

    this.bindEvents();
  }

  renderHostDiplomacyRows(stage) {
    if (!stage) return '';
    const countries = this.room.settings?.customCountries?.filter(c=>!c.dormant) || stage.countries || [];
    const rels = this.relations;
    const rows = [];

    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const first = countries[i];
        const second = countries[j];
        const key = relationKey(first.id, second.id);
        const base = stage.initialRelations?.[key] || 'peace';
        const cur = rels[key] || '';

        rows.push(`
          <div class="mp-rel-item ${cur ? 'is-edited' : ''}" style="padding:4px 6px;">
            <span style="font-size:11px; font-weight:700;">${this.escapeHtml(getCountryName(first.id, stage))} ↔ ${this.escapeHtml(getCountryName(second.id, stage))}</span>
            <select class="mp-select mp-host-rel-select" data-key="${key}" style="width:110px; padding:2px 4px; font-size:10px;">
              <option value="">原设定：${RELATION_LABELS[base] || '和平'}</option>
              <option value="war" ${cur === 'war' ? 'selected' : ''}>交战</option>
              <option value="peace" ${cur === 'peace' ? 'selected' : ''}>和平</option>
              <option value="alliance" ${cur === 'alliance' ? 'selected' : ''}>同盟</option>
            </select>
          </div>
        `);
      }
    }
    return rows.join('');
  }

  bindEvents() {
    const root = this.container;
    if (!root) return;

    // Country Buttons Click
    root.querySelectorAll('.mp-country-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const countryId = btn.dataset.countryId;
        this.chooseCountry(countryId);
      });
    });

    // Copy Room Code
    root.querySelector('.mp-copy-code-btn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.room.id);
        this.delegate.showToast('✓ 房间号已复制到剪贴板');
      } catch {
        this.delegate.showToast(`房间号: ${this.room.id}`);
      }
    });

    // Copy Invite Link
    root.querySelector('.mp-copy-link-btn')?.addEventListener('click', async () => {
      try {
        const url = `${location.origin}${location.pathname}#multiplayer/${this.room.id}`;
        await navigator.clipboard.writeText(url);
        this.delegate.showToast('✓ 完整邀请链接已复制');
      } catch {
        this.delegate.showToast(`链接: #multiplayer/${this.room.id}`);
      }
    });

    // Back to Lobby
    root.querySelector('.mp-btn-back-lobby')?.addEventListener('click', () => {
      if(this.delegate.spectator)this.delegate.exitSpectate();else this.delegate.showLobby();
    });

    // Return to Battle
    root.querySelector('.mp-btn-return-battle')?.addEventListener('click', () => {
      this.delegate.returnToBattle();
    });
    root.querySelector('.mp-spectator-view')?.addEventListener('change',async e=>{try{await this.delegate.setSpectatorView(e.target.value||null);this.delegate.showToast('观战视角已切换');}catch(err){this.delegate.showError(err);}});
    root.querySelector('.mp-btn-exit-spectate')?.addEventListener('click',()=>this.delegate.exitSpectate());

    // Save Settings
    root.querySelector('.mp-btn-save-settings')?.addEventListener('click', () => {
      this.saveHostSettings();
    });

    // Host Turn Order Buttons
    root.querySelectorAll('.mp-host-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        if (i > 0) {
          [this.order[i], this.order[i - 1]] = [this.order[i - 1], this.order[i]];
          this.render();
        }
      });
    });

    root.querySelectorAll('.mp-host-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        if (i < this.order.length - 1) {
          [this.order[i], this.order[i + 1]] = [this.order[i + 1], this.order[i]];
          this.render();
        }
      });
    });

    // Host Diplomacy Selects
    root.querySelectorAll('.mp-host-rel-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const k = sel.dataset.key;
        if (sel.value) this.relations[k] = sel.value;
        else delete this.relations[k];
        sel.closest('.mp-rel-item').classList.toggle('is-edited', !!sel.value);
      });
    });

    // Start Game
    root.querySelector('.mp-btn-start-game')?.addEventListener('click', () => {
      this.startGame();
    });

    // Toggle Pause
    root.querySelector('.mp-btn-toggle-pause')?.addEventListener('click', () => {
      this.delegate.togglePauseRoom(!this.room.paused);
    });

    // Dissolve Room
    root.querySelector('.mp-btn-dissolve-room')?.addEventListener('click', () => {
      this.delegate.showModal({
        title: '解散作战室确认',
        body: `您确定要解散作战室「${this.room.name}」吗？所有已加入的指挥官将被移出，本场战役档案将被清空。`,
        okText: '确认解散',
        onOk: () => this.delegate.dissolveRoom(),
      });
    });
  }

  async chooseCountry(countryId) {
    if (this.countryPending || this.room.started) return;
    this.countryPending = countryId;
    this.render();
    try {
      await this.delegate.chooseCountry(countryId);
    } catch (err) {
      this.delegate.showError(err);
    } finally {
      this.countryPending = null;
      this.render();
    }
  }

  async saveHostSettings() {
    if (this.isSavingSettings || !this.room) return;
    this.isSavingSettings = true;
    const root = this.container;

    try {
      const payload = {
        name: root.querySelector('.mp-host-name').value.trim(),
        playerLimit: Number(root.querySelector('.mp-host-limit').value),
        turnSeconds: Number(root.querySelector('.mp-host-turn').value),
        reparationRate: Number(root.querySelector('.mp-host-reparation').value),
        fogOfWar: root.querySelector('.mp-host-fog').checked,
        supplyByInfrastructure: root.querySelector('.mp-host-supply').checked,
        recruitWait: Number(root.querySelector('.mp-host-recruit').value),
        private: root.querySelector('.mp-host-private').checked,
        allowSpectators: root.querySelector('.mp-host-spectators').checked,
        turnOrder: this.order,
        initialRelations: this.relations || {},
      };

      if(this.room.settings.customContentEnabled)delete payload.initialRelations;
      await this.delegate.saveRoomSettings(payload);
      this.delegate.showToast('✓ 房间设置已保存');
    } catch (err) {
      this.delegate.showError(err);
    } finally {
      this.isSavingSettings = false;
      this.render();
    }
  }

  async startGame() {
    try {
      await this.saveHostSettings();
      await this.delegate.startRoomGame();
    } catch (err) {
      this.delegate.showError(err);
    }
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  dispose() {
    this.container = null;
  }
}
