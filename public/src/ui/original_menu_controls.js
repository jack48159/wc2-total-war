// Original-style additions shared by the two pre-battle menus.
import { E } from '../core/index.js';
export function initFog(page) {
  page.fogOfWar = E.state.fogOfWar === true;
  page.fogBtns = [true, false].map(value => new E.Button({ label: value ? '战争迷雾：开' : '战争迷雾：关', onClick: () => { page.fogOfWar = value; } }));
}
export function drawFog(page, left, width) {
  // Below the list, above OK; borrow map space beside the narrow country sidebar.
  const right = Math.min(left + width, E.W - E.ox) - 18;
  const x = right - 330, y = E.H - E.oy - 172;
  E.label('战争迷雾：', x, y + 27, 26, { font: E.CJK_SERIF });
  E.label('/', x + 240, y + 27, 25, { align: 'center' });
  page.fogBtns.forEach((btn, i) => {
    Object.assign(btn, { x: x + 154 + i * 94, y, w: 80, h: 54 });
    E.layout.group(btn, 'ui/original_menu_controls/fog', () => {
      const f = E.fx(btn, false), selected = page.fogOfWar === (i === 0);
      E.drawFrameCentered(selected ? page.ui1.green_normal : page.ui1.blue_normal, btn.x + 40, btn.y + 27 + f.dy, { sx: 80 / 135, sy: 54 / 72, filter: f.filter });
      E.label(i === 0 ? '开' : '关', btn.x + 40, btn.y + 27 + f.dy, 25, { align: 'center', font: E.CJK_SERIF });
    });
  });
}
export function drawScroll(page) {
  const list = page.list;
  if (list.max <= 0) return;
  const h = Math.max(28, list.h * list.h / (list.count * list.itemH));
  const y = list.y + (list.h - h) * list.scroll / list.max;
  const c = E.ctx; c.save(); c.fillStyle = '#d8bc80';
  E.layout.canvas(c, 'ui/original_menu_controls/scroll').fillRect(list.x + list.w - 8, y, 3, h); c.restore();
}
