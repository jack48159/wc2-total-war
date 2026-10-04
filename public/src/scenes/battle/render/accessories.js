// Desk accessories ("摆件"): the library (loads assets/Accessories/*.png, bakes shadows) and the layer that draws the placed ones.
//
// Three things decide whether a piece looks right on the desk, and all three are data in META below:
//   size   ONE world scale for everything. The stage's map rect (always 16:9) is a 1200 x 675 mm paper map (MAP_MM), so the
//          desk (map x desktopRatio 1.5, also 16:9) is 1800 x 1012 mm. Map units per mm = map width / 1200, per stage. `mm` is the real-world length of a piece (measured along `ref`: bbox
//          width / height / diagonal); its size on screen follows from that alone, whatever the camera zoom. The only
//          knob is the size of a CATEGORY (E.state.accessoryScales[category], the +/- buttons in the 摆件 screen): the soldiers scale together,
//          independently of the props / stationery / medals, and the positions on the desk never move when a size changes.
//   angle  `rot`: 'none' = must stand upright (the photo has a fixed camera angle: a mug rotated in the image plane looks
//          like it is falling over), 'limited' = +-LIMIT_DEG (3/4 view, small turns look fine), 'free' = lying flat.
//   light  one lamp above and slightly up-left of the desk: shadows fall down-right, in SCREEN space. So a turned pen keeps
//          its shadow on the same side while the sprite rotates - shadows are drawn separately from the sprite.
//          kind 'flat'    shadow = the silhouette, offset by the piece's thickness (contact shadow + softer cast shadow)
//          kind 'upright' shadow = the silhouette sheared along the ground (a mug's height throws a short shadow) + an
//                         ellipse of contact shadow under the base
// Files not listed in META still work: they load as flat, freely rotatable, 100 mm pieces named after the file.
import { E } from '../../../core/index.js';

export const MAP_MM = 1200;                    // real width of the paper map on the desk
export const SCALE_RANGE = [0.4, 3];
export const LIMIT_DEG = 30;
export const LIGHT = { x: 0.6, y: 0.8 };              // screen direction shadows fall (unit vector)
const MAX_PX = 1024;                           // sprites are downscaled to this on load (the PNGs are 1-2.7 MB each)
const ALPHA_HIT = 40;

