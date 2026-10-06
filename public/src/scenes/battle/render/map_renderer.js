// Draws the battlefield: world tiles, country-coloured zone sprites, the desktop background, the airport range circle and the
// movement arrows. Follows CScene::Render's order. Knows nothing about input or HUD.
import { E } from '../../../core/index.js';
import { World, MAP_W, MAP_H } from '../../../game/world.js';
import { TARGET } from '../../../game/stage.js';
import { UNIT_PX } from './camera.js';
import { rememberVisibility } from '../../../game/rules/visibility.js';

// World tiles are 1024px images at 2 px per map unit = 512 units, on a 500-unit grid. The extra 12 units are 6 units of
// padding on EACH side: tile (cx, cy) is drawn at (cx*500 - 6, cy*500 - 6). Measured against the zone sprites (337 areas):
// with the tile origin at the grid corner every area is off by (+6, +6) +-1; with the -6 padding the median error is 0.
// Neighbouring tiles overlap by 12 units (the overlapping strips are identical); later tiles are drawn over earlier ones.
const TILE_STEP = 500, TILE_U = 512, TILE_PAD = 6;
function tileRange(v) {
  return { cx0: Math.max(0, Math.floor((v.x0 - TILE_U) / TILE_STEP)), cx1: Math.min(Math.ceil(MAP_W/500)-1, Math.floor((v.x1 + TILE_PAD) / TILE_STEP)),
           cy0: Math.max(0, Math.floor((v.y0 - TILE_U) / TILE_STEP)), cy1: Math.min(Math.ceil(MAP_H/500)-1, Math.floor((v.y1 + TILE_PAD) / TILE_STEP)) };
}
const OWN_ALPHA = 0.55, FLASH_LO = 0.5, FLASH_HI = 0.8, CLOSED_ALPHA = 0.8;
// The base map has no country colours (all land is the same cream), so the zone layer is what shows ownership. ?zones=off hides it for alignment checks.

export class MapRenderer {
  constructor(game, camera, { army, desktop, paperBorder }) {
    game.stage.useWorld();
    this.game = game; this.stage = game.stage; this.cam = camera; this.army = army; this.desktop = desktop; this.paperBorder = paperBorder;
    this.tiles = new Map(); this.zoneImgs = new Map(); this.tintCache = new Map(); this.loads = 0; this.zoneRebuilds = 0;   // loads: bumped whenever a tile / zone image arrives (the tilt view repaints its ground texture on change)
    this.targets = new Map(); this.cardTargets = new Set();
    // CScene::Update animation state
    this.arrowT = 0.2; this.vT = 0; this.vDir = -100; this.flashT = 0.8; this.flashDir = -1;
  }

  // ownership changed: the zone layers must be rebuilt
  invalidate() { this._layerKey = null; this._territoryColors?.clear(); }

  setTargets(targets) {
    this.targets = targets;
    for (const t of targets.values()) if (t !== TARGET.ROCKET) { this.arrowT = 0.2; break; }
  }

  update(dt) {
    // arrow timer 0.2 -> 1 at 0.9/s, then 1 -> 1.5 at 0.36/s (fading), then restarts; flash 0.8 <-> 0.5; vertical bob 0 <-> -20
    const t = this.arrowT; this.arrowT = t < 1 ? t + dt * 0.9 : (t + dt * 0.9 * 0.4 >= 1.5 ? 0.2 : t + dt * 0.9 * 0.4);
    this.flashT += dt * this.flashDir; if (this.flashT < FLASH_LO) { this.flashT = FLASH_LO; this.flashDir = 1; } if (this.flashT > FLASH_HI) { this.flashT = FLASH_HI; this.flashDir = -1; }
    this.vT += dt * this.vDir; if (this.vT < -20) { this.vT = -20; this.vDir = 100; } if (this.vT > 0) { this.vT = 0; this.vDir = -100; }
  }

