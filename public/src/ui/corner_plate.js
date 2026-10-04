// iOS 圆角屏的“四角坞”(Claude × Codex 定稿方案 D，见 scratch/ios_redesign/FINAL_SPEC.md)：
// - 用游戏原有的按钮板和图标，**等比**放大到约 72pt(不裁中间、不改朝向和光影)，贴死物理屏幕角；
// - 只把屏幕圆角外的那一块裁掉，并只沿这段弧补边，颜色从原板图的边框取样；
// - 按钮板和图标共用同一个锚点、同一个倍数，原图构图不变；图标只有在会被圆角切到时，才沿对角线往里挪最小的距离；
// - 热区 = 坞矩形(>= 44×44pt)。只在触屏(iOS)使用；桌面版不走这里。
import { E } from '../core/index.js';

export const DISPLAY_RADIUS_PT = 55;   // 屏幕圆角半径(pt)
export const DOCK_PT = 60;             // 四角坞高度(pt)(用户：右上暂停也太大，与下角统一 60)
export const DOCK_BOTTOM_PT = 60;      // 下面两个角(卡牌商店/结束回合/返回/确认)小一些(用户：太大)
export const ICON_INSET_PT = 6;        // 下面两个角的图标往屏幕内侧收一点(用户：卡牌图标越过了按钮板)
export const ICON_RATIO = 0.85;
export const ICON_FIT = 0.56;          // 贴角坞里图标(含外框)最长边占按钮短边的比例        // 图标相对原比例的缩放(用户：图标稍大，调小一点)

// 资源栏位置(触屏)：战斗 HUD 里可拖动并存本地；卡牌商城等其他画面用同一个位置。默认贴上边、让开左上圆弧一点
export function resourceBarPos() {
  try { const s = JSON.parse(localStorage.getItem('wc2_resbar_pos_v1') || 'null'); if (s && isFinite(s.x) && isFinite(s.y)) return { x: s.x, y: s.y }; } catch (e) {}
  return { x: 0, y: 0 };   // 默认贴死左上角(用户要求贴到最左边)
}

// 1pt = dpr / scale 个设计单位
export const pt = n => { const v = E.view; return v ? n * v.dpr / v.scale : n; };
export const displayRadius = () => pt(DISPLAY_RADIUS_PT);
export const plateSize = () => pt(DOCK_PT);