const medal = (mm, name) => ({ kind: 'flat', rot: 'free', ref: 'h', mm, thick: 6, name });
export const META = {
  // ---- 摆件 ----
  prop_coffee_cup:        { kind: 'upright', rot: 'none', ref: 'w', mm: 120, name: '军用搪瓷杯', base: { cx: 0.46, w: 0.6 } },
  prop_teacup_tea:        { kind: 'upright', rot: 'none', ref: 'w', mm: 150, name: '瓷茶杯', base: { cx: 0.5, w: 0.92 } },
  prop_leather_notebook:  { kind: 'flat', rot: 'limited', ref: 'w', mm: 150, thick: 22, name: '皮面笔记本' },
  prop_collectible_pistol:{ kind: 'flat', rot: 'free', ref: 'w', mm: 220, thick: 30, name: '收藏手枪' },
  prop_ww2_pistol_holster:{ kind: 'flat', rot: 'limited', ref: 'h', mm: 270, thick: 40, name: '皮质枪套' },
  prop_medicine_pills:    { kind: 'flat', rot: 'free', ref: 'w', mm: 90, thick: 8, name: '药片' },
  prop_ww2_medicine_tin:  { kind: 'flat', rot: 'limited', ref: 'w', mm: 110, thick: 25, name: '急救药盒' },
  // ---- 文具 ----
  tool_ww2_typewriter:    { kind: 'upright', rot: 'none', ref: 'w', mm: 330, name: '打字机', base: { cx: 0.5, w: 0.9 } },
  tool_commander_gloves:  { kind: 'flat', rot: 'free', ref: 'h', mm: 230, thick: 18, name: '指挥官手套' },
  tool_eraser:            { kind: 'flat', rot: 'free', ref: 'w', mm: 60, thick: 14, name: '橡皮' },
  tool_field_compass:     { kind: 'flat', rot: 'limited', ref: 'w', mm: 75, thick: 25, name: '野战指南针' },
  tool_fountain_pen:      { kind: 'flat', rot: 'free', ref: 'diag', mm: 145, thick: 14, name: '钢笔' },
  tool_magnifier:         { kind: 'flat', rot: 'free', ref: 'diag', mm: 230, thick: 16, name: '放大镜' },
  tool_map_pointer:       { kind: 'flat', rot: 'free', ref: 'diag', mm: 400, thick: 8, name: '指挥棒' },
  tool_pencil:            { kind: 'flat', rot: 'free', ref: 'diag', mm: 190, thick: 8, name: '铅笔' },
  tool_reading_glasses:   { kind: 'flat', rot: 'free', ref: 'w', mm: 140, thick: 22, name: '圆框眼镜' },
  tool_ww2_compass_divider:{ kind: 'flat', rot: 'free', ref: 'h', mm: 200, thick: 8, name: '圆规' },
  tool_ww2_military_ruler:{ kind: 'flat', rot: 'free', ref: 'diag', mm: 300, thick: 5, name: '军用直尺' },
  tool_ww2_protractor:    { kind: 'flat', rot: 'free', ref: 'w', mm: 180, thick: 4, name: '量角器' },
  // ---- 勋章 ----
  china_order_of_blue_sky_white_sun: medal(115, '青天白日勋章'),
  france_croix_de_guerre:            medal(110, '法国战争十字勋章'),
  germany_iron_cross:                medal(115, '铁十字勋章'),
  italy_medal_of_military_valor:     medal(110, '意大利军事勇气勋章'),
  japan_order_of_golden_kite:        medal(115, '金鵄勋章'),
  original_blue_star:                medal(115, '蓝星勋章'),
  original_gold_cross:               medal(115, '金十字勋章'),
  original_silver_round:             medal(115, '银圆勋章'),
  uk_george_cross:                   medal(115, '乔治十字勋章'),
  usa_distinguished_service_cross:   medal(110, '优异服役十字勋章'),
  ussr_order_of_patriotic_war:       medal(115, '卫国战争勋章'),
  original_ribbon_bar:               { kind: 'flat', rot: 'free', ref: 'w', mm: 90, thick: 5, name: '勋表' },
};
const DEFAULT_META = { kind: 'flat', rot: 'free', ref: 'w', mm: 100, thick: 10 };
export const metaOf = id => Object.assign({}, DEFAULT_META, { name: id }, META[id]);

export const CATEGORIES = [['prop', '摆件'], ['tool', '文具'], ['medal', '勋章'], ['figure', '兵人']];
export const categoryOf = id => id.startsWith('army:') ? 'figure' : id.startsWith('prop_') ? 'prop' : id.startsWith('tool_') ? 'tool' : 'medal';
// The size of a category (1 = real size). Categories other than the soldiers fall back to the old global knob, so saved games look the same.
export const scaleOf = cat => { const m = E.state.accessoryScales; return m && m[cat] != null ? m[cat] : cat === 'figure' ? 1 : (E.state.accessoryScale ?? 1); };

