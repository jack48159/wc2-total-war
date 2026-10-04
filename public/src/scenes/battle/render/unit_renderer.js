import { groupForArmy } from '../../../game/army_groups.js';
// Draws the army units and the area buildings / flags, and answers "which unit is under the finger".
// Every sprite sits at its area anchor with the hotspot baked into the atlas, exactly like the original:
//   pts[0] army position, pts[1] construction + flag position, pts[2] installation position.
// Only the first (front) army of an area is shown.
import { E } from '../../../core/index.js';
import { UNIT_PX } from './camera.js';
import { World } from '../../../game/world.js';
import { EV } from '../../../game/events.js';
import { facesLeft } from '../../../game/direction.js';
import { screenFacing, selectFacingFrame } from './unit_facing.js';
import { relationColor, EXTRA_BASE_COLORS, COLOR_FADE_SEC, BASE_COLOR_TABLE } from '../../../game/relation_color.js';

const SPRITE = { infantry: 'soldier', panzer: 'panzer', artillery: 'cannon', tank: 'tank', heavytank: 'heavytank', eliteinfantry: 'eliteinfantry', rocket: 'rocketlauncher',
  cruiser: 'cruiser', destroyer: 'destroyer', battleship: 'battleship', aircraftcarrier: 'aircraftcarrier' };
const NAVY_SPRITES = new Set(['cruiser', 'destroyer', 'battleship', 'aircraftcarrier']);   // real warships: never shown as "carried"
const INSTALLATION = { entrenchment: 'buildmark_wire', fort: 'buildmark_fortress', radar: 'buildmark_radar', antiaircraft: 'buildmark_aagun' };
// The country flag is shown only on strategically significant areas, not every tile: a level-4 city, a level-3 industry, a capital, or a high-tax
// "important location" (the original's circle-in-circle resource point). City / industry level combines the terrain's inherent grade (areaType:
// 1 capital, 3 large city, 4 normal city) with what has been built; capitals and large cities also clear the tax bar, so they keep their flag.
// Alpha of an atlas image, read once (a frame's opaque pixels are the same whatever tint it is drawn with).
const alphaOf = img => {
  if (img._alpha) return img._alpha;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return (img._alpha = { w, a });
};
// Is screen point (px, py) on an opaque pixel of a drawn frame part { f, x0, y0, S, cx, mirror }? (mirrored parts are flipped about cx)
const opaqueAt = (q, px, py) => {
  if (q.rect) return px >= q.x0 && px <= q.x0 + q.w && py >= q.y0 && py <= q.y0 + q.h;
  const f = q.f, x = q.mirror ? 2 * q.cx - px : px, u = Math.floor((x - q.x0) / q.S), v = Math.floor((py - q.y0) / q.S);
  if (u < 0 || v < 0 || u >= f.w || v >= f.h) return false;
  const A = alphaOf(f.img); return A.a[(f.y + v) * A.w + f.x + u] > 40;
};
const flagWorthy = (a, s) => {
  const cityLevel = Math.max({ 1: 3, 3: 2, 4: 1 }[a.areaType] || 0, s.construction === 'city' ? s.level : 0);
  const indLevel = Math.max({ 1: 2, 3: 1 }[a.areaType] || 0, s.construction === 'industry' ? s.level : 0);
  // "important location" = the original's circle-in-circle resource point: PLAIN terrain (areaType 0, no city / industry built) whose tax is
  // nonetheless high. City-type terrain (large / normal city, capital, port) is excluded here so a small city's naturally high tax never counts.
  const importantPoint = a.areaType === 0 && s.construction !== 'city' && s.construction !== 'industry' && (a.tax || 0) >= 5;
  return cityLevel >= 4 || indLevel >= 3 || a.areaType === 1 || importantPoint;
};
// Layout measured from an original-game screenshot (source px, relative to the base disc anchor):
// the soldier stands 36 px above the anchor; the info bar is centred on the disc, 44 px above it.
// Walking, as in the original CArea::SetMoveInArmy: the unit starts at the origin anchor (offset = origin - destination) and
// its offset shrinks with speed = -4 x offset, i.e. it arrives after 0.25 s whatever the distance, at constant speed.
// Sprites in the atlas face RIGHT; a unit whose `facing` is -1 (original `direction`, set toward the destination) is mirrored.
const SOLID_3D = false;              // true: German infantry as a 3D model (needs layer3d's figure pass, see remake/backup/experiments_tilt_map/); the original 2D icons are used
const MOVE_TIME = 0.25;
const FRONT_SWITCH_SPEED = 12;
const FRONT_SWITCH_END_ANGLE = 5.9690259669192;
const DEPLOY_TIME = 60 / 320;
const SPR_DY = -36, BAR_DX = -54, BAR_DY = -44, UNIT_SCALE = 1.25;   // units are drawn 25% larger than the other map sprites
const FLAG_ASPECT = 100 / 68;
const flagLayout = (S, hb) => {
  const barH = (hb?.h || 33) * S;
  const flagH = E.clamp(barH * 0.78, 12, 24);
  return { flagH, flagW: flagH * FLAG_ASPECT, gap: Math.max(2, 3 * S) };
};
const GLOW_PAD = 16, GLOW_BLUR = 6;                                  // the baked "can still move" glow: padding around the sprite and its blur radius (sprite px)
const clamp255 = v => v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
const rgbHue = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h / 6;
};
const rgbSat = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return 0;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
};
const hlsToRgb = (h, l, s) => {
  if (s <= 0) { const v = clamp255(l); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [clamp255(hue2rgb(p, q, h + 1 / 3)), clamp255(hue2rgb(p, q, h)), clamp255(hue2rgb(p, q, h - 1 / 3))];
};
const mul = (A, B) => {                                          // 3x4 colour matrices (rows r,g,b: [m0 m1 m2 offset]): A after B
  const o = new Array(12);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + (c === 3 ? A[r * 4 + 3] : 0);
  return o;
};
// the CSS filter list ("sepia(.4) saturate(.8) brightness(.9) ...") as one colour matrix
function filterMatrix(css) {
  let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  for (const [, fn, arg] of css.matchAll(/([a-z-]+)\(([-\d.]+)(?:deg)?\)/g)) {
    const v = +arg; let F;
    if (fn === 'brightness') F = [v, 0, 0, 0, 0, v, 0, 0, 0, 0, v, 0];
    else if (fn === 'contrast') F = [v, 0, 0, 0.5 - 0.5 * v, 0, v, 0, 0.5 - 0.5 * v, 0, 0, v, 0.5 - 0.5 * v];
    else if (fn === 'saturate') F = [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0];
    else if (fn === 'sepia') { const k = 1 - Math.min(1, v); F = [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0]; }
    else if (fn === 'hue-rotate') { const a = v * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      F = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0]; }
    else continue;
    M = mul(F, M);
  }
  return M;
}
const fatigueLevel = ar => {
  if (!ar.maxHp) return 0;
  const lostHealth = 1 - E.clamp(ar.hp / ar.maxHp, 0, 1);
  return E.clamp(lostHealth * E.clamp(Math.round(E.state.fatigueMultiplier ?? 1), 1, 5), 0, 1);
};
const unitFilter = (ar, fatigue = fatigueLevel(ar)) => {
  fatigue = Math.round(fatigue * 10) / 10;                    // 10 tint levels: the filtered sprites are cached per level (see filtered())
  const effects = [];
  if (ar.encircled) effects.push('brightness(0.48)', 'saturate(0.72)');
  if (fatigue > 0) effects.push(`sepia(${0.8 * fatigue})`, `saturate(${1 - 0.4 * fatigue})`, 'hue-rotate(350deg)', `brightness(${1 - 0.16 * fatigue})`, `contrast(${1 - 0.12 * fatigue})`);
  return effects.join(' ') || 'none';
};

