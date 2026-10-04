// Stacked-army panel (original GUISelArmy): when the selected area of yours holds several armies, a board with slots
// stands at the right edge (choosearmy_board). Each slot shows one army (sprite + info block, GUIArmyItem ->
// CGameRes::RenderUIArmy); tapping a slot puts that army in front (MoveArmyToFront), so it is the one that moves / attacks.
// Layout follows the original: the board is split into equal slots based on area capacity, the army stands on the bottom edge of its slot.
import { E } from '../../../core/index.js';

const SCALE = 1.3, TOP = 105, VISIBLE_W = 164, BASE_ICON_SCALE = 0.95;

export class ArmyPanel {
  // actions: { front(areaId, armyId) }
  constructor(game, ui1, units, actions) {
    this.game = game;
    this.ui1 = ui1;
    this.units = units;
    this.actions = actions;
    this.pressed = -1;
  }

  area(sel) {
    const s = sel >= 0 && this.game.stage.st(sel);
    return s && s.armies.length > 1 && this.game.stage.humanCountries.has(s.country) ? s : null;
  }

  capacity(sel) {
    const s = sel != null && sel >= 0 ? this.area(sel) : null;
    if (!s) return 4;
    const maxCapacity = (this.game.stage.maxArmies ? this.game.stage.maxArmies(s) : s.maxArmies) || 4;
    return Math.max(maxCapacity, s.armies.length);
  }

  rect(sel) {
    const b = this.ui1.choosearmy_board, w = Math.round(b.w * SCALE), h = Math.round(b.h * SCALE);
    const cap = this.capacity(sel);
    return { x: Math.round(E.W - VISIBLE_W), y: TOP, w, h, cap, slotH: h / cap };
  }

  slotAt(p, sel) {
    const s = this.area(sel);
    if (!s) return -1;
    const r = this.rect(sel);
    if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return -1;
    const i = Math.floor((p.y - r.y) / r.slotH);
    return i < s.armies.length ? i : -2; // -2: on the board but on an empty slot
  }

  contains(p, sel) { return this.slotAt(p, sel) !== -1; }

  down(p, sel) { this.pressed = this.slotAt(p, sel); }

  up(p, sel) {
    const i = this.slotAt(p, sel), was = this.pressed;
    this.pressed = -1;
    const s = this.area(sel);
    if (s && i >= 0 && i === was) {
      const armies = this.orderedArmies(s);
      if (armies[i]) this.actions.front(sel, armies[i].id);
    }
  }

  resetOrder(areaId) {
    // Kept for interface compatibility
  }

  orderedArmies(area) {
    // The standby box directly follows the area's stack order (index 0 is front/top army, matching the map stack)
    return area ? area.armies : [];
  }

  draw(sel) {
    const s = this.area(sel);
    if (!s) return;
    const b = this.ui1.choosearmy_board, r = this.rect(sel), st = this.game.stage, cinfo = st.countries.get(s.country);
    const transparency = E.clamp(E.state.selectionTransparency ?? E.state.selectionBlur ?? 0.5, 0, 1);
    E.drawFrame(b, r.x + b.rx * SCALE, r.y + b.ry * SCALE, { scale: SCALE, alpha: 1 - transparency });
    const cx = Math.round(r.x + r.w / 2 - 6);
    const k = 4 / r.cap;
    const iconScale = BASE_ICON_SCALE * k;
    this.orderedArmies(s).forEach((ar, i) => {
      const bottom = Math.round(r.y + (i + 1) * r.slotH - 6 * k), top = Math.round(r.y + i * r.slotH);
      if (i === this.pressed) {
        const c = E.ctx;
        c.fillStyle = 'rgba(255,240,200,0.25)';
        E.layout.canvas(c, 'scenes/battle/ui/army_panel.js:83').fillRect(r.x + 14, top + 6, r.w - 30, r.slotH - 8);
      }
      this.units.drawArmyIcon(ar, cinfo.flag, cx, bottom, iconScale, s.id);
    });
  }
}