// ---- figures: every unit sprite of the game (the atlas army_hd), standing on the desk like miniatures ----
// id 'army:<frame>'; `mm` is the miniature's height (infantry) / length (everything else)
const CN = { am: '美军', cn: '中国军', de: '德军', fr: '法军', gb: '英军', it: '意军', ja: '日军', ru: '苏军', tw: '台湾军', others: '通用' };
const KINDS = [   // [frame prefix, name, mm, ref, countries]
  ['soldier', '步兵', 45, 'h', ['de', 'gb', 'ru', 'am', 'fr', 'it', 'ja', 'cn', 'tw', 'others']],
  ['eliteinfantry', '精锐步兵', 45, 'h', ['de', 'others']],
  ['cannon', '火炮', 75, 'w', ['de', 'gb', 'ru', 'am', 'others']],
  ['rocketlauncher', '火箭炮', 70, 'w', ['de', 'ru', 'others']],
  ['tank', '坦克', 70, 'w', ['de', 'gb', 'ru', 'am', 'fr', 'it', 'ja', 'others']],
  ['panzer', '装甲车', 65, 'w', ['de', 'gb', 'ru', 'am', 'fr', 'it', 'ja', 'others']],
  ['heavytank', '重型坦克', 80, 'w', ['de', 'gb', 'ru', 'am', 'fr', 'ja', 'others']],
];
const SINGLES = { fighter: ['战斗机', 110], bomber: ['轰炸机', 130], transportship: ['运输船', 150], destroyer_others: ['驱逐舰', 150], cruiser_others: ['巡洋舰', 170], battleship_others: ['战列舰', 200], aircraftcarrier_others: ['航空母舰', 230] };
export const ARMY_IDS = [];
for (const [pre, name, mm, ref, cs] of KINDS) for (const c of cs) {
  const id = 'army:' + pre + '_' + c; ARMY_IDS.push(id);
  META[id] = { kind: 'upright', rot: 'none', ref, mm, name: CN[c] + name, base: { cx: 0.5, w: ref === 'h' ? 0.55 : 0.8 } };
}
for (const [f, [name, mm]] of Object.entries(SINGLES)) { const id = 'army:' + f; ARMY_IDS.push(id); META[id] = { kind: 'upright', rot: 'none', ref: 'w', mm, name, base: { cx: 0.5, w: 0.8 } }; }
export const ROT_TAG = { none: '正放', limited: '±' + LIMIT_DEG + '°', free: '任意角度' };

// ---- library: loading + baking ----
const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w)); cv.height = Math.max(1, Math.ceil(h)); return cv; };

// A blurred copy of whatever `paint(g)` draws (in sprite pixel coordinates); `p` = padding around the sprite.
// Half-size copies down to ~128 px: drawing a 1000 px canvas scaled down to 100 px every frame is slow, so draw from the level that fits.
function pyramid(cv) {
  const lv = [cv];
  while (Math.min(lv[lv.length - 1].width, lv[lv.length - 1].height) > 160) {
    const prev = lv[lv.length - 1], c2 = mk(prev.width / 2, prev.height / 2), g = c2.getContext('2d');
    g.imageSmoothingQuality = 'high'; g.drawImage(prev, 0, 0, c2.width, c2.height); lv.push(c2);
  }
  return lv;
}
// the level to draw at `r` screen px per source px (each level is half the size of the previous one), and its size factor
export function pickLevel(lv, r) { const i = Math.max(0, Math.min(lv.length - 1, Math.floor(Math.log2(1 / Math.max(r, 1e-4))))); return { cv: lv[i], f: 2 ** i }; }

function bakeLayer(w, h, p, blur, paint) {
  const cv = mk(w + 2 * p, h + 2 * p), g = cv.getContext('2d');
  g.translate(p, p); g.filter = `blur(${Math.max(0.01, blur)}px)`; paint(g);
  return { cv, p };
}

