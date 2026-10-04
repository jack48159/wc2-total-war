// Battlefield V style Server Browser Component
import { E } from '../core/index.js';
import { getStageMeta, getCountryName, getCountryFlagSrc, formatTurnSeconds, formatReparation } from './multiplayer_shared.js';

const STORAGE_FAVORITES = 'wc2.mp.favorites';
const STORAGE_FILTERS = 'wc2.mp.filters';
const STORAGE_SORT = 'wc2.mp.sort';

export class MultiplayerBrowser {
  constructor(delegate) {
    this.delegate = delegate;
    this.rooms = [];
    this.selectedRoomId = null;
    this.favorites = this.loadFavorites();
    this.filters = this.loadFilters();
    this.sort = this.loadSort();
    this.refreshTimer = null;
    this.lastRefreshTime = Date.now();
    this.clockTimer = null;
    this.isFetching = false;
  }

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  loadFavorites() {
    try {
      const data = localStorage.getItem(STORAGE_FAVORITES);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  }

  saveFavorites() {
    try {
      localStorage.setItem(STORAGE_FAVORITES, JSON.stringify([...this.favorites]));
    } catch {}
  }

  loadFilters() {
    const defaults = {
      keyword: '',
      stageType: 'all', // all | campaign | conquest
      onlyJoinable: false,
      onlyFavorites: false,
    };
    try {
      const raw = localStorage.getItem(STORAGE_FILTERS);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;

      // 兼容迁移旧存档字段：旧 hasSlot/hideFull/status=joinable 任一为真 -> onlyJoinable = true
      const migratedJoinable = Boolean(
        parsed.onlyJoinable ||
        parsed.hasSlot ||
        parsed.hideFull ||
        parsed.status === 'joinable'
      );

      const validTypes = ['all', 'campaign', 'conquest'];
      const stageType = validTypes.includes(parsed.stageType) ? parsed.stageType : 'all';

      const filters = {
        keyword: typeof parsed.keyword === 'string' ? parsed.keyword : '',
        stageType,
        onlyJoinable: migratedJoinable,
        onlyFavorites: Boolean(parsed.onlyFavorites),
      };

      // 立即写回清洗后的纯净结构
      try {
        localStorage.setItem(STORAGE_FILTERS, JSON.stringify(filters));
      } catch {}

      return filters;
    } catch {
      return defaults;
    }
  }

  saveFilters() {
    try {
      localStorage.setItem(STORAGE_FILTERS, JSON.stringify(this.filters));
    } catch {}
  }

  hasActiveFilters() {
    return Boolean(
      (this.filters.keyword && this.filters.keyword.trim()) ||
      this.filters.stageType !== 'all' ||
      this.filters.onlyJoinable ||
      this.filters.onlyFavorites
    );
  }

  resetFilters() {
    this.filters = {
      keyword: '',
      stageType: 'all',
      onlyJoinable: false,
      onlyFavorites: false,
    };
    this.saveFilters();
    this.syncFiltersUI();
    this.render();
  }

  loadSort() {
    const defaults = { key: 'default', asc: false }; // default = joinable first + most players
    try {
      const data = localStorage.getItem(STORAGE_SORT);
      return data ? { ...defaults, ...JSON.parse(data) } : defaults;
    } catch {
      return defaults;
    }
  }

  saveSort() {
    try {
      localStorage.setItem(STORAGE_SORT, JSON.stringify(this.sort));
    } catch {}
  }

  mount(container) {
    this.container = container;
    this.container.innerHTML = `
      <div class="mp-browser-view">
        <!-- Main Server Table Section with Top Toolbar -->
        <main class="mp-table-container">
          <!-- Battlefield V Compact Filter Toolbar -->
          <div class="mp-toolbar">
            <div class="mp-search-wrap">
              <input class="mp-input mp-f-keyword" placeholder="搜索房间名 / 房主 / 8位房号…" value="${this.escapeHtml(this.filters.keyword)}">
            </div>

            <div class="mp-toggle-bar mp-stage-type-bar">
              <button type="button" class="mp-toggle-btn ${this.filters.stageType === 'all' ? 'is-active' : ''}" data-val="all">全部</button>
              <button type="button" class="mp-toggle-btn ${this.filters.stageType === 'campaign' ? 'is-active' : ''}" data-val="campaign">战役</button>
              <button type="button" class="mp-toggle-btn ${this.filters.stageType === 'conquest' ? 'is-active' : ''}" data-val="conquest">征服</button>
            </div>

            <label class="mp-checkbox-label mp-toolbar-check">
              <input type="checkbox" class="mp-f-joinable" ${this.filters.onlyJoinable ? 'checked' : ''}>
              <span>只看可加入</span>
            </label>

            <label class="mp-checkbox-label mp-toolbar-check">
              <input type="checkbox" class="mp-f-favorites" ${this.filters.onlyFavorites ? 'checked' : ''}>
              <span>只看收藏</span>
            </label>

            <button type="button" class="mp-link-btn mp-filter-reset" style="${this.hasActiveFilters() ? '' : 'display:none;'}">重置筛选</button>

            <div class="mp-toolbar-spacer"></div>

            <div class="mp-toolbar-meta">
              <span class="mp-table-summary">正在扫描战区服务器…</span>
              <span class="mp-refresh-time" style="color:var(--mp-text-weak); font-size:12px;">刚刚更新</span>
              <button type="button" class="mp-header-btn mp-btn-manual-refresh" style="padding:4px 10px; font-size:12px;">刷新</button>
            </div>
          </div>

          <!-- Server Table Scroll Area -->
          <div class="mp-table-scroll">
            <table class="mp-table">
              <thead>
                <tr>
                  <th style="width:36px; text-align:center;" title="收藏">★</th>
                  <th data-sort="name">服务器名称 <span class="mp-sort-arrow"></span></th>
                  <th data-sort="stage">关卡/战役 <span class="mp-sort-arrow"></span></th>
                  <th data-sort="players" style="width:130px;">席位 <span class="mp-sort-arrow"></span></th>
                  <th data-sort="status" style="width:140px;">状态 <span class="mp-sort-arrow"></span></th>
                  <th data-sort="turn" style="width:90px;">回合时限 <span class="mp-sort-arrow"></span></th>
                  <th style="width:140px;">规则标签</th>
                  <th style="width:170px;">操作</th>
                </tr>
              </thead>
              <tbody class="mp-table-body">
                <!-- Rows injected via renderRows -->
              </tbody>
            </table>
          </div>
        </main>

        <!-- Right Detail Panel -->
        <aside class="mp-detail-panel">
          <!-- Injected via renderDetail -->
        </aside>
      </div>
    `;

    this.bindEvents();
    this.startAutoRefresh();
  }

  bindEvents() {
    const root = this.container;
    // Keyword input
    const kwInput = root.querySelector('.mp-f-keyword');
    kwInput.addEventListener('input', () => {
      this.filters.keyword = kwInput.value.trim();
      this.saveFilters();
      this.render();
    });

    // Stage Type Toggle Bar
    root.querySelectorAll('.mp-stage-type-bar button').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.mp-stage-type-bar button').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.filters.stageType = btn.dataset.val;
        this.saveFilters();
        this.render();
      });
    });

    // Joinable Checkbox
    const joinableCheck = root.querySelector('.mp-f-joinable');
    joinableCheck.addEventListener('change', () => {
      this.filters.onlyJoinable = joinableCheck.checked;
      this.saveFilters();
      this.render();
    });

    // Favorites Checkbox
    const favCheck = root.querySelector('.mp-f-favorites');
    favCheck.addEventListener('change', () => {
      this.filters.onlyFavorites = favCheck.checked;
      this.saveFilters();
      this.render();
    });

    // Reset Filters
    root.querySelector('.mp-filter-reset').addEventListener('click', () => {
      this.resetFilters();
    });

    // Table Header Sort Click
    root.querySelectorAll('.mp-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (this.sort.key === key) {
          this.sort.asc = !this.sort.asc;
        } else {
          this.sort.key = key;
          this.sort.asc = false;
        }
        this.saveSort();
        this.updateSortHeaders();
        this.render();
      });
    });

    // Manual Refresh Button
    root.querySelector('.mp-btn-manual-refresh').addEventListener('click', () => {
      this.fetchRooms(true);
    });

    // Visibility Listener for auto-refresh pausing
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.fetchRooms(false);
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  };

  syncFiltersUI() {
    const root = this.container;
    if (!root) return;
    const kw = root.querySelector('.mp-f-keyword');
    if (kw) kw.value = this.filters.keyword;

    root.querySelectorAll('.mp-stage-type-bar button').forEach(b => {
      b.classList.toggle('is-active', b.dataset.val === this.filters.stageType);
    });

    const joinable = root.querySelector('.mp-f-joinable');
    if (joinable) joinable.checked = this.filters.onlyJoinable;

    const fav = root.querySelector('.mp-f-favorites');
    if (fav) fav.checked = this.filters.onlyFavorites;

    this.updateResetButton();
  }

  updateResetButton() {
    const resetBtn = this.container?.querySelector('.mp-filter-reset');
    if (resetBtn) {
      resetBtn.style.display = this.hasActiveFilters() ? '' : 'none';
    }
  }

  updateSortHeaders() {
    const root = this.container;
    if (!root) return;
    root.querySelectorAll('.mp-table th[data-sort]').forEach(th => {
      const isSorted = th.dataset.sort === this.sort.key;
      th.classList.toggle('is-sorted', isSorted);
      const arrow = th.querySelector('.mp-sort-arrow');
      if (arrow) arrow.textContent = isSorted ? (this.sort.asc ? ' ▲' : ' ▼') : '';
    });
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => this.fetchRooms(false), 5000);
    this.clockTimer = setInterval(() => this.updateRefreshClock(), 1000);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.refreshTimer = null;
    this.clockTimer = null;
  }

  updateRefreshClock() {
    const span = this.container?.querySelector('.mp-refresh-time');
    if (!span) return;
    const diff = Math.floor((Date.now() - this.lastRefreshTime) / 1000);
    span.textContent = diff <= 1 ? '刚刚更新' : `${diff}秒前更新`;
  }

  async refreshRooms(silent = false) {
    return this.fetchRooms(silent);
  }

  async fetchRooms(silent = false) {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const rooms = await this.delegate.requestRooms();
      this.rooms = rooms;
      this.lastRefreshTime = Date.now();
      this.delegate.setConnectionState(true);
      this.render();
    } catch (err) {
      this.delegate.setConnectionState(false, err);
      // Keep old list on error, never clear!
    } finally {
      this.isFetching = false;
    }
  }

  setRooms(rooms) {
    this.rooms = rooms || [];
    this.lastRefreshTime = Date.now();
    this.render();
  }

  filterRooms(rooms) {
    const f = this.filters;
    const kw = (f.keyword || '').toLowerCase().trim();

    return rooms.filter(room => {
      const meta = getStageMeta(room.stage);

      // 1. 收藏过滤
      if (f.onlyFavorites && !this.favorites.has(room.id)) return false;

      // 2. 关卡类型过滤 (全部 / 战役 / 征服)
      if (f.stageType !== 'all' && meta.type !== f.stageType) return false;

      // 3. 关键词过滤：房间名、8位房号、房主名称、关卡名
      if (kw) {
        const host = room.members?.find(m => m.userId === room.hostId)?.username || '';
        const matchName = (room.name || '').toLowerCase().includes(kw);
        const matchId = (room.id || '').toLowerCase().includes(kw);
        const matchHost = host.toLowerCase().includes(kw);
        const matchStage = meta.name.toLowerCase().includes(kw);
        if (!matchName && !matchId && !matchHost && !matchStage) return false;
      }

      // 4. 只看可加入：未开始 且 未满员 (如果是自己所在的房间则始终可见)
      const isMine = room.members.some(m => m.userId === E.user?.id);
      const isFull = room.members.length >= room.settings.playerLimit;
      const isJoinable = !room.started && !isFull;
      if (f.onlyJoinable && !isJoinable && !isMine) return false;

      return true;
    });
  }

  sortRooms(rooms) {
    const list = [...rooms];
    const { key, asc } = this.sort;
    const sign = asc ? 1 : -1;

    list.sort((a, b) => {
      // Favorite on top if enabled or naturally prioritised
      const favA = this.favorites.has(a.id) ? 1 : 0;
      const favB = this.favorites.has(b.id) ? 1 : 0;
      if (favA !== favB) return (favB - favA);

      if (key === 'default') {
        // Joinable priority > Player count > name
        const fullA = a.members.length >= a.settings.playerLimit;
        const fullB = b.members.length >= b.settings.playerLimit;
        const joinableA = !a.started && !fullA ? 1 : 0;
        const joinableB = !b.started && !fullB ? 1 : 0;
        if (joinableA !== joinableB) return joinableB - joinableA;
        if (a.members.length !== b.members.length) return b.members.length - a.members.length;
        return a.name.localeCompare(b.name, 'zh-CN');
      }

      if (key === 'name') return sign * a.name.localeCompare(b.name, 'zh-CN');
      if (key === 'stage') return sign * a.stage.localeCompare(b.stage);
      if (key === 'players') return sign * (a.members.length - b.members.length);
      if (key === 'status') {
        const statA = a.started ? 2 : 1;
        const statB = b.started ? 2 : 1;
        return sign * (statA - statB);
      }
      if (key === 'turn') return sign * ((a.settings.turnSeconds || 9999) - (b.settings.turnSeconds || 9999));
      return 0;
    });

    return list;
  }

  render() {
    if (!this.container) return;
    this.updateSortHeaders();
    this.updateResetButton();
    const filtered = this.filterRooms(this.rooms);
    const sorted = this.sortRooms(filtered);

    // Summary
    const summary = this.container.querySelector('.mp-table-summary');
    if (summary) summary.textContent = `找到 ${sorted.length} 个服务器 / 战区在线 ${this.rooms.length}`;

    // Auto select first room if selection invalid
    if (!this.selectedRoomId && sorted.length > 0) {
      this.selectedRoomId = sorted[0].id;
    } else if (this.selectedRoomId && !this.rooms.some(r => r.id === this.selectedRoomId)) {
      this.selectedRoomId = sorted[0]?.id || null;
    }

    this.renderRows(sorted);
    this.renderDetail();
  }

  renderRows(sortedRooms) {
    const tbody = this.container.querySelector('.mp-table-body');
    if (!tbody) return;

    if (!sortedRooms.length) {
      const hasFilter = this.hasActiveFilters();
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="mp-empty-state">
              <div class="mp-empty-title">${hasFilter ? '没有符合条件的服务器' : '战区暂无进行中的服务器'}</div>
              <div>${hasFilter ? '当前筛选条件下没有匹配的公开作战室。您可以调整筛选条件，或重置筛选。' : '当前没有公开作战室。您可以自己建立新的服务器，邀请战友加入。'}</div>
              <button type="button" class="mp-header-btn is-primary ${hasFilter ? 'mp-btn-clear-filters' : 'mp-btn-guide-create'}" style="margin-top:12px;">
                ${hasFilter ? '清除筛选' : '创建新服务器 →'}
              </button>
            </div>
          </td>
        </tr>
      `;
      tbody.querySelector('.mp-btn-clear-filters')?.addEventListener('click', () => {
        this.resetFilters();
      });
      tbody.querySelector('.mp-btn-guide-create')?.addEventListener('click', () => {
        this.delegate.switchTab('create');
      });
      return;
    }

    // Diff DOM Update to preserve focus and scroll
    const existingRows = new Map();
    tbody.querySelectorAll('tr[data-room-id]').forEach(tr => existingRows.set(tr.dataset.roomId, tr));
    const newFragment = document.createDocumentFragment();

    for (const room of sortedRooms) {
      let tr = existingRows.get(room.id);
      const isSelected = room.id === this.selectedRoomId;
      const isFav = this.favorites.has(room.id);
      const isMine = room.members.some(m => m.userId === E.user?.id);
      const isWatching = room.spectators?.some(m=>m.userId===E.user?.id);
      const isFull = room.members.length >= room.settings.playerLimit;
      const canSpectate=isWatching||(!isMine&&room.settings.allowSpectators!==false&&(room.spectatorCount||0)<(room.settings.spectatorLimit||20));
      const meta = getStageMeta(room.stage);

      if (!tr) {
        tr = document.createElement('tr');
        tr.className = 'mp-row';
        tr.dataset.roomId = room.id;
        tr.tabIndex = 0;
      }

      tr.classList.toggle('is-selected', isSelected);
      tr.classList.toggle('is-full', isFull && !isMine);

      // Format progress bar
      const fillPct = Math.min(100, Math.round((room.members.length / room.settings.playerLimit) * 100));

      // Status text
      let statusHtml = '';
      if (room.started) {
        if (room.paused) {
          statusHtml = `<span class="mp-status-tag is-paused">⏸ 第${room.round}回合 暂停</span>`;
        } else {
          statusHtml = `<span class="mp-status-tag is-playing">⚔ 第${room.round}回合 进行中</span>`;
        }
      } else {
        statusHtml = `<span class="mp-status-tag is-waiting">● 等待部署</span>`;
      }

      // Badges
      const badges = [];
      if (room.settings.fogOfWar) badges.push('<span class="mp-badge" title="迷雾">FOG</span>');
      if (room.settings.reparationRate) badges.push(`<span class="mp-badge" title="赔款倍率">赔款 ${formatReparation(room.settings.reparationRate)}</span>`);
      if (room.settings.private) badges.push('<span class="mp-badge" title="私密房间">私密</span>');

      tr.innerHTML = `
        <td style="text-align:center;">
          <button type="button" class="mp-star-btn ${isFav ? 'is-favorite' : ''}" title="${isFav ? '取消收藏' : '收藏服务器'}">${isFav ? '★' : '☆'}</button>
        </td>
        <td>
          <div class="mp-room-name-cell">
            ${room.settings.private ? '<span class="mp-lock-icon" title="私密房间">🔒</span>' : ''}
            <span class="mp-room-title">${this.escapeHtml(room.name)}</span>
            ${isMine ? '<span class="mp-badge is-campaign" style="font-size:9px;">我的对局</span>' : ''}
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="mp-badge ${meta.type === 'campaign' ? 'is-campaign' : 'is-conquest'}">${meta.type === 'campaign' ? '战役' : '征服'}</span>
            <span style="font-weight:700;">${this.escapeHtml(meta.name)}</span>
          </div>
        </td>
        <td>
          <div class="mp-player-count">
            <span>${room.members.length}/${room.settings.playerLimit}</span>
            <div class="mp-bar-bg"><div class="mp-bar-fill ${isFull ? 'is-full' : ''}" style="width:${fillPct}%;"></div></div>
          </div>
        </td>
        <td>${statusHtml}</td>
        <td style="font-family:var(--mp-font-mono);">${formatTurnSeconds(room.settings.turnSeconds)}</td>
        <td><div style="display:flex; gap:4px; flex-wrap:wrap;">${badges.join('')}</div></td>
        <td><div style="display:flex;gap:5px;align-items:center;"><button type="button" class="mp-header-btn mp-row-join" ${(!isMine&&(room.started||isFull))?'disabled':''}>${isMine?'返回':'加入'}</button><button type="button" class="mp-header-btn mp-row-spectate" ${canSpectate?'':'disabled'}>${isWatching?'继续观战':'观战'} ${(room.spectatorCount||0)}</button></div></td>
      `;

      // Event handlers on row
      tr.onclick = e => {
        if (e.target.closest('.mp-star-btn')) {
          this.toggleFavorite(room.id);
          return;
        }
        if(e.target.closest('.mp-row-join')){this.delegate.joinRoom(room.id);return;}
        if(e.target.closest('.mp-row-spectate')){this.delegate.spectateRoom(room.id);return;}
        this.selectRoom(room.id);
      };

      tr.ondblclick = () => {
        this.delegate.joinRoom(room.id);
      };

      tr.onkeydown = e => {
        if (e.key === 'Enter') {
          this.delegate.joinRoom(room.id);
        }
      };

      newFragment.appendChild(tr);
    }

    tbody.replaceChildren(newFragment);
  }

  toggleFavorite(roomId) {
    if (this.favorites.has(roomId)) {
      this.favorites.delete(roomId);
    } else {
      this.favorites.add(roomId);
    }
    this.saveFavorites();
    this.render();
  }

  selectRoom(roomId) {
    if (this.selectedRoomId === roomId) return;
    this.selectedRoomId = roomId;
    this.container.querySelectorAll('.mp-row').forEach(r => {
      r.classList.toggle('is-selected', r.dataset.roomId === roomId);
    });
    this.renderDetail();
  }

  renderDetail() {
    const panel = this.container?.querySelector('.mp-detail-panel');
    if (!panel) return;

    const room = this.rooms.find(r => r.id === this.selectedRoomId);
    if (!room) {
      panel.innerHTML = `
        <div class="mp-empty-state" style="padding:48px 16px;">
          <div class="mp-empty-title">未选中服务器</div>
          <div>在中间列表中选择一个房间查看详细作战情报</div>
        </div>
      `;
      return;
    }

    const meta = getStageMeta(room.stage);
    const stage = this.delegate.stages?.find(s => s.id === room.stage);
    const isMine = room.members.some(m => m.userId === E.user?.id);
    const isWatching=room.spectators?.some(m=>m.userId===E.user?.id);
    const isFull = room.members.length >= room.settings.playerLimit;
    const canJoin = isMine || (!room.started && !isFull);
    const canSpectate=isWatching||(!isMine&&room.settings.allowSpectators!==false&&(room.spectatorCount||0)<(room.settings.spectatorLimit||20));

    let joinReason = '';
    if (!canJoin) {
      if (room.started) joinReason = '对局已开始，无法加入新席位';
      else if (isFull) joinReason = '房间真人席位已满员';
    }

    const hostMember = room.members.find(m => m.userId === room.hostId);

    panel.innerHTML = `
      <div class="mp-detail-art" style="background-image:url('${meta.bg}');">
        <div class="mp-detail-art-content">
          <span class="mp-badge ${meta.type === 'campaign' ? 'is-campaign' : 'is-conquest'}">${meta.type === 'campaign' ? '特遣战役' : '征服大战略'}</span>
          <h3 class="mp-detail-stage-name">${this.escapeHtml(meta.name)}</h3>
          <div class="mp-detail-stage-sub">${this.escapeHtml(meta.sub)}</div>
        </div>
      </div>

      <div class="mp-detail-body">
        <div class="mp-detail-props">
          <div class="mp-prop-item">
            <span class="mp-prop-label">服务器代号</span>
            <span class="mp-prop-val">${room.id}</span>
          </div>
          <div class="mp-prop-item">
            <span class="mp-prop-label">指挥官 (房主)</span>
            <span class="mp-prop-val">${this.escapeHtml(hostMember?.username || '未知')}</span>
          </div>
          <div class="mp-prop-item">
            <span class="mp-prop-label">真人席位</span>
            <span class="mp-prop-val">${room.members.length} / ${room.settings.playerLimit} 人</span>
          </div>
          <div class="mp-prop-item">
            <span class="mp-prop-label">回合时限</span>
            <span class="mp-prop-val">${formatTurnSeconds(room.settings.turnSeconds)}</span>
          </div>
          <div class="mp-prop-item">
            <span class="mp-prop-label">战争迷雾</span>
            <span class="mp-prop-val">${room.settings.fogOfWar ? '开启' : '关闭'}</span>
          </div>
          <div class="mp-prop-item">
            <span class="mp-prop-label">赔款倍率</span>
            <span class="mp-prop-val">${formatReparation(room.settings.reparationRate)}</span>
          </div>
          <div class="mp-prop-item"><span class="mp-prop-label">观战</span><span class="mp-prop-val">${room.settings.allowSpectators===false?'关闭':`${room.spectatorCount||0}/${room.settings.spectatorLimit||20} 人`}</span></div>
        </div>

        <div class="mp-detail-members">
          <h4>参战指挥官 (${room.members.length}/${room.settings.playerLimit})</h4>
          <div class="mp-member-list">
            ${room.members.map(m => {
              const countryName = m.country ? getCountryName(m.country, stage) : '尚未选择国家';
              const isHost = m.userId === room.hostId;
              const isSelf = m.userId === E.user?.id;
              return `
                <div class="mp-member-item">
                  <div class="mp-member-user">
                    ${isHost ? '<span class="mp-host-crown" title="房主">★</span>' : ''}
                    <span>${this.escapeHtml(m.username)}</span>
                    ${isSelf ? '<small style="color:var(--mp-accent);">(我)</small>' : ''}
                  </div>
                  <div class="mp-member-country">${this.escapeHtml(countryName)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="mp-detail-footer">
        <div style="display:flex;gap:8px;"><button type="button" class="mp-join-action-btn" ${canJoin ? '' : 'disabled'}>
          ${isMine ? (room.started ? '进入对局 (返回战场) →' : '返回房间大厅 →') : '加入服务器 JOIN →'}
        </button><button type="button" class="mp-join-action-btn mp-spectate-action-btn" ${canSpectate?'':'disabled'}>${isWatching?'继续观战':'观战'} (${room.spectatorCount||0})</button></div>
        ${joinReason ? `<div class="mp-join-reason">${joinReason}</div>` : ''}
      </div>
    `;

    panel.querySelector('.mp-join-action-btn')?.addEventListener('click', () => {
      this.delegate.joinRoom(room.id);
    });
    panel.querySelector('.mp-spectate-action-btn')?.addEventListener('click',()=>this.delegate.spectateRoom(room.id));
  }

  quickJoin() {
    // Pick best: not started, not full, most players
    const candidates = this.rooms.filter(r => !r.started && r.members.length < r.settings.playerLimit);
    if (!candidates.length) {
      this.delegate.showModal({
        title: '无合适可用服务器',
        body: '当前所有公开战区服务器均已满员或已开始对局。是否立即创建您自己的服务器？',
        okText: '去创建服务器',
        onOk: () => this.delegate.switchTab('create'),
      });
      return;
    }

    candidates.sort((a, b) => b.members.length - a.members.length);
    const target = candidates[0];
    this.delegate.joinRoom(target.id);
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  dispose() {
    this.stopAutoRefresh();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.container = null;
  }
}
