// Modern Military Multiplayer Lobby (Battlefield V Style)
import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { MultiplayerClient, multiplayerRequest, enterMultiplayerRoom } from '../game/multiplayer_client.js';
import { MultiplayerBrowser } from './multiplayer_browser.js';
import { MultiplayerCreate } from './multiplayer_create.js';
import { MultiplayerRoom } from './multiplayer_room.js';
import { extractRoomCode } from './multiplayer_shared.js';
import { apiUrl, authFetch, requireNetworkLogin } from '../core/auth.js';

export class Multiplayer extends Page {
  constructor(roomId = null, options = {}) {
    super();
    this.roomId = roomId;
    this.stayInRoom = !!options.stayInRoom;
    this.route = roomId ? `multiplayer/${roomId}${this.stayInRoom ? '/info' : ''}` : 'multiplayer';
    this.showBack = false;

    this.activeTab = null; // 'browser' | 'create' | 'myRooms' | 'room'
    this.stages = [];
    this.rooms = [];
    this.room = null;
    this.battleSnapshot = null;
    this.pendingBattle = null;
    this.spectator = false;
    this.live = null;

    // Ping tracking
    this.pingMs = null;
    this.pingTimer = null;
    this.isConnected = true;
  }

  async init() {
    E.user = await requireNetworkLogin();
    // Inject Stylesheet if not already present
    if (!document.getElementById('multiplayer-style')) {
      const sheet = document.createElement('link');
      sheet.id = 'multiplayer-style';
      sheet.rel = 'stylesheet';
      sheet.href = 'src/scenes/multiplayer.css';
      document.head.appendChild(sheet);
    }
    // iOS 用单独的一套布局文件(multiplayer.ios.css)，Windows 版不受影响
    if (E.platform?.isTouch && !document.getElementById('multiplayer-style-ios')) {
      const sheet = document.createElement('link');
      sheet.id = 'multiplayer-style-ios';
      sheet.rel = 'stylesheet';
      sheet.href = 'src/scenes/multiplayer.ios.css';
      document.head.appendChild(sheet);
    }

    this.bg = await E.image('assets/mainbg@2x.webp');

    this.root = document.createElement('section');
    this.root.className = 'mp-screen';
    this.root.innerHTML = `
      <div class="mp-shell">
        <!-- Top Navigation Header -->
        <header class="mp-header">
          <div class="mp-header-left">
            <button class="mp-back-btn" type="button" aria-label="返回主菜单">‹ 返回</button>
            <div class="mp-brand">
              <span class="mp-kicker">HIGH COMMAND · MULTIPLAYER</span>
              <h1 class="mp-title">联合作战</h1>
            </div>

            <!-- Battlefield 5 Style Nav Tabs -->
            <nav class="mp-nav-tabs" role="tablist">
              <button type="button" class="mp-tab is-active" data-tab="browser" role="tab" aria-selected="true">
                服务器浏览器
              </button>
              <button type="button" class="mp-tab" data-tab="create" role="tab" aria-selected="false">
                创建服务器
              </button>
              <button type="button" class="mp-tab" data-tab="myRooms" role="tab" aria-selected="false">
                我的房间
              </button>
            </nav>
          </div>

          <!-- Header Right / Utility Tools -->
          <div class="mp-header-right">
            <div class="mp-stat-pill mp-ping-indicator" title="当前服务器延迟">
              <span class="mp-status-dot"></span>
              <span class="mp-ping-text">测速中…</span>
            </div>
            <button type="button" class="mp-header-btn mp-btn-direct-code">按房号/链接加入</button>
            <button type="button" class="mp-header-btn is-primary mp-btn-quick-join">⚡ 快速加入</button>
          </div>
        </header>

        <!-- Global Alert Banner -->
        <div class="mp-global-error" role="alert"></div>

        <!-- Dynamic Main View Container -->
        <div class="mp-view-container">
          <!-- Active Tab View is rendered here -->
        </div>
      </div>

      <!-- Modal Dialog Container -->
      <div class="mp-modal-container"></div>
    `;

    document.body.appendChild(this.root);
    this.bindHeaderEvents();

    // Start background ping measurement
    this.measurePing();
    this.pingTimer = setInterval(() => this.measurePing(), 10000);

    // Initial load stages & rooms
    await this.loadInitialData();

    // If initial route has roomId, enter it
    if (this.roomId) {
      await this.joinRoom(this.roomId);
    } else {
      this.switchTab('browser');
    }
  }