async function bake(key) {
  const flip = key.endsWith('|f'), id = flip ? key.slice(0, -2) : key, meta = metaOf(id);
  let cv, w, h, g;
  if (id.startsWith('army:')) {                                    // a unit sprite from the game's atlas, enlarged 3x with smoothing so it stays soft, not blocky, when magnified
    const f = (await E.atlas('army_hd'))[id.slice(5)]; if (!f) throw new Error('no sprite ' + id);
    w = f.w * 3; h = f.h * 3; cv = mk(w, h); g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, w, h);
  } else {
    const full = await createImageBitmap(await (await fetch(`assets/Accessories/${id}.png`)).blob());
    const k = Math.min(1, MAX_PX / Math.max(full.width, full.height)); w = Math.round(full.width * k); h = Math.round(full.height * k);
    cv = mk(w, h); g = cv.getContext('2d');
    g.drawImage(full, 0, 0, w, h); full.close && full.close();
  }

  if (flip) { const f2 = mk(w, h), fg = f2.getContext('2d'); fg.translate(w, 0); fg.scale(-1, 1); fg.drawImage(cv, 0, 0); cv = f2; g = fg; }   // mirrored copy (shadows are baked from it, so they still fall the same way)
  const alpha = new Uint8Array(w * h), px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = alpha[y * w + x] = px[(y * w + x) * 4 + 3];
    if (a > ALPHA_HIT) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const refPx = meta.ref === 'h' ? bh : meta.ref === 'diag' ? Math.hypot(bw, bh) : bw;
  const s = meta.mm / refPx;                                      // mm per sprite pixel (map units = mm * layer.upm())
  const e = { id, meta, cv, w, h, alpha, bbox: { x0, y0, x1, y1, w: bw, h: bh }, cx: x0 + bw / 2, cy: y0 + bh / 2, s };

  const sil = mk(w, h), sg = sil.getContext('2d');                 // black silhouette
  sg.drawImage(cv, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, w, h);
  const toPx = mm => mm / s;                                       // mm -> sprite px

  if (meta.kind === 'upright') {
    const baseY = y1, sx = 0.19, sy = 0.15, blur = bh * 0.035, pad = Math.ceil(Math.max(sx, sy) * bh + blur * 3 + 6);
    e.cast = bakeLayer(w, h, pad, blur, g2 => {                    // silhouette sheared away from the base along the ground
      g2.setTransform(1, 0, -sx, -sy, sx * baseY + pad, baseY * (1 + sy) + pad); g2.drawImage(sil, 0, 0);
    });
    const b = meta.base || { cx: 0.5, w: 0.8 }, ex = x0 + b.cx * bw, rx = b.w * bw / 2, ry = rx * 0.2;
    e.contact = bakeLayer(w, h, Math.ceil(ry * 2 + 8), ry * 0.45, g2 => { g2.beginPath(); g2.ellipse(ex, baseY - ry * 0.3, rx * 1.04, ry, 0, 0, Math.PI * 2); g2.fillStyle = '#000'; g2.fill(); });
    e.castAlpha = 0.34; e.contactAlpha = 0.62; e.castOff = 0; e.contactOff = 0;
  } else {
    const t = meta.thick;                                          // thickness (mm) drives blur + offset
    const bc = toPx(t * 0.45), bt = toPx(t * 0.12);
    e.cast = bakeLayer(w, h, Math.ceil(bc * 3 + 2), bc, g2 => g2.drawImage(sil, 0, 0));
    e.contact = bakeLayer(w, h, Math.ceil(bt * 3 + 2), bt, g2 => g2.drawImage(sil, 0, 0));
    e.castAlpha = 0.4; e.contactAlpha = 0.55; e.castOff = t * 0.5; e.contactOff = t * 0.07;
  }
  e.lv = pyramid(cv); e.cast.lv = pyramid(e.cast.cv); e.contact.lv = pyramid(e.contact.cv);
  return e;
}

export const Library = {
  ids: [], items: new Map(), _loading: new Map(), _ready: null,
  // the file list (server scans the folder); the sprites themselves load in the background via load()
  ready() {
    return this._ready || (this._ready = fetch(E.platform?.assetIndex('accessories') || '/api/accessories').then(r => r.json()).then(list => { this.ids = [...list.map(f => f.replace(/\.png$/i, '')), ...ARMY_IDS]; }).catch(() => { this.ids = [...ARMY_IDS]; }));
  },
  load(id) {
    if (this.items.has(id)) return Promise.resolve(this.items.get(id));
    if (!this._loading.has(id)) this._loading.set(id, bake(id).then(e => { this.items.set(id, e); return e; }, () => null));
    return this._loading.get(id);
  },
  async loadAll(concurrency = 3) {
    await this.ready();
    const queue = this.ids.filter(id => !this.items.has(id));
    await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) await this.load(queue.shift()); }));
  },
};

