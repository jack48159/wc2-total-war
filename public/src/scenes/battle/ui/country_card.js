import { isSandbox } from '../../../game/sandbox_policy.js';
import { E } from '../../../core/index.js';
import { World } from '../../../game/world.js';
import { relationKind, relationColor, paintHex, KIND_LABEL } from '../../../game/relation_color.js';
import { playerCountryName } from '../../../game/describe.js';
import { countryGameView, visibilityForCountry } from '../../../game/rules/visibility.js';
import { getDiplomaticRelation, DIPLOMACY_STATE, hasNap, warDuration, relationKey, evaluateAllianceAcceptance } from '../../../game/rules/diplomacy.js';
import { resolveCountryProfile } from '../../../game/rules/national_traits.js';

// Design coordinates: 22px body text remains ~16px at 1136x640.
const STYLE = { width: 430, maxHeight: 460, pad: 24, size: 22,
  fill: '#e4d2a8', border: '#796044', ink: '#352917', muted: '#625039', font: E.CJK_SERIF };
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export class CountryCard {
  constructor(game, army) {
    this.game = game; this.army = army; this.context = null;
    this.drag = null;
    const saved = E.state.countryCardPosition;
    this.position = Number.isFinite(saved?.x) && Number.isFinite(saved?.y)
      ? { x:E.clamp(saved.x, 0, 1), y:E.clamp(saved.y, 0, 1) } : null;
    this.flags = E.atlases.flag_hd;
    E.atlas('flag_hd').then(flags => { this.flags = flags; }).catch(() => {});
  }

  model(areaId) {
    const g = this.game, player = g.player;
    const visible = (g.fogOfWar && !g.bridgeSpectating) ? visibilityForCountry(g, player) : null;
    const view = (g.fogOfWar && !g.bridgeSpectating) ? countryGameView(g, player) : g;
    const id = view.stage.st(areaId)?.country;
    const country = view.stage.countries.get(id);
    if (!id || !country) return null;
    const own = id === player;
    const known = own || !visible || view.stage.areas.some(a => a.country === id && visible.has(a.id));
    const kind = relationKind(g, id);
    const war = getDiplomaticRelation(g, player, id) === DIPLOMACY_STATE.WAR;
    const relation = hasNap(g, player, id) && !war && kind !== 'alliance' ? '互不侵犯' : KIND_LABEL[kind];
    let detail = '', lossesText = '';
    if (!own) {
      if (war) {
        const losses = g.diplomacy?.warLosses?.[relationKey(player, id)] || {};
        detail = g.diplomacy?.enabled ? `交战 ${warDuration(g, player, id)} 回合` : '战争时长与损失：暂无记录';
        if (g.diplomacy?.enabled) lossesText = `损失：我 ${losses[player] || 0} / 对方 ${losses[id] || 0}`;
      } else if (!known) detail = '对我国态度：情报不足';
      else if (kind === 'alliance') detail = '对我国态度：友好（同盟）';
      else if (!g.diplomacy?.enabled) detail = '对我国态度：冷淡（外交未启用）';
      else {
        const score = evaluateAllianceAcceptance(g, player, id).score;
        detail = `对我国态度：${score >= 24 ? '友好' : score < 0 ? '敌视' : '冷淡'}（结盟评估）`;
      }
    }
    // Do not call numeric APIs for an unseen foreign country. The visibility
    // facade filters territories, but its wallet / income methods are not redacted.
    const finance = known ? {
      money: own ? g.money : country.money,
      industry: own ? g.industry : country.industry,
      income: g.income(id), stability: g.getStability(id),
    } : null;
    const wars = [], allies = [];
    for (const other of view.stage.countries.values()) {
      if (other.id === id || other.eliminated) continue;
      const rel = getDiplomaticRelation(g, id, other.id);
      if (rel === DIPLOMACY_STATE.WAR) wars.push(other.id);
      else if (rel === DIPLOMACY_STATE.ALLIANCE) allies.push(other.id);
    }
    const catalog = g.stage.data.traitCatalog;
    const profile = g.stage.data.traitProfiles?.[id] || resolveCountryProfile(catalog, g.name, country);
    const regime = catalog?.regimes?.[country.regime || profile.regime]?.label || '未知';
    const traits = (country.traits || profile.traits).slice(0, 2).map(t => catalog?.traits?.[t]?.label || t);
    return { id, own, relation, detail, lossesText, finance, wars, allies, regime, traits, color: paintHex(relationColor(g, id)) };
  }

  layout(areaId, tileRect) {
    if (!this.context || areaId < 0) return null;
    const { cam, hud, panel } = this.context;
    const area = World.areas[areaId];
    if (!area) return null;
    const w = STYLE.width, h = this.rows.height;
    if (this.position) return {
      x:8 + this.position.x * Math.max(0, E.W - w - 16),
      y:8 + this.position.y * Math.max(0, E.H - h - 16),
      w, h,
    };
    const points = [[area.x, area.y], [area.x + area.w, area.y], [area.x, area.y + area.h], [area.x + area.w, area.y + area.h]].map(p => cam.toScreen(...p));
    const selected = { x: Math.min(...points.map(p => p.x)) - 10, y: Math.min(...points.map(p => p.y)) - 10 };
    selected.w = Math.max(...points.map(p => p.x)) + 10 - selected.x;
    selected.h = Math.max(...points.map(p => p.y)) + 10 - selected.y;
    const obstacles = [...hud.cornerRects(), { x: 0, y: 0, w: 280, h: 100 }, tileRect];
    if (panel.area(areaId)) obstacles.push(panel.rect(areaId));
    // Keep the capital card on the right side, clear of the corner HUD.
    const rightX = E.W - w - 24;
    const candidates = [
      { x: rightX, y: Math.max(tileRect.y, 104), w, h },
      { x: rightX, y: Math.max(104, E.H - h - 24), w, h },
    ].filter(r => r.x >= 0 && r.y >= 0 && r.x + w <= E.W - 8 && r.y + h <= E.H - 8
      && !obstacles.some(o => overlap(r, o)));
    candidates.sort((a, b) => overlap(a, selected) - overlap(b, selected));
    // The capital card must remain available even when another panel occupies its preferred slot.
    const chosen = candidates[0] || {
      x: Math.max(8, rightX),
      y: Math.max(104, Math.min(E.H - h - 8, tileRect.y)),
      w, h,
    };
    if (!chosen) return null;
    // prepare() runs before map drawing. Keep the selected territory visible to the left of the card.
    if (overlap(chosen, selected) || overlap(tileRect, selected)) {
      const targetX = chosen.x - selected.w - 20;
      const edge = cam.toWorld(selected.x, selected.y + selected.h / 2);
      const target = cam.toWorld(targetX, selected.y + selected.h / 2);
      cam.x += edge.x - target.x; cam.y += edge.y - target.y;
    }
    return chosen;
  }

  contains(p) { return inside(p, this.rect); }

  pointerDown(p) {
    if (p.button === 2 || !this.contains(p)) return false;
    this.drag = { x:p.x, y:p.y, offsetX:p.x - this.rect.x, offsetY:p.y - this.rect.y, moved:false };
    return true;
  }

  pointerMove(p) {
    const drag = this.drag;
    if (!drag || !this.rect) return false;
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) <= 4) return true;
    drag.moved = true;
    const rangeX = Math.max(0, E.W - this.rect.w - 16), rangeY = Math.max(0, E.H - this.rect.h - 16);
    this.rect.x = E.clamp(p.x - drag.offsetX, 8, 8 + rangeX);
    this.rect.y = E.clamp(p.y - drag.offsetY, 8, 8 + rangeY);
    this.position = { x:rangeX ? (this.rect.x - 8) / rangeX : 0, y:rangeY ? (this.rect.y - 8) / rangeY : 0 };
    return true;
  }

  pointerUp(p) {
    if (!this.drag) return null;
    this.pointerMove(p);
    return this.cancelDrag();
  }

  cancelDrag() {
    if (!this.drag) return null;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) { E.state.countryCardPosition = { ...this.position }; E.saveState(); }
    return { moved };
  }

  text(value, x, y, options = {}) {
    const opts = { size: STYLE.size, color: STYLE.ink, font: STYLE.font, base: 'middle', ...options };
    let text = String(value);
    if (opts.maxWidth) {
      const c = E.ctx; c.save();
      const setFont = () => { c.font = `${opts.bold ? 'bold ' : ''}${opts.size}px ${opts.font}`; };
      setFont();
      if (c.measureText(text).width > opts.maxWidth) {
        while (text.length && c.measureText(text + '…').width > opts.maxWidth) text = text.slice(0, -1);
        text += '…';
      }
      c.restore();
    }
    E.text(text, x, y, opts);
  }

  flag(id, x, y) {
    const cc = this.game.stage.countries.get(id)?.flag;
    if (!cc || !this.flags) return;
    // Match UnitRenderer.flagFrame, including numbered country variants.
    const raw = String(cc), clean = raw.replace(/\d+$/, '');
    const frame = this.flags['flag_' + raw] || this.flags['flag_' + clean];
    if (frame) E.drawFrame(frame, x, y - 8, { scale: 16 / frame.h, noRef: true, layoutGroup: 'country-card-flag' });
  }

  contentLayout(m) {
    const width = STYLE.width - STYLE.pad * 2, items = [], c = E.ctx;
    // Measure the same font and baseline used to paint. Never shrink text to fit.
    const measure = (value, size = STYLE.size, bold = false) => {
      c.font = `${bold ? 'bold ' : ''}${size}px ${STYLE.font}`;
      const metrics = c.measureText(value);
      const ascent = Math.max(size * 0.8, metrics.actualBoundingBoxAscent || 0);
      const descent = Math.max(size * 0.2, metrics.actualBoundingBoxDescent || 0);
      return { ascent, height: Math.ceil(ascent + descent), width: metrics.width };
    };
    c.save(); c.textBaseline = 'alphabetic';
    const add = (value, top, x = 0, options = {}) => {
      const opts = { size: STYLE.size, maxWidth: width - x, ...options };
      const metrics = measure(value, opts.size, opts.bold);
      items.push({ value, x, y: top + metrics.ascent, options: { ...opts, base: 'alphabetic' } });
      return metrics.height;
    };
    add('与我国：' + (m.own ? '本国' : m.relation), 20, 8,
      { size: 28, bold: true, color: '#fff7e5', maxWidth: width - 16 });
    let top = 66;
    const nameH = add(playerCountryName(m.id, this.game.stage), top, 36, { size: 24, bold: true });
    items.push({ flag: m.id, x: 0, y: top + nameH / 2 });
    top += nameH + 8;
    for (const value of [m.detail, m.lossesText].filter(Boolean))
      top += add(value, top, 0, { size: 20, color: STYLE.muted }) + 4;
    top += 4;
    if (m.finance) {
      const f = m.finance;
      for (const value of [`金钱 ${f.money ?? 0}    工业 ${f.industry ?? 0}`,
        `每回合：金钱 +${f.income.money} / 工业 +${f.income.industry}`, ...(!isSandbox(this.game)?[`稳定度 ${f.stability}`]:[])])
        top += add(value, top) + 4;
    } else top += add('财务：情报不足', top, 0, { color: STYLE.muted }) + 4;
    top += 6;
    // Reserve the measured footer and 24px bottom inset before allocating rosters.
    const footer = `政体：${m.regime} · ${m.traits.join(' / ') || '无主要特性'}`;
    const footerLines = [];
    let line = '';
    for (const char of footer) {
      if (line && measure(line + char, 20).width > width) { footerLines.push(line); line = ''; }
      line += char;
    }
    if (line) footerLines.push(line);
    const footerHeight = footerLines.reduce((h, value) => h + measure(value, 20).height + 4, 0);
    const rowHeight = Math.max(26, ...[...m.wars, ...m.allies].map(id =>
      measure(playerCountryName(id, this.game.stage)).height + 4));
    const capacity = Math.floor((STYLE.maxHeight - top - footerHeight - 8 - 24) / rowHeight);
    const slots = [1, 1], wanted = [Math.max(1, m.wars.length), Math.max(1, m.allies.length)];
    for (let i = 2; i < capacity; i++) {
      const available = [0, 1].filter(n => slots[n] < wanted[n]).sort((a, b) => slots[a] - slots[b]);
      if (!available.length) break;
      slots[available[0]]++;
    }
    for (const [index, ids] of [m.wars, m.allies].entries()) {
      add(index ? '同盟' : '交战', top, 0, { bold: true, color: STYLE.muted });
      const shown = ids.length > slots[index] ? slots[index] - 1 : ids.length;
      if (!ids.length) add('无', top, 60);
      ids.slice(0, shown).forEach((id, i) => {
        const py = top + i * rowHeight;
        const h = add(playerCountryName(id, this.game.stage), py, 94);
        items.push({ flag: id, x: 60, y: py + h / 2 });
      });
      if (shown < ids.length) add(`另 ${ids.length - shown} 国`, top + shown * rowHeight, 60,
        { color: STYLE.muted });
      top += slots[index] * rowHeight;
    }
    top += 8;
    for (const value of footerLines) top += add(value, top, 0, { size: 20, color: STYLE.muted }) + 4;
    c.restore();
    return { items, height: Math.ceil(top + 24) };
  }

  prepare(areaId, tileRect) {
    const area = areaId >= 0 ? this.game.stage.st(areaId) : null;
    const capitalId = this.game.diplomacy?.capitals?.[area?.country];
    const isCapital = area && (Number(capitalId) === Number(areaId)
      || (area.areaType ?? World.areas[areaId]?.areaType) === 1);
    if (!isCapital) {
      this.cancelDrag();
      this.rect = null; this.data = null; this.rows = null;
      this.stamp = null; this.lastPlacedArea = null;
      return;
    }
    const stamp = `${areaId}:${this.game.round}:${this.game.diplomacy?.revision}`;
    const now = performance.now();
    if (stamp !== this.stamp || now - this.modelAt > 200) {
      this.data = this.model(areaId); this.stamp = stamp; this.modelAt = now;
    }
    const m = this.data;
    this.rows = m ? this.contentLayout(m) : null;
    this.rect = m ? this.layout(areaId, tileRect) : null;
  }

  draw() {
    const m = this.data;
    if (!m || !this.rect) return;
    const { x, y, w, h } = this.rect, left = x + STYLE.pad;
    E.layout.region('country-card', { ...this.rect, label: '国家情报卡' }, () => {
      const c = E.layout.canvas(E.ctx, 'country-card/paper-and-header');
      // Reuse the original pause-menu paper, excluding its baked-in pause icon.
      // Read the original atlas, not the optional redrawn HUD proxy.
      const source = E.atlases.ui1_hd?.menubox;
      E.drawParchment(x, y, w, h, { fill:STYLE.fill, stroke:STYLE.border, lineWidth:1.5, r:6,
        shadow:'rgba(0,0,0,0.14)', shadowBlur:6 });
      if (source) {
        // Crop the baked black outline / shadow; the paper keeps a light canvas shadow instead.
        const paper = { ...source, cv:null, x:source.x + 18, y:source.y + 66,
          w:source.w - 48, h:source.h - 98,
          name: 'country_card_paper' };
        c.save(); c.beginPath(); c.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 5); c.clip();
        E.drawFrame(paper, x, y, { sx: w / paper.w, sy: h / paper.h, noRef: true });
        c.restore();
      }
      c.save();
      c.fillStyle = m.color;
      c.fillRect(x + 18, y + 12, w - 36, 44);
      for (const item of this.rows.items) {
        if (item.flag) this.flag(item.flag, left + item.x, y + item.y);
        else this.text(item.value, left + item.x, y + item.y, item.options);
      }
      c.restore();
    });
  }
}