const GROUP_GLOW_COLORS = [
  '#2563eb', // 0: 亮宝蓝 (Electric Royal Blue)
  '#ef4444', // 1: 烈焰红 (Vivid Crimson Red)
  '#10b981', // 2: 翡翠绿 (Vibrant Emerald Green)
  '#f59e0b', // 3: 琥珀金 (Amber Gold)
  '#8b5cf6', // 4: 鲜紫罗兰 (Electric Violet)
  '#ec4899', // 5: 亮粉 (Hot Pink)
  '#06b6d4', // 6: 亮青 (Cyan Aqua)
  '#84cc16'  // 7: 亮青柠绿 (Bright Lime)
];
export function getGroupColor(groupOrId, game = null, country = null) {
  if (!groupOrId) return null;
  const grp = typeof groupOrId === 'object' ? groupOrId : (game?.armyGroups || []).find(g => g.id === groupOrId);
  if (grp?.color) return grp.color;
  const id = typeof groupOrId === 'string' ? groupOrId : grp?.id;
  if (!id) return null;
  const c = country || grp?.country;
  if (game?.armyGroups && c) {
    const list = game.armyGroups.filter(g => g.country === c);
    const idx = list.findIndex(g => g.id === id);
    if (idx >= 0) return GROUP_GLOW_COLORS[idx % GROUP_GLOW_COLORS.length];
  }
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return GROUP_GLOW_COLORS[Math.abs(hash) % GROUP_GLOW_COLORS.length];
}
const drawFatiguedSprite = (ar, controlled, draw) => { draw(unitFilter(ar, fatigueLevel(ar))); };

const drawFatigueWear = (ar, frame, x, y, scale) => {
  const fatigue = fatigueLevel(ar);
  if (!frame || fatigue <= 0) return;
  const c = E.ctx, l = x - frame.rx * scale, t = y - frame.ry * scale, w = frame.w * scale, h = frame.h * scale;
  const chips = [[0.10, 0.04, 0.08, 0.04], [0.43, 0.01, 0.11, 0.05], [0.79, 0.07, 0.08, 0.04], [0.02, 0.34, 0.05, 0.11], [0.94, 0.57, 0.06, 0.12], [0.22, 0.93, 0.11, 0.05], [0.67, 0.90, 0.09, 0.06]];
  c.save(); c.globalAlpha = 0.18 + 0.38 * fatigue; c.fillStyle = '#c8a76c';
  for (const [px, py, pw, ph] of chips) {
    const cx = l + px * w, cy = t + py * h, cw = pw * w, ch = ph * h;
    c.beginPath(); c.moveTo(cx, cy + ch); c.lineTo(cx + cw * 0.42, cy); c.lineTo(cx + cw, cy + ch * 0.55); c.lineTo(cx + cw * 0.55, cy + ch); c.closePath(); c.fill();
  }
  c.globalAlpha *= 0.7; c.fillStyle = '#80623b';
  c.fillRect(l + 0.08 * w, t + 0.18 * h, Math.max(1, 1.5 * scale), 4 * scale);
  c.fillRect(l + 0.84 * w, t + 0.68 * h, Math.max(1, 1.2 * scale), 5 * scale);
  c.restore();
};

export class UnitRenderer {
  constructor(game, camera, army) {
    this.game = game; this.stage = game.stage; this.cam = camera; this.army = army; this.boxes = []; this.fcache = new Map(); this.gcache = new Map();
    this.moving = new Map();                                          // armyId -> walk animation in progress
    this.frontSwitches = new Map();                                   // areaId -> original-style armyMovingToFront arc
    this.deploying = new Map();                                       // armyId -> original CArea::draftingArmyOffset animation
    this.colorState = new Map();                                      // country -> { color, prev, t0 }
    this.armyFlagCache = new Map();                                   // glow colour + map digit colour + group number + dimensions -> small flag canvas
    this.groupDisplayCache = new Map();                               // baked glow + territory backdrop -> opaque flag colour
    this.colorClock = 0;
    this.wcache = new Map();
    this.loadExtraBases();
    this.unitSpriteOverrides = new Map();
    this.unitSpritesReady = this.loadUnitSprites();
    this.flags = null;
    E.atlas('flag_hd').then(f => { this.flags = f; }).catch(() => {});
    game.on(EV.UNIT_MOVED, ev => this.startMove(ev));
    game.on(EV.UNIT_DEPLOYED, ev => this.startDeploy(ev));
    game.on(EV.ARMY_FRONTED, ev => this.frontSwitches.set(ev.area, { armyId: ev.armyId, previousArmyId: ev.previousArmyId, angle: 0 }));
  }

  // Seconds one step takes: the original 0.25 s divided by the speed set in Options > 游戏.
  get moveTime() { return MOVE_TIME / (E.state.moveSpeed || 1); }