// ---- the placed pieces ----
// Persisted in E.state.accessories as { id, dx, dy, rot, scale }: dx/dy in mm from the centre of the desk, rot in
// degrees, scale = 1 is real size. Kept relative to the desk centre so every stage (each has its own map rect, hence its own units-per-mm) shows the same layout.
export class AccessoryLayer {
  constructor(cam, bounds) {
    this.cam = cam; this.bounds = bounds; this.held = null; this.lift = new Map(); this.rev = 0;   // rev: bumped on every visible change (the tilt view repaints its ground texture on change)
    // v3: offsets are in mm of the UNSCALED desk, so changing a size never moves a piece. (v2 stored them scaled by the old global size knob.)
    if (!Array.isArray(E.state.accessories)) { E.state.accessories = []; E.state.accessoriesV = 3; }
    else if (E.state.accessoriesV === 2) { const g = E.state.accessoryScale ?? 1; for (const it of E.state.accessories) { it.dx *= g; it.dy *= g; } E.state.accessoriesV = 3; }
    else if (E.state.accessoriesV !== 3) { E.state.accessories = []; E.state.accessoriesV = 3; }   // v1 was in map units
    this.items = E.state.accessories;
  }
  posUpm() { const b = this.bounds; return (b.x1 - b.x0) / MAP_MM; }                                      // map units per mm: positions
  upm(it) { return this.posUpm() * scaleOf(it ? categoryOf(it.id) : 'prop'); }                            // ... and sizes of a piece (its category's scale)
  get mid() { const b = this.bounds; return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; }
  // the desk rect in map units (same maths as MapRenderer.drawBox)
  desk() {
    const b = this.bounds, r = Math.max(1, E.state?.desktopRatio ?? 1.5), w = (b.x1 - b.x0) * r, h = (b.y1 - b.y0) * r, m = this.mid;
    return { x0: m.x - w / 2, y0: m.y - h / 2, x1: m.x + w / 2, y1: m.y + h / 2 };
  }
  pos(it) { const m = this.mid, u = this.posUpm(); return { x: m.x + it.dx * u, y: m.y + it.dy * u }; }
  setPos(it, x, y) {                                                // clamped to the desk
    const d = this.desk(), m = this.mid, u = this.posUpm();
    it.dx = (E.clamp(x, d.x0, d.x1) - m.x) / u; it.dy = (E.clamp(y, d.y0, d.y1) - m.y) / u; this.rev++;
  }
  add(id, x, y) { const it = { id, dx: 0, dy: 0, rot: 0, scale: 1 }; this.setPos(it, x, y); this.items.push(it); return it; }
  remove(it) { const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); this.lift.delete(it); this.rev++; }
  toFront(it) { const i = this.items.indexOf(it); if (i >= 0 && i < this.items.length - 1) { this.items.splice(i, 1); this.items.push(it); this.rev++; } }
  save() { E.saveState(); }
  entry(it) {                                                    // a mirrored piece uses its own baked copy; until that is ready the plain one stands in
    if (it.flip) { const f = Library.items.get(it.id + '|f'); if (f) return f; Library.load(it.id + '|f'); }
    return Library.items.get(it.id);
  }
  flip(it) { it.flip = !it.flip; this.rev++; }
  // world size (map units) of the piece's bounding box, and the scale from sprite px to map units
  k(it) { const e = this.entry(it); return e ? e.s * this.upm(it) * it.scale : 1; }   // map units per sprite pixel

  // Turn a piece, obeying its rule. Returns false when the rule forbids it (locked pieces).
  setRot(it, deg, snap = true) {
    const rule = metaOf(it.id).rot;
    if (rule === 'none') { it.rot = 0; return false; }
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    if (rule === 'limited') deg = E.clamp(deg, -LIMIT_DEG, LIMIT_DEG);
    if (snap) for (const a of [0, 90, 180, -90, -180]) if (Math.abs(deg - a) < 4) { deg = a; break; }
    if (rule === 'limited') deg = E.clamp(deg, -LIMIT_DEG, LIMIT_DEG);
    it.rot = deg; this.rev++; return true;
  }

  // pointer (map units) on an opaque pixel of the piece? `tol` (map units) forgives thin pieces like pencils.
  hit(it, wx, wy, tol = 0) {
    const e = this.entry(it); if (!e) return false;
    const p = this.pos(it), k = this.k(it), r = -it.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    const dx = wx - p.x, dy = wy - p.y, t = tol / k;
    const lx = (dx * cos - dy * sin) / k + e.cx, ly = (dx * sin + dy * cos) / k + e.cy, bb = e.bbox;
    if (e.meta.kind === 'upright') {                               // figures (and other standing pieces): grab the whole silhouette box, gaps included
      const m = 0.06 * Math.max(bb.w, bb.h) + t;
      return lx >= bb.x0 - m && lx <= bb.x1 + m && ly >= bb.y0 - m && ly <= bb.y1 + m;
    }
    for (const [ox, oy] of [[0, 0], [t, 0], [-t, 0], [0, t], [0, -t]]) {
      const x = Math.round(lx + ox), y = Math.round(ly + oy);
      if (x >= 0 && y >= 0 && x < e.w && y < e.h && e.alpha[y * e.w + x] > ALPHA_HIT) return true;
    }
    return false;
  }
  // sp: the pointer in screen px. In the 3D desk view upright pieces (cups, typewriter) are billboards, so they are hit in screen space.
  hitTest(wx, wy, tol, sp = null) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (this.cam.desk3d && sp && this.isUpright(it) ? this.hitUpright(it, sp.x, sp.y) : this.hit(it, wx, wy, tol)) return it;
    }
    return null;
  }
  isUpright(it) { const e = this.entry(it); return !!e && e.meta.kind === 'upright'; }
  // billboard of an upright piece in the 3D desk view: its base sits on the desk under the piece (same convention as the top-down drawing: half
  // the sprite height below the centre), the sprite stands upright on screen at the perspective scale there
  billboard(it) {
    const e = this.entry(it), cam = this.cam, p = this.pos(it), k0 = this.k(it), gy = p.y + e.bbox.h * k0 / 2, s = cam.toScreen3(p.x, gy), kp = k0 * cam.scale3(p.x, gy);
    return { e, s, kp, x0: s.x - e.cx * kp, y0: s.y - (e.bbox.y1 + 1) * kp };
  }
  hitUpright(it, sx, sy) {
    const b = this.billboard(it), e = b.e, x = (sx - b.x0) / b.kp, y = (sy - b.y0) / b.kp, bb = e.bbox;
    // Grab by the whole silhouette box, not per opaque pixel: a soldier / vehicle enlarged has big transparent gaps (between the legs, around
    // the rifle) that grow with the size, and pressing there used to miss the piece. A small margin makes the edges easy to catch too.
    const m = 0.06 * Math.max(bb.w, bb.h);
    return x >= bb.x0 - m && x <= bb.x1 + m && y >= bb.y0 - m && y <= bb.y1 + m;
  }

  update(dt) {
    const k = Math.min(1, dt * 14);
    for (const it of this.items) { const v = this.lift.get(it) || 0, t = it === this.held ? 1 : 0; if (v !== t) { this.lift.set(it, Math.abs(t - v) < 0.01 ? t : v + (t - v) * k); this.rev++; } }
  }

  // ctx must already be in map units (cam.apply)
  drawItem(c, it, sprite = true) {
    const e = this.entry(it); if (!e) return;
    const p = this.pos(it), lift = this.lift.get(it) || 0, k = this.k(it) * (1 + 0.05 * lift), rot = it.rot * Math.PI / 180;
    const off = (base, extra) => (base * it.scale + extra * lift * 12) * this.upm(it);   // lifted pieces throw a longer, fainter shadow
    const layer = (L, alpha, o) => {
      c.save(); c.translate(p.x + LIGHT.x * o, p.y + LIGHT.y * o); c.rotate(rot); c.scale(k, k);
      c.globalAlpha = alpha; c.drawImage(L.cv, -L.p - e.cx, -L.p - e.cy); c.restore();
    };
    layer(e.cast, e.castAlpha * (1 - 0.3 * lift), off(e.castOff, 0.5));
    layer(e.contact, e.contactAlpha * (1 - 0.6 * lift), off(e.contactOff, 0.06));
    if (!sprite) return;
    c.save(); c.translate(p.x, p.y); c.rotate(rot); c.scale(k, k);
    c.drawImage(e.cv, -e.cx, -e.cy); c.restore();
  }
  draw(c, cam = this.cam) {
    if (!this.items.length) return;
    const v = cam.view();
    c.save(); cam.apply(c);
    for (const it of this.items) {
      const e = this.entry(it); if (!e) continue;
      const p = this.pos(it), r = Math.hypot(e.bbox.w, e.bbox.h) * this.k(it) * 0.5 + 400;   // + shadow reach
      if (p.x + r < v.x0 || p.x - r > v.x1 || p.y + r < v.y0 || p.y - r > v.y1) continue;
      this.drawItem(c, it);
    }
    c.restore();
  }

  // The 3D-desk drawing (screen space, through cam.warp): flat like the map inside the map rect, perspective outside it. Each piece is drawn
  // with the affine map that best fits the warp at its position (pieces are small); upright pieces (cups, typewriter) stand as billboards.
  drawWarped(c) {
    if (!this.items.length) return;
    const cam = this.cam, STEP = 16;
    const jac = (x, y) => {
      const o = cam.warp(x, y), a = cam.warp(x + STEP, y), b = cam.warp(x, y + STEP);
      return { o, ax: (a.x - o.x) / STEP, ay: (a.y - o.y) / STEP, bx: (b.x - o.x) / STEP, by: (b.y - o.y) / STEP };
    };
    // draw canvas `cv` (pivot at sprite px (px, py)) lying on the desk at desk point (x, y): sprite px -> desk units k, turned by rot
    const lay = (lv, px, py, x, y, k, rot, alpha) => {
      const J = jac(x, y), co = Math.cos(rot), si = Math.sin(rot);
      const { cv, f } = pickLevel(lv, k * Math.sqrt(Math.abs(J.ax * J.by - J.ay * J.bx))), kf = k * f;          // f: the chosen level is f times smaller
      c.save(); c.globalAlpha = alpha;
      c.transform(kf * (J.ax * co + J.bx * si), kf * (J.ay * co + J.by * si), kf * (-J.ax * si + J.bx * co), kf * (-J.ay * si + J.by * co), J.o.x, J.o.y);
      c.drawImage(cv, -px / f, -py / f); c.restore();
    };
    for (const it of this.items) {
      const e = this.entry(it); if (!e) continue;
      const p = this.pos(it), lift = this.lift.get(it) || 0, k = this.k(it) * (1 + 0.05 * lift), rot = it.rot * Math.PI / 180;
      const o0 = cam.warp(p.x, p.y), reach = Math.hypot(e.bbox.w, e.bbox.h) * k * o0.k * 0.75 + 40;   // the piece and its shadow, in px
      if (o0.x < -reach || o0.x > E.W + reach || o0.y < -reach || o0.y > E.H + reach * 1.5) continue;
      const off = (base, extra) => (base * it.scale + extra * lift * 12) * this.upm(it);
      for (const [L, alpha, o] of [[e.cast, e.castAlpha * (1 - 0.3 * lift), off(e.castOff, 0.5)], [e.contact, e.contactAlpha * (1 - 0.6 * lift), off(e.contactOff, 0.06)]])
        lay(L.lv, L.p + e.cx, L.p + e.cy, p.x + LIGHT.x * o, p.y + LIGHT.y * o, k, rot, alpha);
      if (e.meta.kind === 'upright') {
        const b = this.billboard(it), up = lift * 14 * b.kp;
        const pl = pickLevel(e.lv, b.kp);
        c.drawImage(pl.cv, b.x0, b.y0 - up, e.w * b.kp, e.h * b.kp);
      } else lay(e.lv, e.cx, e.cy, p.x, p.y, k, rot, 1);
    }
  }
}
