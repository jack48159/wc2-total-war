// Country ranking drawn inside the original leather administration board.
import { E } from '../../../core/index.js';
import { buildSituationReport } from '../../../game/situation.js';
import { relationColor, paintHex } from '../../../game/relation_color.js';

const SERIF = E.CJK_SERIF || 'Songti SC, SimSun, serif';
const INK = '#392414', RED = '#91371f';
const COLUMNS = [
  { label: '综合分', field: 'score' },
  { label: '经济', field: 'economy' },
  { label: '税收', field: 'tax' },
  { label: '兵力', field: 'armyCount' },
  { label: '面积', field: 'areaCount' },
];

export class SituationPanel {
  constructor(owner) {
    this.owner = owner;
    this.sortType = 0;
    this.descending = true;
    this.scroll = 0;
    this.drag = null;
    this.report = null;
    this.reportAt = 0;
    this.rect = null;
  }

  rows() {
    if (!this.report || this.report.sortType !== this.sortType || performance.now() - this.reportAt > 500) {
      this.report = buildSituationReport(this.owner.game, this.sortType);
      this.reportAt = performance.now();
    }
    if (this.descending) return this.report.rows;
    return [...this.report.rows].sort((a, b) =>
      a.defeated !== b.defeated ? (a.defeated ? 1 : -1) :
        (this.value(a, this.sortType) ?? 0) - (this.value(b, this.sortType) ?? 0) || a.id.localeCompare(b.id));
  }

  value(row, type = this.sortType) {
    const field = COLUMNS[type].field;
    return field === 'economy'
      ? row.money == null ? null : Math.max(0, row.money) + Math.max(0, row.industry)
      : row[field];
  }

  flagFrame(row) {
    const code = row.flag || row.id, key = 'flag_' + code;
    const clean = 'flag_' + code.replace(/\d+$/, '');
    const assets = this.owner.assets;
    return assets.flagAtlas?.[key] || assets.flagAtlas?.[clean]
      || assets.armyAtlas?.[key] || assets.armyAtlas?.[clean];
  }

  factionColor(row) {
    if (!(this.owner.game.spectating || this.owner.game.bridgeSpectating)) return paintHex(row.isPlayer ? 'green' : relationColor(this.owner.game, row.id));
    const colors = ['#b23e2b', '#3267a0', '#48844b', '#b37d2a', '#7e498b', '#4f8584', '#d16ba5'];
    const alliance = row.alliance;
    const n = typeof alliance === 'number' ? alliance
      : String(alliance ?? '').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return colors[Math.abs(n) % colors.length];
  }

  columnXs(w) {
    const start = Math.max(380, w * .49), step = (w - start - 55) / 5;
    return COLUMNS.map((_, i) => start + step * (i + 1) - 7);
  }