  bindHeaderEvents() {
    const root = this.root;
    root.querySelector('.mp-back-btn').addEventListener('click', () => E.go('home'));

    // Nav Tabs
    root.querySelectorAll('.mp-nav-tabs .mp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });

    // Quick Join
    root.querySelector('.mp-btn-quick-join').addEventListener('click', () => {
      if (this.browserView) {
        this.browserView.quickJoin();
      } else {
        this.switchTab('browser');
        setTimeout(() => this.browserView?.quickJoin(), 100);
      }
    });

    // Direct Code Modal
    root.querySelector('.mp-btn-direct-code').addEventListener('click', () => {
      this.showJoinCodeModal();
    });
  }

  async loadInitialData() {
    try {
      const [stagesData, roomsData] = await Promise.all([
        multiplayerRequest('stages'),
        multiplayerRequest('rooms'),
      ]);
      this.stages = stagesData.stages || [];
      this.rooms = roomsData.rooms || [];
      this.setConnectionState(true);
    } catch (err) {
      this.setConnectionState(false, err);
      this.showError(err);
    }
  }

  async requestRooms() {
    const data = await multiplayerRequest('rooms');
    this.rooms = data.rooms || [];
    return this.rooms;
  }

  async measurePing() {
    const start = performance.now();
    try {
      const resp = await authFetch('/api/health');
      if (resp.ok) {
        const ms = Math.round(performance.now() - start);
        this.pingMs = ms;
        this.setConnectionState(true);
      } else {
        this.setConnectionState(false);
      }
    } catch {
      this.setConnectionState(false);
    }
  }

  setConnectionState(connected, error = null) {
    this.isConnected = connected;
    const dot = this.root?.querySelector('.mp-status-dot');
    const text = this.root?.querySelector('.mp-ping-text');
    if (!dot || !text) return;

    if (connected) {
      dot.className = 'mp-status-dot';
      text.textContent = `服务器延迟 ${this.pingMs != null ? `${this.pingMs}ms` : '--'}`;
    } else {
      dot.className = 'mp-status-dot is-error';
      text.textContent = '连接中断 · 重试中';
    }
  }

  switchTab(tabKey) {
    if (this.activeTab === 'room' && tabKey !== 'room') {
      // Leaving active room back to lobby
      this.leaveRoomToLobby();
    }

    if (this.activeTab === tabKey) {
      if (tabKey === 'create' && this.createView) {
        if (this.createView.currentStep !== 1) {
          this.createView.goToStep(1);
          this.showToast('已返回创建服务器第 1 步');
        } else {
          this.showToast('当前已在创建服务器');
        }
      } else if (tabKey === 'browser' && this.browserView) {
        this.browserView.refreshRooms(true);
        this.showToast('已刷新房间列表');
      } else if (tabKey === 'myRooms' && this.browserView) {
        const myUserId = E.user?.id;
        const myRooms = this.rooms.filter(r => r.members.some(m => m.userId === myUserId));
        this.browserView.setRooms(myRooms);
        this.showToast('已刷新我的房间');
      }
      return;
    }

    this.activeTab = tabKey;
    const root = this.root;
    if (!root) return;

    // Update Tab UI
    root.querySelectorAll('.mp-nav-tabs .mp-tab').forEach(tab => {
      const isActive = tab.dataset.tab === tabKey;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    const viewContainer = root.querySelector('.mp-view-container');
    viewContainer.replaceChildren();

    // Clean previous views
    this.browserView?.dispose();
    this.browserView = null;
    this.createView?.dispose();
    this.createView = null;
    this.roomView?.dispose();
    this.roomView = null;

    if (tabKey === 'browser' || tabKey === 'myRooms') {
      this.browserView = new MultiplayerBrowser(this);
      this.browserView.mount(viewContainer);
      if (tabKey === 'myRooms') {
        // Filter to only my rooms
        const myUserId = E.user?.id;
        const myRooms = this.rooms.filter(r => r.members.some(m => m.userId === myUserId));
        this.browserView.setRooms(myRooms);
      } else {
        this.browserView.setRooms(this.rooms);
      }
    } else if (tabKey === 'create') {
      this.createView = new MultiplayerCreate(this);
      this.createView.mount(viewContainer);
    } else if (tabKey === 'room') {
      this.roomView = new MultiplayerRoom(this);
      this.roomView.mount(viewContainer, this.room);
    }
  }

  async createRoom(payload) {
    const result = await multiplayerRequest('rooms', 'POST', payload);
    await this.requestRooms();
    return result;
  }

  async enterRoom(roomId, result) {
    this.roomId = roomId;
    this.room = result.room;
    this.spectator = result.role === 'spectator';
    this.route = `multiplayer/${roomId}${this.stayInRoom ? '/info' : ''}`;
    history.replaceState(null, '', new URL(`#${this.route}`, location.href).href);

    // If started and snapshot exists, direct jump to battle if not stayInRoom
    if (this.room.started && result.snapshot && !this.stayInRoom) {
      this.pendingBattle = { stage: this.room.stage, snapshot: result.snapshot, roomId: this.room.id, spectator:this.spectator };
      return;
    }

    if (this.room.started) {
      this.battleSnapshot = result.snapshot || this.battleSnapshot;
    }

    this.switchTab('room');

    // Subscribe live WebSocket
    this.live?.close();
    this.live = new MultiplayerClient(
      roomId,
      packet => this.onLivePacket(packet),
      err => this.showError(err),
      {spectator:this.spectator}
    );
  }

  onLivePacket(packet) {
    if (!this.root) return;
    if(packet.type==='notice'){this.showToast(packet.message);return;}
    if (packet.type === 'roomClosed') {
      if (packet.roomId === this.roomId) {
        this.showModal({
          title: '战役已结束或解散',
          body: packet.reason || '房主已解散本战区房间。',
          okText: '返回大厅',
          onOk: () => this.showLobby(),
        });
      }
      return;
    }

    if (!packet.room || packet.room.id !== this.roomId) return;
    this.room = packet.room;

    if (this.room.started && packet.snapshot && !this.stayInRoom) {
      this.live?.close();
      this.live = null;
      this.pendingBattle = { stage: this.room.stage, snapshot: packet.snapshot, roomId: this.room.id, spectator:this.spectator };
      return;
    }

    if (this.room.started) {
      this.battleSnapshot = packet.snapshot || this.battleSnapshot;
    }

    if (this.activeTab === 'room' && this.roomView) {
      this.roomView.updateData(packet);
    }
  }

  async joinRoom(roomIdOrCode) {
    const code = extractRoomCode(roomIdOrCode);
    if (!code) {
      this.showError(new Error('请输入 8 位有效房间号或完整邀请链接'));
      return;
    }

    try {
      const result = await enterMultiplayerRoom(code);

      if (result.room.started) this.stayInRoom = true;
      await this.enterRoom(code, result);
    } catch (err) {
      this.showError(err);
    }
  }

  async spectateRoom(roomIdOrCode){
    const code=extractRoomCode(roomIdOrCode);if(!code){this.showError(new Error('房间号无效'));return;}
    try{const result=await enterMultiplayerRoom(code,'spectator');this.stayInRoom=false;await this.enterRoom(code,result);}
    catch(err){this.showError(err);}
  }

  async setSpectatorView(country=null){
    if(!this.roomId||!this.spectator)return;
    const result=await multiplayerRequest(`rooms/${this.roomId}/spectator-view`,'POST',{country});
    this.room=result.room;this.battleSnapshot=result.snapshot||this.battleSnapshot;this.roomView?.updateData(result);
    return result;
  }

  async exitSpectate(){
    if(this.roomId&&this.spectator){try{await multiplayerRequest(`rooms/${this.roomId}/leave-spectate`,'POST');}catch{}}
    this.showLobby();
  }

  async chooseCountry(countryId) {
    if (!this.roomId) return;
    const result = await multiplayerRequest(`rooms/${this.roomId}/country`, 'POST', { country: countryId });
    this.room = result.room;
    this.roomView?.updateData(result);
  }

  async saveRoomSettings(settingsPayload) {
    if (!this.roomId) return;
    const result = await multiplayerRequest(`rooms/${this.roomId}/settings`, 'POST', settingsPayload);
    this.room = result.room;
    this.roomView?.updateData(result);
  }

  async startRoomGame() {
    if (!this.roomId) return;
    await multiplayerRequest(`rooms/${this.roomId}/start`, 'POST');
  }

  async togglePauseRoom(paused) {
    if (!this.roomId) return;
    const result = await multiplayerRequest(`rooms/${this.roomId}/pause`, 'POST', { paused });
    this.room = result.room;
    this.roomView?.updateData(result);
  }

  async dissolveRoom() {
    if (!this.roomId) return;
    try {
      await multiplayerRequest(`rooms/${this.roomId}`, 'DELETE');
      this.showToast('✓ 房间已成功解散');
      this.showLobby();
    } catch (err) {
      this.showError(err);
    }
  }

  async returnToBattle() {
    if (!this.room?.started || !this.roomId) return;
    try {
      const snapshot = this.battleSnapshot || (await multiplayerRequest(`rooms/${this.roomId}`)).snapshot;
      E.go('battle', this.room.stage, snapshot, { multiplayerRoom: this.roomId, multiplayerSpectator:this.spectator });
    } catch (err) {
      this.showError(err);
    }
  }

  showLobby() {
    this.leaveRoomToLobby();
    this.switchTab('browser');
    this.requestRooms().then(rooms => {
      this.browserView?.setRooms(rooms);
    });
  }

  leaveRoomToLobby() {
    this.live?.close();
    this.live = null;
    this.roomId = null;
    this.room = null;
    this.route = 'multiplayer';
    this.stayInRoom = false;
    this.spectator = false;
    this.battleSnapshot = null;
    history.replaceState(null, '', new URL('#multiplayer', location.href).href);
  }

  showJoinCodeModal() {
    this.showModal({
      title: '按房号或链接加入服务器',
      body: `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <label for="mp-modal-code-input" style="font-size:12px; font-weight:700; color:var(--mp-text-muted);">
            请输入 8 位战区代号，或粘贴完整房间链接：
          </label>
          <input id="mp-modal-code-input" class="mp-input mp-modal-code-input" placeholder="例如：5B8D3C76" style="font-size:16px; font-family:var(--mp-font-mono); letter-spacing:0.12em; text-transform:uppercase;" autofocus>
          <div class="mp-modal-code-error" style="color:var(--mp-danger); font-size:12px; display:none;"></div>
          <div style="font-size:12px; color:var(--mp-text-weak);">提示：私密房间不出现在公开列表，可通过此窗口凭房号直接加入。</div>
        </div>
      `,
      okText: '进入战区 →',
      onOk: () => {
        const input = this.root.querySelector('.mp-modal-code-input');
        const code = extractRoomCode(input?.value);
        if (!code) {
          const errBox = this.root.querySelector('.mp-modal-code-error');
          if (errBox) {
            errBox.textContent = '无效的房间号。请输入 8 位 16 进制字符或完整对局链接。';
            errBox.style.display = 'block';
          }
          return false; // prevent modal close
        }
        this.joinRoom(code);
        return true;
      }
    });
  }

  showModal({ title, body, okText = '确定', cancelText = '取消', onOk = null, onCancel = null }) {
    const container = this.root?.querySelector('.mp-modal-container');
    if (!container) return;

    container.innerHTML = `
      <div class="mp-modal-backdrop" role="dialog" aria-modal="true">
        <div class="mp-modal">
          <div class="mp-modal-header">
            <h3 class="mp-modal-title">${title}</h3>
            <button type="button" class="mp-modal-close" aria-label="关闭窗口">×</button>
          </div>
          <div class="mp-modal-body">
            ${body}
          </div>
          <div class="mp-modal-footer">
            ${cancelText ? `<button type="button" class="mp-header-btn mp-modal-btn-cancel">${cancelText}</button>` : ''}
            <button type="button" class="mp-header-btn is-primary mp-modal-btn-ok">${okText}</button>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      container.replaceChildren();
      document.removeEventListener('keydown', onKey);
    };

    const onKey = e => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const keep = onOk?.() === false;
        if (!keep) close();
      }
    };
    document.addEventListener('keydown', onKey);

    container.querySelector('.mp-modal-close')?.addEventListener('click', close);
    container.querySelector('.mp-modal-btn-cancel')?.addEventListener('click', () => {
      onCancel?.();
      close();
    });
    container.querySelector('.mp-modal-btn-ok')?.addEventListener('click', () => {
      const keep = onOk?.() === false;
      if (!keep) close();
    });
  }

  showToast(msg) {
    const old = this.root?.querySelector('.mp-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = 'mp-toast';
    toast.textContent = msg;
    this.root?.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 2000);
  }

  showError(err) {
    const banner = this.root?.querySelector('.mp-global-error');
    if (!banner) return;
    const msg = err?.message || String(err);
    if (!msg) {
      banner.classList.remove('is-visible');
      banner.textContent = '';
      return;
    }
    banner.textContent = `[警报] ${msg}`;
    banner.classList.add('is-visible');
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      banner.classList.remove('is-visible');
    }, 6000);
  }

  renderBg() {
    E.cover(this.bg);
  }

  render() {}

  drawChrome() {}

  update() {
    if (!this.pendingBattle || E.scene !== this) return;
    const { stage, snapshot, roomId, spectator } = this.pendingBattle;
    this.pendingBattle = null;
    E.go('battle', stage, snapshot, { multiplayerRoom: roomId, multiplayerSpectator:!!spectator });
  }

  onBack() {
    E.go('home');
  }

  dispose() {
    this.live?.close();
    this.live = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.browserView?.dispose();
    this.createView?.dispose();
    this.roomView?.dispose();
    this.root?.remove();
    this.root = null;
  }
}