  // ---- loading ----
  // Load the tiles / zone sprites the current view needs, so entering the scene never shows an empty map.
  preload() {
    this.stage.useWorld();
    const v = this.cam.view(), jobs = [];
    const R = tileRange(v);
    for (let cy = R.cy0; cy <= R.cy1; cy++)
      for (let cx = R.cx0; cx <= R.cx1; cx++) {
        const k = cy * 16 + cx; if (this.tiles.has(k)) continue; this.tiles.set(k, { img: null });
        jobs.push(E.image(`${this.stage.data.mapResources?.tileRoot || 'assets/map'}/${cx}_${cy}.webp`).then(img => { this.tiles.get(k).img = img; this.loads++; }, () => {}));
      }
    for (const a of World.areas) if (a.x < v.x1 && a.x + a.w > v.x0 && a.y < v.y1 && a.y + a.h > v.y0) {
      const zn = World.zone[a.id] && World.zone[a.id][0]; if (!zn || this.zoneImgs.get(zn) !== undefined) continue;
      this.zoneImgs.set(zn, null); jobs.push(E.image((this.stage.data.mapResources?.zoneRoot || 'assets/zones') + '/' + zn).then(i => { this.zoneImgs.set(zn, i); this.loads++; }, () => {}));
    }
    return Promise.all(jobs);
  }
  tile(cx, cy) {
    const k = cy * 16 + cx, t = this.tiles.get(k);
    if (t) return t.img || null;
    this.tiles.set(k, { img: null });
    E.image(`${this.stage.data.mapResources?.tileRoot || 'assets/map'}/${cx}_${cy}.webp`).then(img => { this.tiles.get(k).img = img; this.loads++; }, () => {});
    return null;
  }
  // Virtual areas of a mirrored benchmark map (stage.data.mirror, e.g. conquest_mirror_de) have no zone image of their own: their
  // territory shape is the source area's zone sprite flipped horizontally (same bounding-box size), cached as a small canvas.
  mirrorSprite(id) {
    const m = this.stage?.data?.mirror; if (!m?.pairs) return null;
    if (!this._mirrorSrc) this._mirrorSrc = new Map(Object.entries(m.pairs).map(([src, virt]) => [+virt, +src]));
    const src = this._mirrorSrc.get(id); if (src == null) return null;
    const base = this.zoneSpriteOf(src); if (!base) return null;
    this._mirrorCv ||= new Map();
    let cv = this._mirrorCv.get(id);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = base.w; cv.height = base.h;
      const g = cv.getContext('2d'); g.translate(base.w, 0); g.scale(-1, 1);
      g.drawImage(base.img, base.x, base.y, base.w, base.h, 0, 0, base.w, base.h);
      this._mirrorCv.set(id, cv);
    }
    return { img: cv, x: 0, y: 0, w: base.w, h: base.h };
  }
  zoneSprite(id) {
    const z = World.zone[id]; if (!z) return this.mirrorSprite(id);
    return this.zoneSpriteOf(id);
  }
  zoneSpriteOf(id) {
    const z = World.zone[id]; if (!z) return null;
    const img = this.zoneImgs.get(z[0]);
    if (img === undefined) { this.zoneImgs.set(z[0], null); E.image((this.stage.data.mapResources?.zoneRoot || 'assets/zones') + '/' + z[0]).then(i => { this.zoneImgs.set(z[0], i); this.loads++; }, () => {}); return null; }
    return img ? { img, x: z[1], y: z[2], w: z[3], h: z[4] } : null;
  }

  // ---- terrain: tiles + zones + desktop ----
  // flashing: our own areas blink (opening sequence). sel: one area or a Set/array of areas.
  // cam: the tilt view draws the map top-down into a texture with its own flat camera (layer3d.js), so the camera is a parameter
  // part: 'all', or 'base' (everything except the selection flash) / 'flash' (only the flash): the tilt view keeps the flash on its own canvas
  flashAlpha() { return Math.max(0, 1 - (1 - this.flashT) / (1 - OWN_ALPHA)); }
  flashSelection(sel) {
    const ids = sel instanceof Set ? [...sel] : Array.isArray(sel) ? sel : [sel];
    return { set: new Set(ids), key: ids.slice().sort((a, b) => a - b).join(',') };
  }
  releasePreviews() {
    for (const entry of this.reducedTiles?.values() || []) entry.canvas.width = entry.canvas.height = 0;
    this.reducedTiles?.clear(); this.reducedPixels = 0;
  }
  reducedImage(image, ratio, revision = 0) {
    let factor = 1;
    while (factor > .125 && ratio <= factor / 2) factor /= 2;
    if (factor === 1) return { image, factor: 1 };
    this.reducedTiles ||= new Map();
    let entry = this.reducedTiles.get(image);
    if (entry && entry.revision === revision && entry.factor === factor) {
      entry.used = this.reducedFrame; return { image: entry.canvas, factor };
    }
    if (entry) {
      this.reducedPixels -= entry.pixels; entry.canvas.width = entry.canvas.height = 0;
      this.reducedTiles.delete(image);
    }
    // Warm at most four previews per frame. Never delay a capture or display a
    // stale colour while warming: use the original texture until ready.
    if (this.reducedBuilds >= 4) return { image, factor: 1 };
    const width = Math.max(1, Math.ceil(image.width * factor)), height = Math.max(1, Math.ceil(image.height * factor)), pixels = width * height;
    this.reducedPixels ||= 0;
    const budget = 8 * 1024 * 1024; // 32 MiB of preview pixels per battlefield.
    if (this.reducedPixels + pixels > budget) {
      for (const [source, old] of this.reducedTiles) {
        // Keep previews used in the previous frame to avoid a full-map churn.
        if (old.used >= this.reducedFrame - 1) continue;
        this.reducedPixels -= old.pixels; old.canvas.width = old.canvas.height = 0; this.reducedTiles.delete(source);
        if (this.reducedPixels + pixels <= budget) break;
      }
      if (this.reducedPixels + pixels > budget) return { image, factor: 1 };
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    // Edge tiles can have odd dimensions; crop using the actual independent scales.
    entry = { canvas, factor, revision, pixels, used: this.reducedFrame };
    this.reducedTiles.set(image, entry); this.reducedPixels += pixels; this.reducedBuilds++;
    return { image: canvas, factor };
  }
  drawTerrain(c, { sel, flashing, visible, cam = this.cam, desk = true, part = 'all', flashAlpha = null }) {
    const z = cam.zoom, v = cam.view();
    if (part === 'flash') {
      // The base map already shows every area at OWN_ALPHA (see below), so the flash is drawn on top with the alpha that makes the sum equal
      // the original flash alpha (flashT): 1 - (1 - base)(1 - a) = flashT
      const a = flashAlpha ?? this.flashAlpha();
      c.save(); cam.apply(c); c.globalAlpha = a; for (const d of this.flashList(sel, flashing)) c.drawImage(d.cv, d.x, d.y); c.restore();
      return;
    }
    this.reducedFrame = (this.reducedFrame || 0) + 1; this.reducedBuilds = 0;
    const pixelScale = E.cv.width / Math.max(1, E.W);
    c.save(); cam.apply(c); if (desk) this.drawBox(c); this.drawPaperBorder(c); c.restore();   // desk = false: the 3D desk (layer3d.js) is already on the canvas
    const R = cam.screenRect();
    c.save(); c.beginPath(); c.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); c.clip();     // the map exists only inside the scene rect
    const R2 = tileRange(v);
    for (let cy = R2.cy0; cy <= R2.cy1; cy++)
      for (let cx = R2.cx0; cx <= R2.cx1; cx++) {
        const img = this.tile(cx, cy); if (!img) continue;
        const s = cam.toScreen(cx * TILE_STEP - TILE_PAD, cy * TILE_STEP - TILE_PAD), n = TILE_U * z;
        const small = this.reducedImage(img, z * pixelScale / 2);
        c.drawImage(small.image, Math.floor(s.x), Math.floor(s.y), Math.ceil(n) + 1, Math.ceil(n) + 1);
      }
    c.save(); cam.apply(c);
    const L = this.zoneLayers(), view = cam.view(), put = (layer, alpha) => {
      c.globalAlpha = alpha;
      for (const l of layer.tiles) {
        if (!l.cv || !l.painted || l.x > view.x1 || l.x + l.w < view.x0 || l.y > view.y1 || l.y + l.h < view.y0) continue;
        const small = this.reducedImage(l.cv, z * pixelScale, l.key);
        const sx = small.image.width / l.cv.width, sy = small.image.height / l.cv.height;
        c.drawImage(small.image, sx, sy, l.w * sx, l.h * sy, l.x, l.y, l.w, l.h);
      }
      c.globalAlpha = 1;
    };
    put(L.closed, CLOSED_ALPHA); put(L.owned, OWN_ALPHA);
    if (part === 'all') { c.globalAlpha = this.flashAlpha(); for (const d of this.flashList(sel, flashing)) c.drawImage(d.cv, d.x, d.y); c.globalAlpha = 1; }
    c.restore();
    c.restore();
  }

  // the areas that flash: the selected one, and (while they blink after the opening) all of ours; cached until the selection / ownership changes
  flashList(sel, flashing) {
    const selection = this.flashSelection(sel);
    const key = selection.key + '|' + flashing + '|' + this._layerKey + '|' + this.loads + '|' + this.zoneImgs.size;
    if (this._fl && this._fl.key === key) return this._fl.list;
    const st = this.stage, b = st.bounds, mine = st.humanCountries, list = [];
    for (const a of World.areas) {
      if (a.f === 1 || a.x > b.x1 || a.x + a.w < b.x0 || a.y > b.y1 || a.y + a.h < b.y0 || !st.enabled.has(a.id)) continue;
      const own = st.territoryOwner(a.id); if (!own || !(selection.set.has(a.id) || (flashing && mine.has(own)))) continue;
      const k = st.countries.get(own).color, cv = this.tinted(a.id, `rgb(${k[0]},${k[1]},${k[2]})`); if (cv) list.push({ cv, x: a.x, y: a.y });
    }
    this._fl = { key, list }; return list;
  }

  // Native-resolution tiles keep ownership changes from rewriting a world-size
  // texture. Selection/flash stays separate, and offscreen tiles are not blitted.
  zoneLayers() {
    // ownership is part of the key: captures that play no capture effect (skipped / fast AI turns, capitulation, peace transfers) must repaint too
    const loaded = this.zoneImgs.size + [...this.zoneImgs.values()].filter(Boolean).length;
    const intel = (this.game.fogOfWar && !this.game.bridgeSpectating) ? rememberVisibility(this.game, this.game.player) : null;
    const visionSig = intel ? [...intel.now].join(',') : '';
    const key = loaded + '|' + this.ownerSig() + '|' + visionSig;
    if (this._layerKey === key && this._layers) return this._layers;
    this.zoneRebuilds++;
    const st = this.stage, b = st.bounds, W = Math.ceil(b.x1 - b.x0), H = Math.ceil(b.y1 - b.y0), SIZE = 1024;
    if (!this._layers?.owned.tiles) {
      if (this._layers) for (const l of Object.values(this._layers)) if (l.cv) l.cv.width = l.cv.height = 0;
      const mk = () => ({ tiles: [] });
      this._layers = { closed: mk(), owned: mk() };
      for (let y = 0; y < H; y += SIZE) for (let x = 0; x < W; x += SIZE) {
        const tile = { x: b.x0 + x, y: b.y0 + y, w: Math.min(SIZE, W - x), h: Math.min(SIZE, H - y), key: null };
        this._layers.closed.tiles.push({ ...tile }); this._layers.owned.tiles.push({ ...tile });
      }
    }
    const entries = [];
    for (const a of World.areas) {
      if (a.f === 1 || a.x > b.x1 || a.x + a.w < b.x0 || a.y > b.y1 || a.y + a.h < b.y0) continue;
      const enabled = st.enabled.has(a.id), own = enabled && st.territoryOwner(a.id), fogged = !!intel && !intel.now.has(a.id);
      const color = own ? st.countries.get(own)?.color : null, sp = this.zoneSprite(a.id);
      entries.push({ a, enabled, own, color, fogged, sp,
        key: [a.id, enabled, own, color?.join(','), !own && fogged, !!sp].join(':') });
    }
    for (let i = 0; i < this._layers.owned.tiles.length; i++) {
      const owned = this._layers.owned.tiles[i], closed = this._layers.closed.tiles[i];
      // One-pixel gutters retain neighbouring texels during smooth downsampling.
      const nearby = entries.filter(({ a }) => a.x < owned.x + owned.w + 1 && a.x + a.w > owned.x - 1 && a.y < owned.y + owned.h + 1 && a.y + a.h > owned.y - 1);
      const tileKey = nearby.map(e => e.key).join('|');
      if (owned.key === tileKey) continue;
      this.zoneTileRebuilds = (this.zoneTileRebuilds || 0) + 1;
      for (const t of [owned, closed]) {
        if (!t.cv) { t.cv = document.createElement('canvas'); t.cv.width = t.w + 2; t.cv.height = t.h + 2; t.g = t.cv.getContext('2d'); }
        t.g.clearRect(0, 0, t.cv.width, t.cv.height); t.painted = false;
      }
      for (const e of nearby) {
        const { a, sp, own, color, enabled, fogged } = e, dx = a.x - owned.x + 1, dy = a.y - owned.y + 1;
        if (!sp) continue;
        if (!enabled) {
          if (this.game.sandbox) {
            const paper = this.tinted(a.id, 'rgb(232,221,192)');
            if (paper) { closed.g.save(); closed.g.globalAlpha = 0.5; closed.g.drawImage(paper, dx, dy); closed.g.restore(); }
          } else if (st.data.mapResources) {
            const shade = this.tinted(a.id, 'rgb(115,111,100)');
            if (shade) closed.g.drawImage(shade, dx, dy);
          } else closed.g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, dx, dy, sp.w, sp.h);
          closed.painted = true; continue;
        }
        if (!own) {
          if (fogged) { const shade = this.tinted(a.id, 'rgb(62,56,46)'); if (shade) { closed.g.globalAlpha = 0.58; closed.g.drawImage(shade, dx, dy); closed.g.globalAlpha = 1; closed.painted = true; } }
          continue;
        }
        const cv = this.tinted(a.id, `rgb(${color[0]},${color[1]},${color[2]})`);
        if (cv) { owned.g.drawImage(cv, dx, dy); owned.painted = true; }
      }
      owned.key = closed.key = tileKey;
    }
    this._layerKey = key;
    return this._layers;
  }
  ownerSig() {
    const st = this.stage; let h = 0;
    for (const id of st.enabled) { const o = st.territoryOwner(id); const k = o ? st.countries.get(o)?.color : null; h = (Math.imul(h, 31) + id * 7 + (o ? String(o).length * 131 + String(o).charCodeAt(0) * 17 + String(o).charCodeAt(String(o).length - 1) : 0) + (k ? k[0] * 3 + k[1] * 5 + k[2] : 0)) | 0; }
    return h;
  }
  tinted(id, color) {
    const key = id + '|' + color, hit = this.tintCache.get(key); if (hit) return hit;
    const sp = this.zoneSprite(id); if (!sp) return null;
    const cv = document.createElement('canvas'); cv.width = sp.w; cv.height = sp.h; const g = cv.getContext('2d');
    g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, sp.w, sp.h);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    this.tintCache.set(key, cv); return cv;
  }
  // Sample the same tinted zone over the same map tile at the same ownership alpha used by drawTerrain.
  // A country's representative land area is stable across its units, including armies on foreign/sea tiles.
  displayedTerritoryColor(countryId) {
    const country = this.stage.countries.get(countryId);
    if (!country?.color) return [122, 118, 114];
    this._territoryColors ||= new Map();
    const key = `${country.color.join(',')}|${this._layerKey}|${this.loads}`;
    const cached = this._territoryColors.get(countryId);
    if (cached?.key === key) return cached.rgb;
    let sample = null;
    for (const state of this.stage.areas) {
      const area = World.areas[state.id];
      if (state.country !== countryId || !area || area.f === 1) continue;
      sample = this.sampleTerritoryColor(area, country.color);
      if (sample) break;
    }
    // While a tile is loading, use the map's ownership opacity over its usual parchment ground.
    const rgb = sample?.rgb || country.color.slice(0, 3).map(v => Math.round(v * OWN_ALPHA + 210 * (1 - OWN_ALPHA)));
    this._territoryColors.set(countryId, { key, rgb, sample });
    return rgb;
  }
  sampleTerritoryColor(area, color) {
    const cv = this.tinted(area.id, `rgb(${color[0]},${color[1]},${color[2]})`);
    if (!cv) return null;
    const zone = cv.getContext('2d', { willReadFrequently: true });
    const anchor = area.pts?.[0] || [area.x + area.w / 2, area.y + area.h / 2];
    const points = [[anchor[0] - area.x, anchor[1] - area.y], [cv.width / 2, cv.height / 2]];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) points.push([cv.width * x / 4, cv.height * y / 4]);
    for (const [px, py] of points) {
      const lx = Math.floor(px), ly = Math.floor(py);
      if (lx < 0 || ly < 0 || lx >= cv.width || ly >= cv.height || zone.getImageData(lx, ly, 1, 1).data[3] < 240) continue;
      const wx = area.x + lx, wy = area.y + ly;
      const cx = Math.floor(wx / TILE_STEP), cy = Math.floor(wy / TILE_STEP);
      const tile = this.tile(cx, cy);
      if (!tile) continue;
      const sx = Math.floor((wx - cx * TILE_STEP + TILE_PAD) * 2);
      const sy = Math.floor((wy - cy * TILE_STEP + TILE_PAD) * 2);
      if (sx < 0 || sy < 0 || sx + 2 > tile.width || sy + 2 > tile.height) continue;
      this._territoryProbe ||= document.createElement('canvas');
      const probe = this._territoryProbe; probe.width = probe.height = 1;
      const g = probe.getContext('2d', { willReadFrequently: true });
      g.drawImage(tile, sx, sy, 2, 2, 0, 0, 1, 1);
      g.globalAlpha = OWN_ALPHA;
      g.drawImage(cv, lx, ly, 1, 1, 0, 0, 1, 1);
      g.globalAlpha = 1;
      return { rgb: [...g.getImageData(0, 0, 1, 1).data].slice(0, 3), areaId: area.id, x: wx, y: wy };
    }
    return null;
  }
  // Desktop background: single scaled desktop image with width and height proportional to map
  drawBox(c) {
    const img = this.desktop;
    if (!img) return;
    const b = this.stage.bounds;
    const ratio = Math.max(1.0, E.state?.desktopRatio ?? 1.5);
    const mapW = b.x1 - b.x0, mapH = b.y1 - b.y0;
    const dw = mapW * ratio;
    const dh = mapH * ratio;
    const midX = (b.x0 + b.x1) / 2;
    const midY = (b.y0 + b.y1) / 2;
    const dx = midX - dw / 2;
    const dy = midY - dh / 2;
    c.drawImage(img, dx, dy, dw, dh);
  }
  // Paper strip border surrounding the map bounds (box1, box2, box3)
  // Exact reproduction of EasyTech CBackground::RenderBox and ecImage::Render/RenderEx
  drawPaperBorder(c) {
    if (!this.paperBorder) return;
    const [B1, B2, B3] = this.paperBorder;
    if (!B1 || !B2 || !B3) return;
    const b = this.stage.bounds, x0 = b.x0, y0 = b.y0, w = b.x1 - b.x0, h = b.y1 - b.y0;

    // 1. Left & Right vertical borders (box3: logical 82x139, @2x source rect [0, 2, 164, 278])
    const rows = Math.ceil(h / 139);
    c.save();
    c.beginPath();
    c.rect(x0 - 82, y0, 82, h);
    c.clip();
    for (let i = 0; i < rows; i++) {
      c.drawImage(B3, 0, 2, 164, 278, x0 - 82, y0 + i * 139, 82, 139);
    }
    c.restore();

    c.save();
    c.beginPath();
    c.rect(x0 + w, y0, 82, h);
    c.clip();
    c.translate(x0 + w + 82, 0);
    c.scale(-1, 1);
    for (let i = 0; i < rows; i++) {
      c.drawImage(B3, 0, 2, 164, 278, 0, y0 + i * 139, 82, 139);
    }
    c.restore();

    // 2. Top & Bottom horizontal borders (box2: logical 139x82, @2x source rect [2, 0, 278, 164])
    const cols = Math.ceil(w / 139);
    c.save();
    c.beginPath();
    c.rect(x0, y0 - 82, w, 82);
    c.clip();
    for (let i = 0; i < cols; i++) {
      c.drawImage(B2, 2, 0, 278, 164, x0 + i * 139, y0 - 82, 139, 82);
    }
    c.restore();

    c.save();
    c.beginPath();
    c.rect(x0, y0 + h, w, 82);
    c.clip();
    c.translate(0, y0 + h + 82);
    c.scale(1, -1);
    for (let i = 0; i < cols; i++) {
      c.drawImage(B2, 2, 0, 278, 164, x0 + i * 139, 0, 139, 82);
    }
    c.restore();

    // 3. Four Corners (box1: logical 82x82, @2x source rect [0, 0, 164, 164])
    // Top-Left: Render(x0 - 82, y0 - 82)
    c.drawImage(B1, 0, 0, 164, 164, x0 - 82, y0 - 82, 82, 82);

    // Top-Right: RenderEx(x0 + w + 82, y0 - 82, PI / 2, 1.0, 1.0)
    c.save();
    c.translate(x0 + w + 82, y0 - 82);
    c.rotate(Math.PI / 2);
    c.drawImage(B1, 0, 0, 164, 164, 0, 0, 82, 82);
    c.restore();

    // Bottom-Right: RenderEx(x0 + w + 82, y0 + h + 82, PI, 1.0, 1.0)
    c.save();
    c.translate(x0 + w + 82, y0 + h + 82);
    c.rotate(Math.PI);
    c.drawImage(B1, 0, 0, 164, 164, 0, 0, 82, 82);
    c.restore();

    // Bottom-Left: RenderEx(x0 - 82, y0 + h + 82, PI * 1.5, 1.0, 1.0)
    c.save();
    c.translate(x0 - 82, y0 + h + 82);
    c.rotate(Math.PI * 1.5);
    c.drawImage(B1, 0, 0, 164, 164, 0, 0, 82, 82);
    c.restore();
  }
  setCardTargets(targets) { this.cardTargets = new Set(targets); this.vT = 0; }
  // ---- above the units: airport range circle, movement arrows, rocket-range markers ----
  drawTop(c, sel) {
    if (sel < 0 && !this.cardTargets.size) return;
    this.drawTopGround(c, sel); this.drawTopScreen(c, sel);
  }
  // the parts that lie on the map (airport range circle, movement / attack arrows): drawn in map units through `cam`
  drawTopGround(c, sel, cam = this.cam) {
    if (sel < 0) return;
    const st = this.stage.st(sel), a = World.areas[sel];
    c.save(); cam.apply(c);
    // airport: the bombing / paratrooper range circle, darkened inside (CScene::Render, radius = CCountry::AirstrikeRadius)
    if (st && st.construction === 'airport') { c.fillStyle = 'rgba(0,0,0,0.31)'; c.beginPath(); c.arc(a.pts[2][0], a.pts[2][1], this.game.airstrikeRadius(E.state.medalLevels), 0, Math.PI * 2); c.fill(); }
    const blue = this.army.arrow_blue, red = this.army.arrow_red;
    for (const [id, type] of this.targets) if (type === TARGET.MOVE && blue) this.drawArrowQuad(c, blue, sel, id); else if (type === TARGET.ATTACK && red) this.drawArrowQuad(c, red, sel, id);
    c.restore();
  }
  // bobbing arrows that stand over rocket-range / card targets: upright sprites, so their size follows the perspective at that spot
  drawTopScreen(c) {
    if (!this.targets.size && !this.cardTargets.size) return;
    const cam = this.cam, sc = (x, y) => cam.scaleAt(x, y);
    const sh = this.army.arrowshadow, ye = this.army.arrow_yellow;
    for (const [id, type] of this.targets) if (type === TARGET.ROCKET && ye) {
      const p = World.areas[id].pts[0], q = cam.toScreen(p[0], p[1]), z = sc(p[0], p[1]), S = z / UNIT_PX * 0.78;
      if (sh) E.drawFrame(sh, q.x - this.vT * 0.5 * z, q.y + this.vT * 0.5 * z, { scale: S });
      E.drawFrame(ye, q.x, q.y + this.vT * z, { scale: S });
    }
    const green = this.army.arrow_green;
    if (green) for (const id of this.cardTargets) {
      const p = World.areas[id].pts[0], q = cam.toScreen(p[0], p[1]), z = sc(p[0], p[1]);
      E.drawFrame(green, q.x, q.y + this.vT * z, { scale: z / UNIT_PX * 0.78 });
    }
  }
  // arrow quad (ecImage::Render4VC): transparent at the unit, opaque at the growing tip
  drawArrowQuad(c, img, sId, tId) {
    const s = World.areas[sId].pts[0], t = World.areas[tId].pts[0], dx = t[0] - s[0], dy = t[1] - s[1], len = Math.hypot(dx, dy) || 1;
    const px = -dy / len * 22, py = dx / len * 22;                     // direction rotated by 90 degrees, x22
    const T = this.arrowT, p = Math.min(T, 1), alpha = T <= 1 ? 1 : Math.abs(0.5 - (T - 1)) * 2;
    const v0 = { x: s[0] + px + p * (t[0] - s[0]), y: s[1] + py + p * (t[1] - s[1]) }, v1 = { x: s[0] - px + p * (t[0] - s[0]), y: s[1] - py + p * (t[1] - s[1]) }, v3 = { x: s[0] + px, y: s[1] + py };
    const iw = img.w, ih = img.h, L = this.arrowTmp || (this.arrowTmp = document.createElement('canvas'));
    L.width = iw; L.height = ih; const g = L.getContext('2d');
    g.clearRect(0, 0, iw, ih); g.drawImage(img.img, img.x, img.y, iw, ih, 0, 0, iw, ih);
    g.globalCompositeOperation = 'destination-in'; const gr = g.createLinearGradient(0, 0, 0, ih); gr.addColorStop(0, `rgba(255,255,255,${alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, iw, ih); g.globalCompositeOperation = 'source-over';
    c.save(); c.transform((v1.x - v0.x) / iw, (v1.y - v0.y) / iw, (v3.x - v0.x) / ih, (v3.y - v0.y) / ih, v0.x, v0.y); c.drawImage(L, 0, 0); c.restore();
  }
}