  rowHeight() { return 46; }
  listHeight() { return Math.max(0, this.rect?.h / this.rect?.scale - 60 || 0); }
  maxScroll() { return Math.max(0, this.rows().length * this.rowHeight() - this.listHeight()); }
  clampScroll() { this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll)); }

  down(p, cx, cy, cw, ch, scale) {
    this.rect = { x: cx, y: cy, w: cw, h: ch, scale };
    const x = (p.x - cx) / scale, y = (p.y - cy) / scale, w = cw / scale;
    const minTouch = 44 * E.W / E.logicalRect().width / scale;
    if (x < 0 || x > w) return;
    if (y >= 0 && y <= Math.max(54, minTouch)) {
      const xs = this.columnXs(w);
      const index = xs.findIndex((right, i) => x < (xs[i + 1] == null ? w : (right + xs[i + 1]) / 2));
      if (index >= 0) {
        this.descending = index === this.sortType ? !this.descending : true;
        this.sortType = index;
        this.report = null;
        this.scroll = 0;
        E.playSfx('select.wav');
      }
    } else if (y >= 54 && y <= ch / scale) {
      this.drag = { y: p.y, scroll: this.scroll };
    }
  }

  move(p) {
    if (!this.drag || !this.rect) return;
    this.scroll = this.drag.scroll - (p.y - this.drag.y) / this.rect.scale;
    this.clampScroll();
  }
  up() { this.drag = null; }
  wheel(delta) {
    if (!this.rect) return;
    this.scroll += delta / this.rect.scale;
    this.clampScroll();
  }

  drawRank(c, rank, x, y, defeated) {
    const medal = !defeated && rank <= 3;
    const palette = [null, ['#f9e59b', '#aa6b17'], ['#f5f5e8', '#78828b'], ['#f4c18d', '#9a4d31']];
    c.save();
    if (medal) {
      c.fillStyle = palette[rank][1];
      c.beginPath(); c.moveTo(x - 9, y + 6); c.lineTo(x - 3, y + 4);
      c.lineTo(x - 4, y + 19); c.lineTo(x - 10, y + 15); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x + 9, y + 6); c.lineTo(x + 3, y + 4);
      c.lineTo(x + 4, y + 19); c.lineTo(x + 10, y + 15); c.closePath(); c.fill();
      const gradient = c.createLinearGradient(x - 15, y - 15, x + 15, y + 15);
      gradient.addColorStop(0, palette[rank][0]); gradient.addColorStop(1, palette[rank][1]);
      c.fillStyle = gradient; c.strokeStyle = '#634528';
    } else {
      c.fillStyle = '#a78b65'; c.strokeStyle = '#634f38';
    }
    c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, medal ? 16 : 14, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = medal ? '#fff4d6' : '#4a3623';
    c.font = `bold 17px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(rank || '—', x, y + 1);
    c.restore();
  }

  drawRow(c, row, rank, y, w, xs) {
    const center = y + 23;
    c.fillStyle = row.isPlayer ? 'rgba(151,54,28,.25)' : 'rgba(67,45,28,.075)';
    c.fillRect(0, y, w, 46);
    c.strokeStyle = row.isPlayer ? 'rgba(145,55,31,.8)' : 'rgba(101,69,43,.42)';
    c.lineWidth = 1; c.beginPath(); c.moveTo(0, y + 45.5); c.lineTo(w, y + 45.5); c.stroke();
    const color = row.defeated ? '#816c55' : row.isPlayer ? RED : INK;
    this.drawRank(c, rank, 23, center, row.defeated);
    const frame = this.flagFrame(row);
    if (frame) E.drawFrame(frame, 45, center - 14, { sx: 40 / frame.w, sy: 28 / frame.h, noRef: true });
    else { c.fillStyle = this.factionColor(row); c.fillRect(45, center - 14, 40, 28); }
    c.fillStyle = color; c.font = `bold 19px ${SERIF}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const country = this.owner.game.stage.data.countries.find(item => item.id === row.id);
    let name = country?.name && country.name.length < 18 ? country.name : row.name || row.id;
    const nameMax = xs[0] - 128;
    while (name.length > 1 && c.measureText(name).width > nameMax) name = name.slice(0, -2) + '…';
    c.fillText(name, 96, center);
    const nameWidth = c.measureText(name).width;
    if (row.defeated) {
      c.strokeStyle = color; c.beginPath(); c.moveTo(96, center); c.lineTo(96 + nameWidth, center); c.stroke();
    }
    const swatchX = Math.min(103 + nameWidth, xs[0] - 27);
    c.fillStyle = this.factionColor(row); c.fillRect(swatchX, center - 8, 16, 16);
    c.strokeStyle = '#3f2a1b'; c.strokeRect(swatchX + .5, center - 7.5, 15, 15);
    c.font = 'bold 17px Consolas, monospace'; c.fillStyle = color; c.textAlign = 'right';
    for (let i = 0; i < COLUMNS.length; i++) {
      const value = this.value(row, i);
      const label = value == null ? '—' : String(value);
      c.fillText(label, xs[i], center);
      if (row.defeated) {
        const width = c.measureText(label).width;
        c.strokeStyle = color; c.beginPath(); c.moveTo(xs[i] - width, center); c.lineTo(xs[i], center); c.stroke();
      }
    }
  }

  draw(c, cx, cy, cw, ch, scale) {
    this.rect = { x: cx, y: cy, w: cw, h: ch, scale };
    const w = cw / scale, h = ch / scale, xs = this.columnXs(w);
    const rows = this.rows();
    this.clampScroll();
    c.save(); c.translate(cx, cy); c.scale(scale, scale);
    c.fillStyle = 'rgba(67,45,28,.13)'; c.fillRect(0, 0, w, 54);
    c.fillStyle = INK; c.font = `bold 18px ${SERIF}`; c.textBaseline = 'middle';
    c.textAlign = 'left'; c.fillText('排名', 3, 27); c.fillText('国旗 · 国家 · 关系', 96, 27);
    c.textAlign = 'right';
    for (let i = 0; i < COLUMNS.length; i++) {
      c.fillStyle = i === this.sortType ? RED : INK;
      c.fillText(COLUMNS[i].label + (i === this.sortType ? this.descending ? ' ↓' : ' ↑' : ''), xs[i], 27);
    }
    c.strokeStyle = '#806044'; c.beginPath(); c.moveTo(0, 54); c.lineTo(w, 54); c.stroke();
    c.save(); c.beginPath(); c.rect(0, 60, w, h - 60); c.clip();
    const first = Math.max(0, Math.floor(this.scroll / 46));
    const last = Math.min(rows.length, Math.ceil((this.scroll + h - 60) / 46) + 1);
    let activeRank = 0;
    for (let i = 0; i < first; i++) if (!rows[i].defeated) activeRank++;
    for (let i = first; i < last; i++) {
      if (!rows[i].defeated) activeRank++;
      this.drawRow(c, rows[i], rows[i].defeated ? 0 : activeRank, 60 + i * 46 - this.scroll, w, xs);
    }
    c.restore();
    const max = this.maxScroll();
    if (max > 0) {
      const track = h - 60, thumb = Math.max(30, track * track / (track + max));
      c.strokeStyle = '#86684b'; c.lineWidth = 3; c.beginPath(); c.moveTo(w - 4, 60); c.lineTo(w - 4, h); c.stroke();
      c.strokeStyle = RED; c.lineWidth = 5; c.beginPath();
      const top = 60 + (track - thumb) * this.scroll / max;
      c.moveTo(w - 4, top); c.lineTo(w - 4, top + thumb); c.stroke();
    }
    c.restore();
  }
}
