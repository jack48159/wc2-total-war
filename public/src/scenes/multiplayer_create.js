// Battlefield V style Create Server Component with 5-Step Process & Live Preview
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

export class MultiplayerCreate {
  constructor(delegate) {
    this.delegate = delegate;
    this.currentStep = 1; // 1: 基本, 2: 规则, 3: 行动顺序, 4: 外交, 5: 预览与创建
    this.stageSearch = '';
    this.stageFilterType = 'all';

    // Form model
    this.form = {
      name: '',
      stageId: '',
      private: false,
      allowSpectators: true,
      playerLimit: 2,
      turnSeconds: 180,
      fogOfWar: false,
      supplyByInfrastructure: true,
      recruitWait: 0,
      reparationRate: 1.8,
      turnOrder: [],
      initialRelations: {},
    };

    this.relationCountryFilter = '';
    this.isSubmitting = false;
  }

  mount(container) {
    this.container = container;
    // Default to first stage if not set
    if (!this.form.stageId && this.delegate.stages?.length) {
      this.form.stageId = this.delegate.stages[0].id;
      this.syncStageDependentSettings();
    }

    this.container.innerHTML = `
      <div class="mp-create-view">
        <!-- Step Navigation (Left) -->
        <nav class="mp-step-nav" aria-label="创建步骤">
          <button type="button" class="mp-step-btn ${this.currentStep === 1 ? 'is-active' : ''}" data-step="1">
            <span class="mp-step-num">01</span>
            <span>基本信息</span>
          </button>
          <button type="button" class="mp-step-btn ${this.currentStep === 2 ? 'is-active' : ''}" data-step="2">
            <span class="mp-step-num">02</span>
            <span>战斗规则</span>
          </button>
          <button type="button" class="mp-step-btn ${this.currentStep === 3 ? 'is-active' : ''}" data-step="3">
            <span class="mp-step-num">03</span>
            <span>国家与顺序</span>
          </button>
          <button type="button" class="mp-step-btn ${this.currentStep === 4 ? 'is-active' : ''}" data-step="4">
            <span class="mp-step-num">04</span>
            <span>开局外交</span>
          </button>
          <button type="button" class="mp-step-btn ${this.currentStep === 5 ? 'is-active' : ''}" data-step="5">
            <span class="mp-step-num">05</span>
            <span>预览与创建</span>
          </button>
        </nav>

        <!-- Step Content Panes (Center) -->
        <form class="mp-create-content" onsubmit="return false;">
          <!-- Step 1: Basic -->
          <section class="mp-step-pane ${this.currentStep === 1 ? 'is-active' : ''}" data-pane="1">
            <h3 class="mp-pane-title">第 1 步 · 战区基本设定</h3>
            
            <div class="mp-filter-group" style="max-width:560px;">
              <label for="mp-create-name">房间名称 (选填)</label>
              <input id="mp-create-name" class="mp-input mp-create-name-input" maxlength="40" placeholder="留空默认使用「${E.user?.username || '指挥官'}的房间」" value="${this.escapeHtml(this.form.name)}">
              <span class="mp-input-hint" style="color:var(--mp-text-weak); font-size:12px;">限 40 字符以内，将显示在服务器浏览器列表中。</span>
            </div>

            <div class="mp-filter-group" style="max-width:560px;">
              <label class="mp-checkbox-label">
                <input type="checkbox" class="mp-create-private-check" ${this.form.private ? 'checked' : ''}>
                <span>私密服务器 (不出现在公开列表，仅凭8位房间号或邀请链接加入)</span>
              </label>
              <label class="mp-checkbox-label" style="margin-top:10px;">
                <input type="checkbox" class="mp-create-spectators-check" ${this.form.allowSpectators ? 'checked' : ''}>
                <span>允许观战（最多 20 人，默认全知只读视角）</span>
              </label>
            </div>

            <div class="mp-filter-group">
              <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:16px;">
                <label>选择作战关卡 (必选)</label>
                <div style="display:flex; gap:8px;">
                  <input class="mp-input mp-stage-search" placeholder="搜索关卡名称/ID…" style="width:200px; padding:4px 8px; font-size:12px;" value="${this.escapeHtml(this.stageSearch)}">
                  <div class="mp-toggle-bar">
                    <button type="button" class="mp-toggle-btn ${this.stageFilterType === 'all' ? 'is-active' : ''}" data-type="all">全部</button>
                    <button type="button" class="mp-toggle-btn ${this.stageFilterType === 'campaign' ? 'is-active' : ''}" data-type="campaign">战役</button>
                    <button type="button" class="mp-toggle-btn ${this.stageFilterType === 'conquest' ? 'is-active' : ''}" data-type="conquest">征服</button>
                  </div>
                </div>
              </div>

              <!-- Stage Cards Grid -->
              <div class="mp-stage-grid">
                <!-- Rendered by renderStageGrid -->
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
              <button type="button" class="mp-header-btn is-primary mp-next-step-btn" data-target="2">下一步：配置规则 →</button>
            </div>
          </section>

          <!-- Step 2: Rules -->
          <section class="mp-step-pane ${this.currentStep === 2 ? 'is-active' : ''}" data-pane="2">
            <h3 class="mp-pane-title">第 2 步 · 作战交战规则</h3>

            <!-- Presets Bar -->
            <div class="mp-filter-group">
              <label>规则预设模板</label>
              <div class="mp-preset-bar">
                <button type="button" class="mp-preset-btn" data-preset="quick">⚡ 快速对局 (60s / 无迷雾)</button>
                <button type="button" class="mp-preset-btn" data-preset="standard">★ 标准对局 (180s / 1.8倍赔款)</button>
                <button type="button" class="mp-preset-btn" data-preset="hardcore">☠ 竞技迷雾 (45s / 开启迷雾 / 高赔款)</button>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; max-width:680px;">
              <div class="mp-filter-group">
                <label for="mp-rule-limit">真人席位数量 <small class="mp-limit-note" style="color:var(--mp-accent);"></small></label>
                <input id="mp-rule-limit" class="mp-input mp-rule-limit" type="number" min="2" max="20" value="${this.form.playerLimit}" required>
                <span class="mp-limit-error" style="color:var(--mp-danger); font-size:12px; display:none;">席位数超出所选关卡上限</span>
              </div>

              <div class="mp-filter-group">
                <label for="mp-rule-turn">每位玩家回合时限 (秒)</label>
                <input id="mp-rule-turn" class="mp-input mp-rule-turn" type="number" min="30" max="3600" step="5" value="${this.form.turnSeconds}" required>
                <span style="color:var(--mp-text-weak); font-size:12px;">范围 30 至 3600 秒</span>
              </div>

              <div class="mp-filter-group">
                <label for="mp-rule-reparation">赔款倍率 (战败或条约)</label>
                <input id="mp-rule-reparation" class="mp-input mp-rule-reparation" type="number" min="0.1" max="10" step="0.1" value="${this.form.reparationRate}" required>
                <span style="color:var(--mp-text-weak); font-size:12px;">推荐 1.8 倍，范围 0.1 至 10.0</span>
              </div>

              <div class="mp-filter-group" style="justify-content:center;">
                <label class="mp-checkbox-label">
                  <input type="checkbox" class="mp-rule-fog" ${this.form.fogOfWar ? 'checked' : ''}>
                  <span>开启战争迷雾 (隐藏敌方未侦测区域)</span>
                </label>
              </div>
            </div>

            <div class="mp-filter-group" style="max-width:680px;">
              <label for="mp-rule-recruit">新占领地区征兵等待（回合）</label>
              <input id="mp-rule-recruit" class="mp-input mp-rule-recruit" type="number" min="0" max="8" step="1" value="${this.form.recruitWait}">
              <span style="color:var(--mp-text-weak); font-size:12px;">0 为立即征兵，最多等待 8 回合。</span>
              <label class="mp-checkbox-label">
                <input type="checkbox" class="mp-rule-supply" ${this.form.supplyByInfrastructure ? 'checked' : ''}>
                <span>地区产出补给</span>
              </label>
              <span style="color:var(--mp-text-weak); font-size:12px;">开启：金币×2＋工业×5，整格共享，最多恢复250点；关闭：任意己方地块共享200点。</span>
            </div>

            <div style="display:flex; justify-content:space-between; margin-top:24px;">
              <button type="button" class="mp-header-btn mp-prev-step-btn" data-target="1">‹ 上一步</button>
              <button type="button" class="mp-header-btn is-primary mp-next-step-btn" data-target="3">下一步：国家与顺序 →</button>
            </div>
          </section>

          <!-- Step 3: Turn Order -->
          <section class="mp-step-pane ${this.currentStep === 3 ? 'is-active' : ''}" data-pane="3">
            <h3 class="mp-pane-title">第 3 步 · 参战国家行动顺序</h3>
            <p style="color:var(--mp-text-muted); margin:0;">
              设定回合中国家的行动先后顺序。创建后房主在大厅亦可随时调整。
            </p>

            <div class="mp-turn-order-list">
              <!-- Rendered by renderTurnOrder -->
            </div>

            <div style="display:flex; justify-content:space-between; margin-top:24px;">
              <button type="button" class="mp-header-btn mp-prev-step-btn" data-target="2">‹ 上一步</button>
              <button type="button" class="mp-header-btn is-primary mp-next-step-btn" data-target="4">下一步：外交设定 →</button>
            </div>
          </section>

          <!-- Step 4: Diplomacy -->
          <section class="mp-step-pane ${this.currentStep === 4 ? 'is-active' : ''}" data-pane="4">
            <h3 class="mp-pane-title">第 4 步 · 开局外交立场矩阵</h3>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
              <p style="color:var(--mp-text-muted); margin:0;">
                可自选修改两国开局外交关系；未单独修改的项目将沿用关卡历史预设。
              </p>
              <div style="display:flex; align-items:center; gap:8px;">
                <label for="mp-create-rel-filter" style="font-size:12px; font-weight:700;">筛选国家：</label>
                <select id="mp-create-rel-filter" class="mp-select mp-create-rel-filter" style="width:160px; padding:4px 8px; font-size:12px;">
                  <!-- Options rendered by renderDiplomacy -->
                </select>
              </div>
            </div>

            <div class="mp-rel-grid">
              <!-- Rendered by renderDiplomacy -->
            </div>

            <div style="display:flex; justify-content:space-between; margin-top:24px;">
              <button type="button" class="mp-header-btn mp-prev-step-btn" data-target="3">‹ 上一步</button>
              <button type="button" class="mp-header-btn is-primary mp-next-step-btn" data-target="5">下一步：确认预览 →</button>
            </div>
          </section>

          <!-- Step 5: Summary & Submit -->
          <section class="mp-step-pane ${this.currentStep === 5 ? 'is-active' : ''}" data-pane="5">
            <h3 class="mp-pane-title">第 5 步 · 部署方案总览</h3>
            <p style="color:var(--mp-text-muted); margin:0;">
              一切准备就绪。检查右侧的实时部署卡片，点击下方主按钮立即在战区创建服务器。
            </p>

            <div style="background:rgba(0,0,0,0.3); border:1px solid var(--mp-border); padding:16px; display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px;">
              <div><strong>服务器名称：</strong> <span class="mp-s-name"></span></div>
              <div><strong>战区关卡：</strong> <span class="mp-s-stage"></span></div>
              <div><strong>公开属性：</strong> <span class="mp-s-private"></span></div>
              <div><strong>真人席位：</strong> <span class="mp-s-slots"></span></div>
              <div><strong>回合时限：</strong> <span class="mp-s-turn"></span></div>
              <div><strong>战争迷雾：</strong> <span class="mp-s-fog"></span></div>
              <div><strong>征兵等待：</strong> <span class="mp-s-recruit"></span></div>
              <div><strong>地区产出补给：</strong> <span class="mp-s-supply"></span></div>
              <div><strong>允许观战：</strong> <span class="mp-s-spectators"></span></div>
              <div><strong>赔款倍率：</strong> <span class="mp-s-reparation"></span></div>
              <div><strong>自定义外交修改：</strong> <span class="mp-s-relations"></span></div>
            </div>

            <div class="mp-create-error-banner" style="color:var(--mp-danger); font-size:13px; display:none;"></div>

            <div style="display:flex; justify-content:space-between; margin-top:24px;">
              <button type="button" class="mp-header-btn mp-prev-step-btn" data-target="4">‹ 上一步</button>
              <button type="button" class="mp-header-btn is-primary mp-btn-submit-create" style="padding:12px 32px; font-size:15px;">立即建立对局 →</button>
            </div>
          </section>
        </form>

        <!-- Live Server Preview Panel (Right) -->
        <aside class="mp-preview-panel">
          <div class="mp-preview-heading">实时服务器预览 LIVE PREVIEW</div>
          
          <div class="mp-preview-card">
            <div class="mp-preview-art">
              <span class="mp-badge mp-preview-badge is-campaign">战役</span>
              <h4 class="mp-preview-stage-name" style="margin:4px 0 0; font-size:18px; color:var(--mp-text);">闪电战</h4>
              <div class="mp-preview-stage-sub" style="font-size:11px; color:var(--mp-accent); font-family:var(--mp-font-mono);">CAMPAIGN</div>
            </div>
            
            <div class="mp-preview-body">
              <div style="font-size:15px; font-weight:900; color:var(--mp-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" class="mp-preview-room-name">
                指挥官的房间
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--mp-text-muted);">
                <span>席位容量</span>
                <strong style="color:var(--mp-text);" class="mp-preview-slots">1 / 2 人</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--mp-text-muted);">
                <span>回合时限</span>
                <strong style="color:var(--mp-text);" class="mp-preview-turn">180秒</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--mp-text-muted);">
                <span>战争迷雾</span>
                <strong style="color:var(--mp-text);" class="mp-preview-fog">关闭</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--mp-text-muted);">
                <span>赔款倍率</span>
                <strong style="color:var(--mp-text);" class="mp-preview-reparation">×1.8</strong>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;" class="mp-preview-tags">
                <!-- Tags -->
              </div>
            </div>
          </div>

          <button type="button" class="mp-create-submit-btn mp-btn-side-submit">
            创建服务器 CREATE →
          </button>
        </aside>
      </div>
    `;

    this.bindEvents();
    this.renderStageGrid();
    this.renderTurnOrder();
    this.renderDiplomacy();
    this.updatePreview();
  }