  // The rules move the army instantly; the picture catches up: it walks from the old anchor to the new one.
  // ev = { from, to, armyId, country }
  startMove(ev) {
    const st = this.stage, a = World.areas[ev.from].pts[0], b = World.areas[ev.to].pts[0], area = st.st(ev.to);
    const army = area.armies.find(x => x.id === ev.armyId);
    if (!army) return;
    this.moving.set(ev.armyId, { a, b, t: 0, dur: this.moveTime, army, area: ev.to, country: ev.country });   // the mover's own country: the area itself may still show its old owner (it is captured right after the event)
  }
  startDeploy(ev) {
    const area = this.stage.st(ev.area), army = area?.armies.find(unit => unit.id === ev.armyId);
    if (army) this.deploying.set(ev.armyId, { area: ev.area, army, t: 0, dur: DEPLOY_TIME });
  }
  update(dt) {
    this.colorClock += dt;
    for (const [id, m] of this.moving) { m.t += dt; if (m.t >= m.dur) this.moving.delete(id); }
    for (const [id, m] of this.deploying) { m.t += dt; if (m.t >= m.dur) this.deploying.delete(id); }
    for (const [areaId, motion] of this.frontSwitches) {
      motion.angle += dt * FRONT_SWITCH_SPEED;
      if (motion.angle >= FRONT_SWITCH_END_ANGLE) this.frontSwitches.delete(areaId);
    }
  }