const boundsCache = new WeakMap();
function visibleBounds(board) {
  if (boundsCache.has(board)) return boundsCache.get(board);
  let bounds = { x: 0, y: 0, w: board.w, h: board.h };
  try {
    const canvas = document.createElement('canvas'); canvas.width = board.w; canvas.height = board.h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (board.cv) context.drawImage(board.cv, 0, 0);
    else context.drawImage(board.img, board.x, board.y, board.w, board.h, 0, 0, board.w, board.h);
    const pixels = context.getImageData(0, 0, board.w, board.h).data;
    let left = board.w, top = board.h, right = -1, bottom = -1;
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      if (pixels[(y * board.w + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right >= left) bounds = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    boundsCache.set(board, bounds);
  } catch {}
  return bounds;
}

// Anchor the visible plate, rather than the atlas padding, to the viewport corner.
export function cornerLayout(board, corner, scale) {
  const b = visibleBounds(board), w = b.w * scale, h = b.h * scale;
  const x0 = corner.includes('l') ? 0 : E.W - w;
  const y0 = corner.includes('t') ? 0 : E.H - h;
  return { k: scale, x0, y0, w, h,
    ax: x0 + (board.rx - b.x) * scale, ay: y0 + (board.ry - b.y) * scale };
}

// 按目标高度等比放大后的布局：{ k, x0, y0, w, h, ax, ay }(bbox 左上角 + 锚点)
// corner: 'tl'|'tr'|'bl'|'br' 贴死该物理角；at:{x,y} 指定 bbox 左上角(贴边但不贴角的元素)
export function dockLayout(board, corner, heightPt = null, at = null) {
  if (heightPt == null) heightPt = corner && corner.includes('b') ? DOCK_BOTTOM_PT : DOCK_PT;
  if (corner && !at) return cornerLayout(board, corner, pt(heightPt) / visibleBounds(board).h);
  const k = pt(heightPt) / board.h, w = board.w * k, h = board.h * k;
  const x0 = at ? at.x : corner.includes('l') ? 0 : E.W - w, y0 = at ? at.y : corner.includes('t') ? 0 : E.H - h;
  return { k, x0, y0, w, h, ax: x0 + board.rx * k, ay: y0 + board.ry * k };
}

// 屏幕圆角的几何：每个角一个圆(圆心离两条边各 R)。arc 从上/下边上的切点 a0 走到左/右边上的切点 a1，ccw 为方向
function cornerGeom(corner) {
  const R = displayRadius(), W = E.W, H = E.H, P = Math.PI;
  switch (corner) {
    case 'tl': return { R, cx: R, cy: R, sx: 0, sy: 0, a0: -P / 2, a1: -P, ccw: true };
    case 'tr': return { R, cx: W - R, cy: R, sx: W, sy: 0, a0: -P / 2, a1: 0, ccw: false };
    case 'br': return { R, cx: W - R, cy: H - R, sx: W, sy: H, a0: P / 2, a1: 0, ccw: true };
    default:   return { R, cx: R, cy: H - R, sx: 0, sy: H, a0: P / 2, a1: P, ccw: false };   // bl
  }
}
// 点是否落在屏幕圆角外(看不见)
function hidden(px, py, g) {
  const inSquare = (g.sx === 0 ? px < g.cx : px > g.cx) && (g.sy === 0 ? py < g.cy : py > g.cy);
  return inSquare && Math.hypot(px - g.cx, py - g.cy) > g.R;
}

// 从原板图边框取样：沿“内侧”(背离屏幕角的一侧)中间一行往里扫，最暗的当外线色、最亮的当内线色
const rimCache = new Map();
function rimColors(board, corner) {
  const key = (board.name || `${board.w}x${board.h}`) + corner;
  if (rimCache.has(key)) return rimCache.get(key);
  let dark = '#1c0e06', light = '#f4ecd4';
  try {
    const cv = document.createElement('canvas'); cv.width = board.w; cv.height = board.h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (board.cv) g.drawImage(board.cv, 0, 0); else g.drawImage(board.img, board.x, board.y, board.w, board.h, 0, 0, board.w, board.h);
    const row = Math.floor(board.h / 2), fromLeft = corner.includes('r'), n = Math.min(14, board.w >> 1);
    const px = g.getImageData(fromLeft ? 0 : board.w - n, row, n, 1).data;
    let lo = null, hi = null;
    for (let i = 0; i < n; i++) {
      const o = (fromLeft ? i : n - 1 - i) * 4; if (px[o + 3] < 200) continue;
      const lum = px[o] * .3 + px[o + 1] * .59 + px[o + 2] * .11, col = `rgb(${px[o]},${px[o + 1]},${px[o + 2]})`;
      if (!lo || lum < lo.l) lo = { l: lum, c: col };
      if (!hi || lum > hi.l) hi = { l: lum, c: col };
    }
    if (lo && lo.l < 90) dark = lo.c;
    if (hi && hi.l > 170) light = hi.c;
  } catch (e) {}
  const out = { dark, light }; rimCache.set(key, out); return out;
}

// 画一个四角坞/贴边坞。opts: { layout, heightPt, pressed, filter, icon, iconPress, drawIcon(ax,ay,k,filter), clip(默认贴角时裁) }
// 返回热区 { x, y, w, h }
export function drawDock(board, corner, opts = {}) {
  if (!board) return null;
  const L = opts.layout || dockLayout(board, corner, opts.heightPt), c = E.ctx;
  const dy = opts.pressed ? pt(1.5) : 0, filter = opts.filter;
  // arc:false = 不画屏幕圆弧裁切和弧线补边(让手机自己的物理圆角去遮)，但图标仍按可见区摆放
  // The physical display handles its own rounded corners. Never cut a circular
  // hole out of the plate: touch-capable Windows screens are rectangular too.
  const g = null, arc = false;
  c.save();
  if (arc) {   // 裁剪区 = 整个画面 减去 屏幕圆角外的那一小块(原图里伸出板外的部分，比如确认的对勾，照常画出)
    c.beginPath(); c.rect(0, 0, E.W, E.H);
    c.moveTo(g.sx, g.sy); c.lineTo(g.cx, g.sy); c.arc(g.cx, g.cy, g.R, g.a0, g.a1, g.ccw); c.lineTo(g.sx, g.sy); c.closePath();
    c.clip('evenodd');
  }
  if (opts.mirror) {   // 板图左右镜像(只镜像板，不镜像图标)
    c.save(); c.translate(L.x0 * 2 + L.w, 0); c.scale(-1, 1);
    E.drawFrame(board, L.ax, L.ay + dy, { scale: L.k, filter, noLayout: true });
    c.restore();
  } else E.drawFrame(board, L.ax, L.ay + dy, { scale: L.k, filter, noLayout: true });
  // 图标：贴角的坞按“可见区域”摆放——整个图标(含外框)缩放到按钮短边的 ICON_FIT 以内，
  // 中心放在按钮中心再往远离屏幕角的方向挪一点(避开被圆角裁掉的那一块)，保证不越出按钮板(用户：卡牌图标越过了按钮板)
  let ix = L.ax, iy = L.ay + dy;
  const icon = opts.pressed && opts.iconPress ? opts.iconPress : opts.icon;
  if (icon && corner) {
    const fit = Math.min(L.w, L.h) * ICON_FIT / Math.max(icon.w, icon.h), sh = Math.min(L.w, L.h) * 0.04;
    // 上面两个角：只水平避开圆角，不往下挪(红色暂停板下半部是浅色磨损区，往下挪图标会越出红色背景)
    const cx = L.x0 + L.w / 2 + (corner.includes('l') ? -sh : sh), cy = L.y0 + dy + L.h / 2 + (corner.includes('b') ? sh : -sh);
    E.drawFrame(icon, cx - icon.w * fit / 2, cy - icon.h * fit / 2, { scale: fit, filter, noRef: true, noLayout: true });
    ix = cx; iy = cy;
  } else if (icon) E.drawFrame(icon, ix, iy, { scale: L.k, filter, noLayout: true });
  if (opts.drawIcon) opts.drawIcon(ix, iy, L.k, filter);
  c.restore();
  // 只沿被裁的那段弧补边(深色外线 + 奶白内线，颜色取自原图边框)
  if (arc) {
    const col = rimColors(board, corner);
    c.save(); c.translate(0, dy);
    c.beginPath(); c.rect(L.x0, L.y0, L.w, L.h); c.clip();   // 板比圆弧窄时，补边不画到板外
    c.beginPath(); c.arc(g.cx, g.cy, g.R - pt(1.2), g.a0, g.a1, g.ccw); c.lineWidth = pt(2.4); c.strokeStyle = col.dark; c.stroke();
    c.beginPath(); c.arc(g.cx, g.cy, g.R - pt(3.4), g.a0, g.a1, g.ccw); c.lineWidth = pt(1.4); c.strokeStyle = col.light; c.stroke();
    c.restore();
  }
  return { x: L.x0, y: L.y0, w: L.w, h: L.h };
}