  bindEvents() {
    const root = this.container;

    // Step Navigation Clicks
    root.querySelectorAll('.mp-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.goToStep(Number(btn.dataset.step));
      });
    });

    root.querySelectorAll('.mp-next-step-btn, .mp-prev-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.goToStep(Number(btn.dataset.target));
      });
    });

    // Name Input
    const nameInput = root.querySelector('.mp-create-name-input');
    nameInput.addEventListener('input', () => {
      this.form.name = nameInput.value;
      this.updatePreview();
    });

    // Private Check
    const privateCheck = root.querySelector('.mp-create-private-check');
    privateCheck.addEventListener('change', () => {
      this.form.private = privateCheck.checked;
      this.updatePreview();
    });
    root.querySelector('.mp-create-spectators-check')?.addEventListener('change',e=>{this.form.allowSpectators=e.target.checked;this.updatePreview();});

    // Stage Search & Filter
    const stageSearch = root.querySelector('.mp-stage-search');
    stageSearch.addEventListener('input', () => {
      this.stageSearch = stageSearch.value.trim().toLowerCase();
      this.renderStageGrid();
    });

    root.querySelectorAll('.mp-step-pane[data-pane="1"] .mp-toggle-bar button').forEach(b => {
      b.addEventListener('click', () => {
        root.querySelectorAll('.mp-step-pane[data-pane="1"] .mp-toggle-bar button').forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        this.stageFilterType = b.dataset.type;
        this.renderStageGrid();
      });
    });

    // Presets
    root.querySelectorAll('.mp-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.applyPreset(btn.dataset.preset);
      });
    });

    // Rule Inputs
    const limitInput = root.querySelector('.mp-rule-limit');
    limitInput.addEventListener('input', () => {
      this.form.playerLimit = Number(limitInput.value) || 2;
      this.validateLimit();
      this.updatePreview();
    });

    const turnInput = root.querySelector('.mp-rule-turn');
    turnInput.addEventListener('input', () => {
      this.form.turnSeconds = Number(turnInput.value) || 180;
      this.updatePreview();
    });

    const repInput = root.querySelector('.mp-rule-reparation');
    repInput.addEventListener('input', () => {
      this.form.reparationRate = Number(repInput.value) || 1.8;
      this.updatePreview();
    });

    const fogCheck = root.querySelector('.mp-rule-fog');
    fogCheck.addEventListener('change', () => {
      this.form.fogOfWar = fogCheck.checked;
      this.updatePreview();
    });

    // Submits
    root.querySelector('.mp-rule-recruit').addEventListener('input', e => {
      this.form.recruitWait = Number(e.target.value);
      this.updatePreview();
    });
    root.querySelector('.mp-rule-supply').addEventListener('change', e => {
      this.form.supplyByInfrastructure = e.target.checked;
      this.updatePreview();
    });
    root.querySelector('.mp-btn-submit-create')?.addEventListener('click', () => this.submit());
    root.querySelector('.mp-btn-side-submit')?.addEventListener('click', () => this.submit());
  }

  goToStep(stepNum) {
    if (stepNum < 1 || stepNum > 5) return;
    this.currentStep = stepNum;
    const root = this.container;
    root.querySelectorAll('.mp-step-btn').forEach(b => {
      b.classList.toggle('is-active', Number(b.dataset.step) === stepNum);
    });
    root.querySelectorAll('.mp-step-pane').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.pane) === stepNum);
    });
    this.updatePreview();
  }

  syncStageDependentSettings() {
    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    if (!stage) return;
    const maxSlots = Math.min(20, stage.countries.length);
    if (this.form.playerLimit > maxSlots) {
      this.form.playerLimit = maxSlots;
    }
    this.form.turnOrder = stage.countries.map(c => c.id);
    this.form.initialRelations = {};
    this.validateLimit();
  }

  validateLimit() {
    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    const maxSlots = stage ? Math.min(20, stage.countries.length) : 20;
    const root = this.container;
    if (!root) return true;

    const note = root.querySelector('.mp-limit-note');
    if (note) note.textContent = `(本关最大可选 ${maxSlots} 人)`;

    const input = root.querySelector('.mp-rule-limit');
    if (input) input.max = maxSlots;

    const errorSpan = root.querySelector('.mp-limit-error');
    const isInvalid = this.form.playerLimit < 2 || this.form.playerLimit > maxSlots;
    if (errorSpan) errorSpan.style.display = isInvalid ? 'block' : 'none';

    return !isInvalid;
  }

  applyPreset(presetKey) {
    if (presetKey === 'quick') {
      this.form.turnSeconds = 60;
      this.form.fogOfWar = false;
      this.form.reparationRate = 1.8;
    } else if (presetKey === 'standard') {
      this.form.turnSeconds = 180;
      this.form.fogOfWar = false;
      this.form.reparationRate = 1.8;
    } else if (presetKey === 'hardcore') {
      this.form.turnSeconds = 45;
      this.form.fogOfWar = true;
      this.form.reparationRate = 2.5;
    }

    const root = this.container;
    root.querySelector('.mp-rule-turn').value = this.form.turnSeconds;
    root.querySelector('.mp-rule-reparation').value = this.form.reparationRate;
    root.querySelector('.mp-rule-fog').checked = this.form.fogOfWar;
    this.updatePreview();
  }

  renderStageGrid() {
    const grid = this.container?.querySelector('.mp-stage-grid');
    if (!grid) return;

    const stages = this.delegate.stages || [];
    const search = this.stageSearch;
    const typeFilter = this.stageFilterType;

    const filtered = stages.filter(stage => {
      const meta = getStageMeta(stage.id);
      if (typeFilter !== 'all' && meta.type !== typeFilter) return false;
      if (search) {
        const matchName = meta.name.toLowerCase().includes(search);
        const matchId = stage.id.toLowerCase().includes(search);
        if (!matchName && !matchId) return false;
      }
      return true;
    });

    grid.innerHTML = filtered.map(stage => {
      const meta = getStageMeta(stage.id);
      const isSelected = stage.id === this.form.stageId;
      return `
        <div class="mp-stage-card ${isSelected ? 'is-selected' : ''}" data-stage-id="${stage.id}">
          <div class="mp-stage-card-thumb" style="background-image:url('${meta.bg}');"></div>
          <div class="mp-stage-card-info">
            <div class="mp-stage-card-title">${this.escapeHtml(meta.name)}</div>
            <div class="mp-stage-card-sub">${meta.type === 'campaign' ? '战役' : '征服'} · ${stage.countries.length}国参战</div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.mp-stage-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.stageId;
        this.form.stageId = id;
        this.syncStageDependentSettings();
        grid.querySelectorAll('.mp-stage-card').forEach(c => c.classList.toggle('is-selected', c.dataset.stageId === id));
        this.renderTurnOrder();
        this.renderDiplomacy();
        this.updatePreview();
      });
    });
  }

  renderTurnOrder() {
    const list = this.container?.querySelector('.mp-turn-order-list');
    if (!list) return;

    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    const order = this.form.turnOrder;

    if (!order.length) {
      list.innerHTML = `<div style="color:var(--mp-text-weak); padding:16px;">请先在第1步选择关卡</div>`;
      return;
    }

    list.innerHTML = order.map((cId, idx) => {
      const name = getCountryName(cId, stage);
      return `
        <div class="mp-turn-order-row">
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-family:var(--mp-font-mono); font-weight:900; color:var(--mp-accent); width:24px;">${idx + 1}.</span>
            <span style="font-weight:700;">${this.escapeHtml(name)}</span>
          </div>
          <div class="mp-turn-order-btns">
            <button type="button" class="mp-icon-btn mp-order-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="mp-icon-btn mp-order-down" data-idx="${idx}" ${idx === order.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.mp-order-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        if (i > 0) {
          [order[i], order[i - 1]] = [order[i - 1], order[i]];
          this.renderTurnOrder();
        }
      });
    });

    list.querySelectorAll('.mp-order-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        if (i < order.length - 1) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
          this.renderTurnOrder();
        }
      });
    });
  }

  renderDiplomacy() {
    const root = this.container;
    if (!root) return;

    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    const filterSelect = root.querySelector('.mp-create-rel-filter');
    const grid = root.querySelector('.mp-rel-grid');
    if (!stage || !grid || !filterSelect) return;

    const countries = stage.countries || [];
    filterSelect.replaceChildren(new Option('全部国家', ''));
    for (const c of countries) {
      filterSelect.add(new Option(getCountryName(c.id, stage), c.id));
    }
    if (this.relationCountryFilter && countries.some(c => c.id === this.relationCountryFilter)) {
      filterSelect.value = this.relationCountryFilter;
    } else {
      filterSelect.value = '';
    }

    filterSelect.onchange = () => {
      this.relationCountryFilter = filterSelect.value;
      this.renderDiplomacyGrid();
    };

    this.renderDiplomacyGrid();
  }

  renderDiplomacyGrid() {
    const grid = this.container?.querySelector('.mp-rel-grid');
    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    if (!grid || !stage) return;

    const countries = stage.countries || [];
    const rels = this.form.initialRelations;
    const filter = this.relationCountryFilter;

    const items = [];
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const first = countries[i];
        const second = countries[j];
        if (filter && first.id !== filter && second.id !== filter) continue;

        const key = relationKey(first.id, second.id);
        const base = stage.initialRelations?.[key] || 'peace';
        const currentVal = rels[key] || '';

        items.push({
          key,
          firstName: getCountryName(first.id, stage),
          secondName: getCountryName(second.id, stage),
          baseLabel: RELATION_LABELS[base] || '和平',
          currentVal,
        });
      }
    }

    grid.innerHTML = items.map(item => `
      <div class="mp-rel-item ${item.currentVal ? 'is-edited' : ''}">
        <span style="font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">
          ${this.escapeHtml(item.firstName)} ↔ ${this.escapeHtml(item.secondName)}
        </span>
        <select class="mp-select" data-key="${item.key}" style="width:125px; padding:4px 6px; font-size:11px;">
          <option value="">原设定：${item.baseLabel}</option>
          <option value="war" ${item.currentVal === 'war' ? 'selected' : ''}>交战</option>
          <option value="peace" ${item.currentVal === 'peace' ? 'selected' : ''}>和平</option>
          <option value="alliance" ${item.currentVal === 'alliance' ? 'selected' : ''}>同盟</option>
        </select>
      </div>
    `).join('');

    grid.querySelectorAll('select[data-key]').forEach(sel => {
      sel.addEventListener('change', () => {
        const k = sel.dataset.key;
        if (sel.value) {
          this.form.initialRelations[k] = sel.value;
          sel.closest('.mp-rel-item').classList.add('is-edited');
        } else {
          delete this.form.initialRelations[k];
          sel.closest('.mp-rel-item').classList.remove('is-edited');
        }
        this.updatePreview();
      });
    });
  }

  updatePreview() {
    const root = this.container;
    if (!root) return;

    const meta = getStageMeta(this.form.stageId);
    const stage = this.delegate.stages?.find(s => s.id === this.form.stageId);
    const displayName = this.form.name.trim() || `${E.user?.username || '指挥官'}的房间`;

    // Step 5 summary bindings
    root.querySelector('.mp-s-name').textContent = displayName;
    root.querySelector('.mp-s-stage').textContent = `${meta.name} (${stage?.countries.length || 0}国)`;
    root.querySelector('.mp-s-private').textContent = this.form.private ? '私密房间' : '公开服务器';
    root.querySelector('.mp-s-slots').textContent = `${this.form.playerLimit} 人`;
    root.querySelector('.mp-s-turn').textContent = formatTurnSeconds(this.form.turnSeconds);
    root.querySelector('.mp-s-fog').textContent = this.form.fogOfWar ? '开启' : '关闭';
    root.querySelector('.mp-s-recruit').textContent = this.form.recruitWait ? `${this.form.recruitWait} 回合` : '立即征兵';
    root.querySelector('.mp-s-supply').textContent = this.form.supplyByInfrastructure ? '按地区产出（上限250点）' : '固定200点';
    root.querySelector('.mp-s-spectators').textContent=this.form.allowSpectators?'允许（上限 20）':'关闭';
    root.querySelector('.mp-s-reparation').textContent = formatReparation(this.form.reparationRate);
    root.querySelector('.mp-s-relations').textContent = `${Object.keys(this.form.initialRelations).length} 项修改`;

    // Right Preview Card bindings
    const art = root.querySelector('.mp-preview-art');
    if (art) art.style.backgroundImage = `url('${meta.bg}')`;

    const badge = root.querySelector('.mp-preview-badge');
    if (badge) {
      badge.className = `mp-badge mp-preview-badge ${meta.type === 'campaign' ? 'is-campaign' : 'is-conquest'}`;
      badge.textContent = meta.type === 'campaign' ? '特遣战役' : '征服大战略';
    }

    const stageName = root.querySelector('.mp-preview-stage-name');
    if (stageName) stageName.textContent = meta.name;

    const stageSub = root.querySelector('.mp-preview-stage-sub');
    if (stageSub) stageSub.textContent = meta.sub;

    const roomName = root.querySelector('.mp-preview-room-name');
    if (roomName) roomName.textContent = displayName;

    const slots = root.querySelector('.mp-preview-slots');
    if (slots) slots.textContent = `1 / ${this.form.playerLimit} 人`;

    const turn = root.querySelector('.mp-preview-turn');
    if (turn) turn.textContent = formatTurnSeconds(this.form.turnSeconds);

    const fog = root.querySelector('.mp-preview-fog');
    if (fog) fog.textContent = this.form.fogOfWar ? '开启' : '关闭';

    const rep = root.querySelector('.mp-preview-reparation');
    if (rep) rep.textContent = formatReparation(this.form.reparationRate);

    const tags = root.querySelector('.mp-preview-tags');
    if (tags) {
      const tagList = [];
      if (this.form.fogOfWar) tagList.push('<span class="mp-badge">FOG</span>');
      tagList.push(`<span class="mp-badge">${this.form.supplyByInfrastructure ? '地区产出补给' : '固定200点补给'}</span>`);
      tagList.push(`<span class="mp-badge">征兵${this.form.recruitWait ? `等待${this.form.recruitWait}回合` : '立即'}</span>`);
      if (this.form.reparationRate) tagList.push(`<span class="mp-badge">赔款 ${formatReparation(this.form.reparationRate)}</span>`);
      if (this.form.private) tagList.push('<span class="mp-badge">PRIVATE</span>');
      tags.innerHTML = tagList.join('');
    }
  }

  async submit() {
    if (this.isSubmitting) return;
    if (!this.validateLimit()) {
      this.goToStep(2);
      return;
    }

    const errorBanner = this.container.querySelector('.mp-create-error-banner');
    if (errorBanner) errorBanner.style.display = 'none';

    this.isSubmitting = true;
    const submitBtns = this.container.querySelectorAll('.mp-btn-submit-create, .mp-btn-side-submit');
    submitBtns.forEach(b => {
      b.disabled = true;
      b.textContent = '正在部署建立战区…';
    });

    try {
      const payload = {
        name: this.form.name.trim(),
        stage: this.form.stageId,
        playerLimit: Number(this.form.playerLimit),
        turnSeconds: Number(this.form.turnSeconds),
        fogOfWar: !!this.form.fogOfWar,
        supplyByInfrastructure: !!this.form.supplyByInfrastructure,
        recruitWait: Number(this.form.recruitWait),
        private: !!this.form.private,
        allowSpectators: !!this.form.allowSpectators,
        reparationRate: Number(this.form.reparationRate),
        initialRelations: this.form.initialRelations || {},
      };

      const result = await this.delegate.createRoom(payload);
      if (result?.room?.id) {
        // Success: delegate enters room
        await this.delegate.enterRoom(result.room.id, result);
      }
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = `创建失败: ${err.message || String(err)}`;
        errorBanner.style.display = 'block';
      }
      this.delegate.showError(err);
    } finally {
      this.isSubmitting = false;
      submitBtns.forEach(b => {
        b.disabled = false;
        b.textContent = '立即建立对局 →';
      });
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