  // Merge generated teal/amber frames into the army atlas lookup (A['unitbase_teal_2'] etc.).
  // Sync recolor of the already-loaded gray frames covers the first paint; PNGs replace them when they arrive.
  loadExtraBases() {
    const A = this.army;
    for (const color of EXTRA_BASE_COLORS) {
      const hex = BASE_COLOR_TABLE[color].hex;
      for (let n = 1; n <= 4; n++) {
        const src = A[`unitbase_gray_${n}`];
        if (src && !A[`unitbase_${color}_${n}`]) A[`unitbase_${color}_${n}`] = this.recolorFrame(src, hex, `unitbase_${color}_${n}`);
      }
      const pin = A.mark_carriers_gray;
      if (pin && !A[`mark_carriers_${color}`]) A[`mark_carriers_${color}`] = this.recolorFrame(pin, hex, `mark_carriers_${color}`);
    }
    E.json('unitbase_extra/manifest.json').then(man => {
      for (const f of man.frames || []) {
        E.image('unitbase_extra/' + f.file).then(img => {
          A[f.name] = { img, x: 0, y: 0, w: img.width, h: img.height, rx: f.rx, ry: f.ry, name: f.name, atlas: 'unitbase_extra' };
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  // Axis1-only PNG overrides; other stages always keep their original atlas.
  async loadUnitSprites() {
    if (this.game.name !== 'battle_axis1') return;
    if (new URLSearchParams(location.search).get('unitArt') !== 'hd') return;   // user: unit models back to the original art (HD pack only on ?unitArt=hd)
    try {
      const man = await E.json('units_hd/manifest.json');
      await Promise.all((man.frames || []).map(async f => {
        if (!/^[a-z]+_de(?:_(?:E|NE|N|SE|S))?$/.test(f.name)) return;
        if (!Number.isFinite(f.rx) || !Number.isFinite(f.ry)) return;
        try {
          const img = await E.image('units_hd/' + f.file);
          if (img.width !== f.w || img.height !== f.h) return;
          this.unitSpriteOverrides.set(f.name, { img, x: 0, y: 0, w: f.w, h: f.h, rx: f.rx, ry: f.ry, name: f.name, atlas: 'units_hd' });
        } catch (_) { /* An unfinished/missing candidate must not hide a unit. */ }
      }));
    } catch (_) { /* The original atlas remains usable without the optional pack. */ }
  }

  recolorFrame(f, hex, name) {
    const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const im = g.getImageData(0, 0, f.w, f.h), d = im.data;
    const tr = parseInt(hex.slice(1, 3), 16) / 255, tg = parseInt(hex.slice(3, 5), 16) / 255, tb = parseInt(hex.slice(5, 7), 16) / 255;
    const th = rgbHue(tr, tg, tb), ts = rgbSat(tr, tg, tb);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = (Math.max(r, gg, b) + Math.min(r, gg, b)) / 2;
      const sat = ts * Math.max(0.22, Math.min(1, 1 - Math.abs(l - 0.42) * 1.35));
      const [nr, ng, nb] = hlsToRgb(th, l, sat);
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
    }
    g.putImageData(im, 0, 0);
    return { img: cv, x: 0, y: 0, w: f.w, h: f.h, rx: f.rx, ry: f.ry, name, atlas: 'unitbase_extra' };
  }

  colorFade(country, color) {
    let rec = this.colorState.get(country);
    if (!rec) {
      rec = { color, prev: color, t0: -99 };
      this.colorState.set(country, rec);
    } else if (rec.color !== color) {
      rec.prev = rec.color;
      rec.color = color;
      rec.t0 = this.colorClock;
    }
    const k = rec.prev === rec.color ? 1 : E.clamp((this.colorClock - rec.t0) / COLOR_FADE_SEC, 0, 1);
    return { color: rec.color, prev: rec.prev, k, flash: k < 1 ? Math.sin(k * Math.PI) : 0 };
  }

  whiteSilhouette(f) {
    const key = (f.atlas || '') + '/' + f.name, hit = this.wcache.get(key); if (hit) return hit;
    const P = 6, w = f.w + 2 * P, h = f.h + 2 * P;
    const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
    const sg = sil.getContext('2d');
    sg.drawImage(f.img, f.x, f.y, f.w, f.h, P, P, f.w, f.h);
    sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, w, h);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.filter = 'blur(2.5px)'; g.drawImage(sil, 0, 0);
    const fr = { img: cv, x: 0, y: 0, w, h, rx: f.rx + P, ry: f.ry + P, atlas: f.atlas, name: f.name + '|white' };
    this.wcache.set(key, fr); return fr;
  }

  // A sprite with a CSS-style filter (fatigue tint, encircled darkening) drawn through ctx.filter every frame is very slow in a canvas (each such
  // draw stalls the GPU pipeline), and after a fight most units are tinted. So each (sprite, filter) is rendered once into a small canvas.
  filtered(f, filter) {
    if (!filter || filter === 'none') return f;
    const key = f.atlas + '/' + f.name + '|' + filter, hit = this.fcache.get(key); if (hit) return hit;
    const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h;
    const g = cv.getContext('2d', { willReadFrequently: true });          // a small CPU canvas: reading its pixels back is free
    g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    // The tint is applied as a colour matrix computed here (the same maths as the CSS filters sepia / saturate / hue-rotate / brightness /
    // contrast, in the same order). The browser's own filter chain took ~200 ms per new sprite on an integrated GPU, and after a fight many
    // units enter a new tint level at once.
    const M = filterMatrix(filter), im = g.getImageData(0, 0, f.w, f.h), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      d[i] = clamp255(M[0] * r + M[1] * gg + M[2] * b + M[3]); d[i + 1] = clamp255(M[4] * r + M[5] * gg + M[6] * b + M[7]); d[i + 2] = clamp255(M[8] * r + M[9] * gg + M[10] * b + M[11]);
    }
    g.putImageData(im, 0, 0);
    // the result goes to an ordinary (GPU) canvas: drawing a CPU-backed canvas re-uploads it to the GPU on every draw, for every tinted unit, every frame
    const out = document.createElement('canvas'); out.width = f.w; out.height = f.h; out.getContext('2d').drawImage(cv, 0, 0);
    const fr = Object.assign({}, f, { img: out, x: 0, y: 0 });
    if (this.fcache.size > 500) this.fcache.clear();
    this.fcache.set(key, fr); return fr;
  }

  // The "this unit can still move" glow, baked once per sprite instead of ctx.shadowBlur every frame (a per-frame gaussian blur of every
  // active unit was stalling the GPU - dozens of them each frame after a battle). Returns a frame-like object aligned to the sprite (same ref
  // point, padded by GLOW_PAD) so it draws with the ordinary drawFrame + flip path; the caller varies its strength through globalAlpha.
  glowSprite(f, color = 'rgb(70,175,255)') {
    const key = f.atlas + '/' + f.name + '|' + color, hit = this.gcache.get(key); if (hit) return hit;
    const P = GLOW_PAD, w = f.w + 2 * P, h = f.h + 2 * P;
    const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
    const sg = sil.getContext('2d');
    sg.drawImage(f.img, f.x, f.y, f.w, f.h, P, P, f.w, f.h);
    sg.globalCompositeOperation = 'source-in'; sg.fillStyle = color; sg.fillRect(0, 0, w, h);   // the sprite shape, filled target color

    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d'); g.filter = `blur(${GLOW_BLUR}px)`; g.drawImage(sil, 0, 0);              // blurred once, here, not per frame
    const fr = { img: out, x: 0, y: 0, w, h, rx: f.rx + P, ry: f.ry + P, atlas: f.atlas, name: f.name + '|glow|' + color };
    this.gcache.set(key, fr); return fr;
  }

  // The halo is blurred, then added with 'lighter' over the ground. Sample its strongest visible edge
  // over the country's map colour to give a solid flag the same representative on-screen colour.
  getArmyGroupDisplayColor(group, country, selected = false, backdrop = null) {
    const glowColor = selected ? '#ffd35a' : (group?.color || getGroupColor(group, this.game, country));
    if (!glowColor || !backdrop) return { glowColor, flagColor: glowColor };
    const intensity = selected ? 1 : (E.state.groupGlowIntensity ?? 0.85);
    const key = `${glowColor}|${backdrop.join(',')}|${intensity}`;
    this.groupDisplayCache ||= new Map();
    const hit = this.groupDisplayCache.get(key); if (hit) return hit;
    const sprite = this.army.soldier_others;
    if (!sprite) return { glowColor, flagColor: glowColor };
    this.gcache ||= new Map();
    const glow = this.glowSprite(sprite, glowColor);
    if (!this._glowEdge) {
      const source = document.createElement('canvas'); source.width = glow.w; source.height = glow.h;
      source.getContext('2d').drawImage(sprite.img, sprite.x, sprite.y, sprite.w, sprite.h, GLOW_PAD, GLOW_PAD, sprite.w, sprite.h);
      const original = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, glow.w, glow.h).data;
      const blurred = glow.img.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, glow.w, glow.h).data;
      let best = 0, index = 0;
      for (let i = 0; i < blurred.length; i += 4) if (original[i + 3] < 16 && blurred[i + 3] > best) { best = blurred[i + 3]; index = i / 4; }
      this._glowEdge = [index % glow.w, Math.floor(index / glow.w)];
    }
    this._glowProbe ||= document.createElement('canvas');
    const probe = this._glowProbe; probe.width = probe.height = 1;
    const c = probe.getContext('2d', { willReadFrequently: true });
    c.fillStyle = `rgb(${backdrop[0]},${backdrop[1]},${backdrop[2]})`; c.fillRect(0, 0, 1, 1);
    c.globalCompositeOperation = 'lighter';
    let remaining = intensity;
    while (remaining > 0.001) {
      c.globalAlpha = Math.min(1, remaining);
      c.drawImage(glow.img, this._glowEdge[0], this._glowEdge[1], 1, 1, 0, 0, 1, 1);
      remaining -= 1;
    }
    const flagColor = [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const result = { glowColor, flagColor };
    if (this.groupDisplayCache.size > 512) this.groupDisplayCache.clear();
    this.groupDisplayCache.set(key, result);
    return result;
  }

  facingSprite(type, cc, areaId = null, facing = null) {
    const A = this.army, base = SPRITE[type] || 'soldier';
    const country = cc === 'de1' || cc === 'de2' ? 'de' : cc === 'tw2' ? 'tw' : cc;
    const original = A[`${base}_${cc}`] || A[`${base}_${country}`] || A[`${base}_others`];
    const direction = areaId == null ? 'E' : screenFacing(World.areas, this.cam, areaId, facing);
    return selectFacingFrame(this.unitSpriteOverrides, base, country, direction, original,
      facesLeft(areaId, facing), this.game.name === 'battle_axis1');
  }

  spriteFor(type, cc) { return this.facingSprite(type, cc).frame; }

  draw(visible) {
    // Replay flags bypass buildings, strategic flagpoles, bases and animated unit copies.
    if (this.replayStyle === 1 || this.replayStyle === 3) { this.drawReplayFlags(visible); return; }
    if (this.replayStyle === 2) { this.boxes = []; return; }
    const Sat = (x, y) => this.cam.scaleAt(x, y) / UNIT_PX * 0.78;      // sprite scale at a map point: uniform when seen from above, perspective in the tilt view
    const A = this.army, st = this.stage, armies = [], under = [];
    const visibleIds = new Set(visible.map(area => area.id));
    this.boxes = []; this.infoQueue = [];
    if (this.l3d) this.l3d.begin();
    for (const a of visible) {
      const s = st.st(a.id); if (!s) continue;
      const cinfo = st.countries.get(s.country); if (!cinfo) continue;
      const [p1, p2, p3] = a.pts, S = Sat(p1[0], p1[1]), s1 = this.cam.toScreen(p1[0], p1[1]), s2 = this.cam.toScreen(p2[0], p2[1]), s3 = this.cam.toScreen(p3[0], p3[1]);
      const mg = 260 * S, out = q => q.x < -mg || q.x > E.W + mg || q.y < -mg * 2 || q.y > E.H + mg * 2;
      if (out(s1) && out(s2) && out(s3)) continue;                     // nothing of this area can be on screen
      let bm = null;
      if (s.construction === 'city') bm = A['buildmark_city_' + E.clamp(s.level, 1, 4)];
      else if (s.construction === 'industry') bm = A['buildmark_factory_' + E.clamp(s.level, 1, 3)];
      else if (s.construction === 'airport') bm = A.buildmark_airport;
      // port is TERRAIN (areaType 2 - matches ~48 areas in the data), not a buildable `construction` value like city/industry: original
      // CScene checks the area's own type (== 2), not what's built on it, and draws the port icon in ADDITION to any city/industry buildmark.
      const port = a.areaType === 2 ? A.buildmark_port : null;
      const inst = INSTALLATION[s.installation];
      under.push(() => { if (bm) E.drawFrame(bm, s2.x, s2.y, { scale: S }); if (port) E.drawFrame(port, s2.x, s2.y, { scale: S }); if (inst) E.drawFrame(A[inst], s3.x, s3.y, { scale: S }); });
      const here = s.armies.filter(x => !this.moving.has(x.id) && !this.deploying.has(x.id)), army = here[0];   // walking/deploying armies are drawn separately
      // a sea tile shows a flag only where a unit actually sits (an empty stretch of ocean under some country's naval claim doesn't need one);
      // a unit AT sea always gets one regardless of the area's own significance (only 4 relative-to-player base colours exist, otherwise ships
      // of different, equally "red" nations are impossible to tell apart), same as a land area significant enough on its own (flagWorthy)
      const atSea = World.areas[a.id]?.f === 1;
      const fl = (flagWorthy(a, s) || (atSea && army)) ? A['flag_' + cinfo.flag] : null;
      const flag = () => { if (fl) E.drawFrame(fl, s2.x, s2.y, { scale: S }); };
      const behind = p2[1] <= p1[1];                                    // flag is drawn before the army when its anchor is not below it
      armies.push({ y: p1[1], fn: () => {
        if (behind) flag();
        if (army) {
          const motion = this.frontSwitches.get(a.id);
          if (motion && motion.armyId === army.id) {
            const angle = motion.angle;
            const shift = { x: (1 - Math.cos(angle)) * 12 * S, y: -Math.sin(angle) * (angle <= Math.PI ? 12 : 24) * S };
            const stationaryArmy = here.find(unit => unit.id === motion.previousArmyId);
            if (stationaryArmy) this.drawUnit(stationaryArmy, cinfo.flag, s1, S, s.country, this.isActiveCountry(s.country), Math.max(1, here.length - 1), a.id);
            this.drawUnit(army, cinfo.flag, s1, S, s.country, this.isActiveCountry(s.country), 1, a.id, 0, shift);
          } else {
            this.drawUnit(army, cinfo.flag, s1, S, s.country, this.isActiveCountry(s.country), here.length, a.id);
          }
        }
        if (!behind) flag();
      } });
    }
    under.forEach(f => f());
    for (const m of this.moving.values()) {                             // the walkers, y-sorted with everybody else
      if (!visibleIds.has(m.area)) continue;
      const k = Math.min(1, m.t / m.dur), e = k, x = m.a[0] + (m.b[0] - m.a[0]) * e, y = m.a[1] + (m.b[1] - m.a[1]) * e, cinfo = st.countries.get(m.country);
      if (cinfo) armies.push({ y, fn: () => this.drawUnit(m.army, cinfo.flag, this.cam.toScreen(x, y), Sat(x, y), m.country, this.isActiveCountry(m.country), 1, m.area) });
    }
    for (const m of this.deploying.values()) {
      if (!visibleIds.has(m.area)) continue;
      const area = World.areas[m.area], cinfo = st.countries.get(m.army.country), p = area && this.cam.toScreen(area.pts[0][0], area.pts[0][1]);
      if (cinfo && p) armies.push({ y: area.pts[0][1], fn: () => {
        const k = E.clamp(m.t / m.dur, 0, 1);
        this.drawUnit(m.army, cinfo.flag, p, Sat(area.pts[0][0], area.pts[0][1]), m.army.country, this.isActiveCountry(m.army.country), 1, m.area, 60 * (1 - k));
      } });
    }
    armies.sort((a, b) => a.y - b.y).forEach(d => d.fn());
    if (this.l3d) this.l3d.render(E.ctx);                               // 3D soldiers (layer3d.js): after every base / 2D sprite ...
    this.infoQueue.forEach(f => f());                                   // ... and before the info blocks, so hp / level / tactic marks stay on top
    this.infoQueue = null;
  }

  armyFlag(background, numberColor, label, flag) {
    const fill = background || '#d9dde2';
    const digit = numberColor?.slice(0, 3) || [255, 255, 255];
    const key = `${fill}|${digit.join(',')}|${label}|${flag.w}x${flag.h}`;
    let frame = this.armyFlagCache.get(key);
    if (frame) return frame;
    const cv = document.createElement('canvas'); cv.width = flag.w; cv.height = flag.h;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = fill;
    c.fillRect(0, 0, cv.width, cv.height);
    const rgb = [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
    c.strokeStyle = `rgb(${rgb.map(v => Math.round(v * .72)).join(',')})`;
    c.lineWidth = 1;
    c.strokeRect(.5, .5, cv.width - 1, cv.height - 1);
    if (label) {
      c.font = `bold ${Math.floor(cv.height * .72)}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const maxWidth = cv.width * .78;
      const luminance = color => {
        const light = color.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
        return .2126 * light[0] + .7152 * light[1] + .0722 * light[2];
      };
      const groundLight = luminance(rgb), digitLight = luminance(digit);
      const contrast = (Math.max(groundLight, digitLight) + .05) / (Math.min(groundLight, digitLight) + .05);
      if (contrast < 3) {
        c.lineWidth = Math.max(1, cv.height * .025);
        c.lineJoin = 'round'; c.strokeStyle = digitLight > .179 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.65)';
        c.strokeText(label, cv.width / 2, cv.height / 2, maxWidth);
      }
      c.fillStyle = `rgb(${digit.join(',')})`;
      c.fillText(label, cv.width / 2, cv.height / 2, maxWidth);
    }
    frame = { img: cv, x: 0, y: 0, w: cv.width, h: cv.height, name: key, atlas: 'army_flag' };
    if (this.armyFlagCache.size > 512) this.armyFlagCache.clear();
    this.armyFlagCache.set(key, frame);
    return frame;
  }

  drawReplayFlags(visible) {
    this.boxes = []; this.infoQueue = null;
    if (this.l3d) this.l3d.begin();
    const c = E.ctx;
    const militaryFlags = this.replayStyle === 3;
    const groupNumbers = new Map(), countryCounts = new Map();
    for (const group of this.game.armyGroups) {
      const number = (countryCounts.get(group.country) || 0) + 1;
      countryCounts.set(group.country, number);
      for (const id of group.unitIds) groupNumbers.set(`${group.country}:${id}`, { label: String(number), group });
    }
    for (const a of visible) {
      const state = this.stage.st(a.id);
      if (!state?.armies.length) continue;
      // Only the rectangular flag atlas is allowed here: army-atlas flags include poles.
      const flagCountry = state.armies[0].country || state.country;
      const country = this.stage.countries.get(flagCountry);
      const flag = this.flagFrame(country?.flag || country?.id || flagCountry);
      if (!flag) continue;
      const [wx, wy] = a.pts[0], center = this.cam.toScreen(wx, wy), zoom = this.cam.scaleAt(wx, wy);
      // Use the same zoom-based size for every army, even when icons spill beyond a small tile.
      const baseWidth = this.army.unitbase_gray_1.w / UNIT_PX * 0.78 * UNIT_SCALE * zoom;
      const scale = flag ? baseWidth / flag.w : 1;
      if (!(scale > 0)) continue;
      const flagWidth = flag ? flag.w * scale : baseWidth;
      const w = flagWidth, h = flag ? flag.h * scale : flagWidth;
      if (!(w > 0 && h > 0)) continue;
      const count = state.armies.length;
      // The furthest view tightens and slightly shrinks the grid, but every army still keeps its own flag.
      const compact = this.cam.zoom <= this.cam.minZoom() * 1.15;
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      const gap = compact ? Math.max(0.5, zoom) : 2 * zoom;
      const compactScale = compact ? 0.82 : 1;
      const iconW = w * compactScale, iconH = h * compactScale;
      const totalW = columns * iconW + (columns - 1) * gap;
      const totalH = rows * iconH + (rows - 1) * gap;
      const parts = [];
      c.save();
      for (let i = 0; i < count; i++) {
        const army = state.armies[i];
        const unitCountry = army.country || state.country;
        const unitInfo = this.stage.countries.get(unitCountry) || country;
        const unitFlag = this.flagFrame(unitInfo?.flag || unitInfo?.id || unitCountry) || flag;
        const membership = groupNumbers.get(`${unitCountry}:${army.id}`);
        const facingArea = World.areas[army.facing];
        let shiftX = 0, shiftY = 0;
        if (facingArea?.pts?.[0]) {
          const target = this.cam.toScreen(...facingArea.pts[0]);
          const dx = target.x - center.x, dy = target.y - center.y;
          const length = Math.hypot(dx, dy);
          if (length > 0) {
            const ux = dx / length, uy = dy / length;
            let edge = Infinity;
            for (const ring of World.geo?.[a.id] || []) {
              for (let j = 0; j < ring.length; j += 2) {
                const k = (j + 2) % ring.length;
                const p = this.cam.toScreen(ring[j], ring[j + 1]);
                const q = this.cam.toScreen(ring[k], ring[k + 1]);
                const vx = q.x - p.x, vy = q.y - p.y;
                const cross = ux * vy - uy * vx;
                if (Math.abs(cross) < 0.0001) continue;
                const rx = p.x - center.x, ry = p.y - center.y;
                const distance = (rx * vy - ry * vx) / cross;
                const along = (rx * uy - ry * ux) / cross;
                if (distance > 0 && along >= 0 && along <= 1) edge = Math.min(edge, distance);
              }
            }
            const shift = Math.min(length * 0.4, Number.isFinite(edge) ? edge * 0.6 : length * 0.25);
            shiftX = ux * shift; shiftY = uy * shift;
          }
        }
        const x = center.x + shiftX - totalW / 2 + (i % columns) * (iconW + gap);
        const y = center.y + shiftY - totalH / 2 + Math.floor(i / columns) * (iconH + gap);
        const selected = unitCountry === this.game.player && this.selectedUnitIds?.has(army.id);
        const glowColor = militaryFlags && membership ? this.getArmyGroupDisplayColor(membership.group, unitCountry, selected).glowColor : null;
        const frame = glowColor ? this.armyFlag(glowColor,
          this.map?.displayedTerritoryColor(unitCountry) || unitInfo?.color, membership.label, flag) : unitFlag;
        E.drawFrame(frame, x, y, { sx: iconW / frame.w, sy: iconH / frame.h, noRef: true,
          layoutGroup: militaryFlags ? 'replay-map-army-flag' : 'replay-map-flag' });
        parts.push(glowColor
          ? { rect: true, x0: x, y0: y, w: iconW, h: iconH }
          : { f: frame, x0: x, y0: y, S: iconW / frame.w, cx: x + iconW / 2, mirror: false });
      }
      c.restore();
      this.boxes.push({ id: a.id, parts });
    }
  }

  // area id of the unit under screen point p, or -1 (topmost first)
  // area id of the unit whose drawn pixels are under screen point p (the topmost / nearest first), or -1. Exact pixels, no tolerance ring:
  // round a unit is usually its own area's ground anyway, and a ring grabbed the neighbours' ground when zoomed out (units are small then).
  hitTest(p) {
    return this.hitBox(p)?.id ?? -1;
  }

  hitBox(p) {
    for (let i = this.boxes.length - 1; i >= 0; i--) for (const q of this.boxes[i].parts) if (opaqueAt(q, p.x, p.y)) return this.boxes[i];
    return null;
  }

  drawUnit(ar, cc, s0, S0, country, controlled, count, areaId, bob = 0, shift = null) {
    const s = { x: s0.x + (shift?.x || 0), y: s0.y - bob + (shift?.y || 0) };
    const S = S0 * UNIT_SCALE, A = this.army, c = E.ctx;
    const fade = this.colorFade(country, relationColor(this.game, country));
    const n = E.clamp(count, 1, 4);
    const base = A[`unitbase_${fade.color}_${n}`] || A[`unitbase_gray_${n}`];
    const basePrev = A[`unitbase_${fade.prev}_${n}`] || A[`unitbase_gray_${n}`];
    // A land army standing on a sea tile is being carried (it paid the transport card to cross water, movement.js `canEnter`): show the
    // transport ship instead of the unit itself, with a small pin over it repeating its type (original assets transportship / mark_carriers_*).
    const carried = !NAVY_SPRITES.has(ar.type) && World.areas[areaId]?.f === 1;
    const chosen = carried ? { frame: A.transportship, mirror: facesLeft(areaId, ar.facing), grounded: false }
      : this.facingSprite(ar.type, cc, areaId, ar.facing);
    const spr = chosen.frame, left = chosen.mirror, spriteDY = chosen.grounded ? 0 : SPR_DY;
    if (fade.k >= 1 || fade.prev === fade.color) {
      E.drawFrame(base, s.x, s.y, { scale: S, noLayout: true });
    } else {
      E.drawFrame(basePrev, s.x, s.y, { scale: S, noLayout: true, alpha: 1 - fade.k });
      E.drawFrame(base, s.x, s.y, { scale: S, noLayout: true, alpha: fade.k });
    }
    if (fade.flash > 0 && base) {
      const ring = this.whiteSilhouette(base);
      c.save(); c.globalAlpha = 0.65 * fade.flash; c.globalCompositeOperation = 'lighter';
      E.drawFrame(ring, s.x, s.y, { scale: S * 1.05, noLayout: true });
      c.restore();
    }
    const solid = !!(SOLID_3D && spr && this.l3d && ar.type === 'infantry' && cc === 'de');   // German infantry is a 3D model standing on the base
    if (solid) {
      const f = fatigueLevel(ar), gain = ar.encircled ? 0.5 : 1 - 0.16 * f, left = facesLeft(areaId, ar.facing);
      const feet = this.cam.toWorld(s.x, s.y + spriteDY * S);      // the desk point under the 2D icon's feet (on top of the disc, as drawn)
      this.l3d.add(feet.x, feet.y, left, gain);
    } else if (spr) {
      const unitCountry = ar.country || country;
      const grp = groupForArmy(this.game, unitCountry, ar.id);
      const ownUnit = unitCountry === this.game.player;
      const selected = ownUnit && this.selectedUnitIds?.has(ar.id);
      const glowAlpha = selected ? 1 : (E.state.groupGlowIntensity ?? 0.85);
      if (selected || ((ownUnit || (this.game.spectating || this.game.bridgeSpectating)) && grp?.country === unitCountry && !E.exp('noglow') && glowAlpha > 0)) {
        const groupColor = this.getArmyGroupDisplayColor(grp, unitCountry, selected).glowColor;
        const glow = this.glowSprite(spr, groupColor), gy = s.y + spriteDY * S;
        c.save();
        if (left) { c.translate(s.x, 0); c.scale(-1, 1); }
        const gx = left ? 0 : s.x;
        c.globalCompositeOperation = 'lighter';
        let remaining = glowAlpha;
        while (remaining > 0.001) {
          c.globalAlpha = Math.min(1, remaining);
          E.drawFrame(glow, gx, gy, { scale: S, filter: 'none', noLayout: true });
          remaining -= 1;
        }
        c.restore();
      }
      drawFatiguedSprite(ar, controlled, filter => {
        const o = { scale: S, filter: 'none', noLayout: true }, fs = this.filtered(spr, filter);            // exhausted = warm-grey tint + pale gold outline; encircled = darkened
        if (left) { c.save(); c.translate(s.x, 0); c.scale(-1, 1); E.drawFrame(fs, 0, s.y + spriteDY * S, o); c.restore(); }   // leftward adjacency directions: mirror about the unit's centre line
        else E.drawFrame(fs, s.x, s.y + spriteDY * S, o);
      });
      c.save();
      if (left) { c.translate(s.x, 0); c.scale(-1, 1); }
      drawFatigueWear(ar, spr, left ? 0 : s.x, s.y + spriteDY * S, S);
      c.restore();
    }
    if (carried) {                                     // the pin over the ship, naming what it's carrying
      const pin = A[`mark_carriers_${fade.color}`] || A.mark_carriers_gray;
      const pinPrev = A[`mark_carriers_${fade.prev}`] || A.mark_carriers_gray;
      const icon = A[`mark_carriers_${SPRITE[ar.type] || 'soldier'}`];
      const py = s.y + (SPR_DY - spr.ry) * S;           // just above the ship's own top edge, whatever its height
      if (fade.k >= 1 || fade.prev === fade.color) E.drawFrame(pin, s.x, py, { scale: S, noLayout: true });
      else {
        E.drawFrame(pinPrev, s.x, py, { scale: S, noLayout: true, alpha: 1 - fade.k });
        E.drawFrame(pin, s.x, py, { scale: S, noLayout: true, alpha: fade.k });
      }
      if (icon) E.drawFrame(icon, s.x, py, { scale: S, noLayout: true });   // baked at the same anchor as the pin: its own refy centres it in the pin's head
    }
    // Hit parts = the base disc and the soldier / vehicle as DRAWN, tested by their opaque pixels (hitTest). Clicking the unit itself selects
    // the area it stands on; clicking the transparent space round it falls through to the ground. (A whole bounding rectangle, transparent
    // corners included, covered the ground of the areas behind the unit - in 3D, where units stand up tall, 10-18% of clicks went to the
    // wrong area.)
    const part = (f, dy, mirror) => ({ f, x0: s.x - f.rx * S, y0: s.y + dy * S - f.ry * S, S, cx: s.x, mirror });
    const parts = [part(base, 0, false)];
    if (spr && !solid) parts.push(part(spr, spriteDY, left));
    this.boxes.push({ id: areaId, armyId: ar.id, parts });
    const info = () => {
      const tx = s.x + BAR_DX * S, ty = s.y + BAR_DY * S;
      if (this.hudOccludes(tx, ty, S)) return;
      this.drawInfoBlock(ar, tx, ty, S, controlled, cc, country);
    };
    if (this.infoQueue) this.infoQueue.push(info); else info();
  }

  setHudOccluders(rects) { this.hudOccluders = rects || []; }

  hudOccludes(tx, ty, S) {
    const hb = this.army?.hpbar;
    const lay = flagLayout(S, hb);
    const w = (hb?.w || 110) * S + lay.flagW + lay.gap, h = Math.max((hb?.h || 28) * S, lay.flagH);
    const x = tx - lay.flagW - lay.gap;
    for (const r of (this.hudOccluders || [])) {
      if (x < r.x + r.w && x + w > r.x && ty < r.y + r.h && ty + h > r.y) return true;
    }
    return false;
  }

  flagFrame(cc) {
    if (!cc || !this.flags) return null;
    const raw = String(cc), clean = raw.replace(/\d+$/, '');
    return this.flags['flag_' + raw] || this.flags['flag_' + clean] || null;
  }

  // info block (movement badge, hp bar, level, cards), laid out from the bar's top-left corner (tx, ty)
  drawInfoBlock(ar, tx, ty, S, controlled = true, cc = null, country = null) {
    const A = this.army, c = E.ctx, hb = A.hpbar, at = (f, dx, dy) => E.drawFrame(f, tx + dx * S, ty + dy * S, { scale: S, noRef: true, noLayout: true });
    if (this.showNationFlags) this.drawNationFlag(cc, tx, ty, S, hb);   // off: the user rejected flags beside units (the legend + base colours carry the relation)
    const atTactic = (f, dx, dy) => E.drawFrame(f, tx + dx * S, ty + dy * S, { scale: S, noRef: true, layoutGroup: `unit-tactic:${f.atlas}/${f.name}` });
    at(hb, 0, 0);
    const ratio = ar.maxHp ? E.clamp(ar.hp / ar.maxHp, 0, 1) : 1, fatigued = fatigueLevel(ar) > 0;                      // hit-point bar
    c.fillStyle = fatigued
      ? (ratio > 0.6 ? '#718f49' : ratio > 0.3 ? '#9a7838' : '#8b4338')
      : (ratio > 0.6 ? '#31c443' : ratio > 0.3 ? '#e0b030' : '#d23a2a');
    c.fillRect(tx + 33 * S, ty + 14 * S, 66 * S * ratio, 7 * S);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(tx + 33 * S, ty + 14 * S, 66 * S * ratio, 2.5 * S);
    const unitCountry = country || ar.country || cc;
    const group = unitCountry && groupForArmy(this.game, unitCountry, ar.id);
    if (group) {
      const n = this.game.armyGroups.filter(g => g.country === unitCountry).indexOf(group);
      const badgeColor = group.color || getGroupColor(group, this.game, unitCountry);
      c.save();
      c.fillStyle = badgeColor;
      c.fillRect(tx + 102 * S, ty + 4 * S, 17 * S, 17 * S);
      c.strokeStyle = 'rgba(0,0,0,0.45)';
      c.lineWidth = Math.max(1, 1 * S);
      c.strokeRect(tx + 102 * S, ty + 4 * S, 17 * S, 17 * S);
      E.text(String(n >= 0 ? n + 1 : 1), tx + 110.5 * S, ty + 12.5 * S, { size: 12 * S, align: 'center', color: '#fff', weight: 'bold' });
      c.restore();
    }
    // remaining movement points: the digits 1-3 from the atlas; when they are used up the original shows the yellow "E"
    // (Exhausted, hpbar_movementmark_e) instead of a 0
    const mv = controlled ? (ar.movement ?? 0) : 0, badge = A[mv > 0 ? 'hpbar_movementmark_' + E.clamp(mv, 1, 3) : 'hpbar_movementmark_e'];
    if (badge) at(badge, 8, 7);
    if (ar.level > 0) at(A['unitlevelmark_' + E.clamp(ar.level, 1, 4)], 92, -5);
    const assault = !!(ar.cards & 1), defence = !!(ar.cards & 2), carrier = !!(ar.cards & 4), lowerTacticX = 111, lowerTacticY = 15, assaultX = 111, assaultY = -14, defenceX = 111, defenceY = 15, carrierX = 109, carrierY = -41;
    if (assault && defence) {
      atTactic(A.cardmark_1, assaultX, assaultY);
      atTactic(A.cardmark_2, defenceX, defenceY);
    } else if (assault) atTactic(A.cardmark_1, lowerTacticX, lowerTacticY);
    else if (defence) atTactic(A.cardmark_2, lowerTacticX, lowerTacticY);
    if (carrier) {
      const otherTactics = Number(assault) + Number(defence);
      if (otherTactics === 0) at(A.cardmark_3, lowerTacticX, lowerTacticY);
      else if (otherTactics === 1) at(A.cardmark_3, assaultX, assaultY);
      else at(A.cardmark_3, carrierX, carrierY);
    }
  }

  // A unit as shown in the stacked-army panel: its sprite standing on the bottom edge, the info block right below it.
  drawArmyIcon(ar, cc, cx, bottom, S, areaId = null) {
    const k = S / 0.95;
    const A = this.army, spr = this.spriteFor(ar.type, cc), hb = A.hpbar, infoH = hb.h * S;
    if (spr) {
      const y = bottom - infoH - 4 * k, c = E.ctx;
      const unitCountry = ar.country || cc;
      const grp = groupForArmy(this.game, unitCountry, ar.id);
      const ownUnit = unitCountry === this.game.player;
      const selected = ownUnit && this.selectedUnitIds?.has(ar.id);
      const glowAlpha = selected ? 1 : (E.state.groupGlowIntensity ?? 0.85);
      if (selected || ((ownUnit || (this.game.spectating || this.game.bridgeSpectating)) && grp?.country === unitCountry && !E.exp('noglow') && glowAlpha > 0)) {
        const groupColor = this.getArmyGroupDisplayColor(grp, unitCountry, selected).glowColor;
        const glow = this.glowSprite(spr, groupColor);
        c.save();
        c.translate(cx, 0); c.scale(-1, 1);
        c.globalCompositeOperation = 'lighter';
        let remaining = glowAlpha;
        while (remaining > 0.001) {
          c.globalAlpha = Math.min(1, remaining);
          E.drawFrame(glow, 0, y, { scale: S * 1.15, filter: 'none', noLayout: true });
          remaining -= 1;
        }
        c.restore();
      }
      drawFatiguedSprite(ar, true, filter => {
        const o = { scale: S * 1.15, filter: 'none', noLayout: true };
        c.save(); c.translate(cx, 0); c.scale(-1, 1); E.drawFrame(this.filtered(spr, filter), 0, y, o); c.restore();
      });
      drawFatigueWear(ar, spr, cx, y, S * 1.15);
    }
    this.drawInfoBlock(ar, cx - hb.w * S / 2, bottom - infoH - 14 * k, S, true, cc, ar.country || cc);
  }
  isActiveCountry(country) { return country === (this.game.activeCountry || this.stage.player); }

  drawNationFlag(cc, tx, ty, S, hb) {
    const fr = this.flagFrame(cc);
    if (!fr) return;
    const lay = flagLayout(S, hb);
    const barH = (hb?.h || 33) * S;
    const fx = tx - lay.flagW - lay.gap;
    const fy = ty + (barH - lay.flagH) / 2;
    const c = E.ctx;
    c.save();
    c.strokeStyle = 'rgba(28, 18, 8, 0.9)';
    c.lineWidth = Math.max(1, 1.15 * Math.max(S, 0.55));
    c.fillStyle = 'rgba(20, 14, 8, 0.35)';
    c.fillRect(fx - 1, fy - 1, lay.flagW + 2, lay.flagH + 2);
    E.drawFrame(fr, fx, fy, { sx: lay.flagW / fr.w, sy: lay.flagH / fr.h, noRef: true, noLayout: true });
    c.strokeRect(fx, fy, lay.flagW, lay.flagH);
    c.restore();
  }
}
