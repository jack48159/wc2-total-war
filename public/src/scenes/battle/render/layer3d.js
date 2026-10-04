// The desk world of the battle scene, drawn with the plain 2D canvas (no WebGL): the desk, the dark room around it, and the MAP lying on it,
// all in the standing player's perspective (camera.js).
//
// Why no WebGL: putting a big texture on a plane costs an upload + mipmaps + a GL -> 2D canvas copy every time it changes, and that is what made
// this laggy on integrated graphics. Instead, the camera only pitches (no yaw, no roll), so every HORIZONTAL LINE of the ground stays horizontal and
// is scaled uniformly. The desk / map is therefore drawn as thin horizontal strips: each strip is a row range of the flat picture, scaled by the
// perspective factor of that row. All of it is ordinary drawImage between 2D canvases - it stays on the GPU, nothing is uploaded or read back.
//
// The map is still drawn by the original 2D code (tiles, zones, paper border): top-down into an off-screen canvas ("base"), over an area larger
// than the screen at the resolution the screen needs, and kept. Panning inside that area repaints nothing. The selection flash and the movement
// arrows are on a second canvas ("over") that is repainted every frame while they animate, so the big base never is.
//
// The 3D soldier / WebGL experiment lives in remake/backup/experiments_tilt_map/.
import { E } from '../../../core/index.js';
import { Camera, TABLE_MM } from './camera.js';
import { MAP_MM } from './accessories.js';
import { Perf } from '../../../core/perf.js';
// probes: every part of the ground is timed into Perf (g.* marks, reported in data/perf_report.json); ?exp=nofloor / nowall / nodesk / nomap
// switch one part off to compare
const probe = (name, fn) => { const t = performance.now(); fn(); Perf.mark(name, performance.now() - t); };

const ROOM = '#0b0704';
// The room round the table (setRoom; which room: render/rooms.js): its far wall (a painted frontal elevation) stands WALL_MM behind the desk's
// far edge on the floor, TABLE_MM below the desk top; room.floorFrac is the picture's row where the wall meets the floor, room.heightMM the
// real height from the floor to its top row. Seen through the same camera as everything else, so it moves with pan / zoom like a real wall;
// left and right it is continued by mirrored copies (the pictures' edges are plain wall).
const WALL_MM = 2500;
// The room's floor: a plane TABLE_MM below the desk top, from the far wall to under the camera, the room's repeating floor tile covering
// FLOOR_TILE_MM of floor.
const FLOOR_TILE_MM = 1200, FLOOR_STEP = 4;
const TEX = 2048, BORDER = 90;                    // max size of the map canvas; the paper border strip around the map rect (map units)
const TILE_MM = 600;                              // a seamless desk tile (assets/desktop/tiles/<id>.png) covers this much real desk: sharp wood grain instead of one stretched photo
const NATIVE = Infinity;                          // (was 2 = the tiles' own density; capping there made the base repaint every frame at high zoom and cost more than it gained)
const SHARP = 1.15, MARGIN = 0.6;                 // painted texels per screen pixel at the nearest point; extra area painted around the view (fraction)
const STEP = 2;                                   // strip height in device px
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const size = im => [im.naturalWidth || im.width, im.naturalHeight || im.height];

// half-size copies (mip levels) made on demand: drawing a strip that shrinks the picture a lot from level 0 would alias
class Levels {
  constructor(base) { this.pool = []; this.reset(base); }
  reset(base) { this.lv = [base]; }                       // new picture: the level canvases are kept and redrawn (no reallocation)
  get(i) {
    while (this.lv.length <= i) {
      const n = this.lv.length, p = this.lv[n - 1], [w, h] = size(p), cw = Math.max(1, Math.ceil(w / 2)), ch = Math.max(1, Math.ceil(h / 2));
      let c = this.pool[n]; if (!c) c = this.pool[n] = mk(cw, ch); else if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const g = c.getContext('2d'); g.clearRect(0, 0, cw, ch);
      g.imageSmoothingQuality = 'high'; g.drawImage(p, 0, 0, cw, ch); this.lv.push(c);
    }
    return this.lv[Math.min(i, this.lv.length - 1)];
  }
}

// A layer painted over the base map: the selection flash, or the movement arrows. It has its own small canvas, covering only `bounds` (the
// area of the selected army and its targets), aligned to the base map's texel grid, and is drawn as strips like the base.
//   flash: painted ONCE per selection at full alpha; the pulsing is just the alpha it is drawn with, so it costs nothing per frame to animate
//   arrows: repainted every frame while there are arrows (their tip grows), but on a canvas only as big as the arrows
class Overlay {
  constructor(layer) { this.L = layer; this.cv = mk(64, 64); this.g = this.cv.getContext('2d'); this.on = false; this.key = null; this.ver = -1; this.paints = 0; }
  update(bounds, key, paint) {
    const L = this.L, RG = L.region; if (!RG) return;
    if (this.on && this.key === key && this.ver === L.baseVer) return;
    const b = bounds || RG, ppu = RG.ppu;
    const x0 = Math.max(RG.x0, Math.floor(b.x0 * ppu) / ppu), y0 = Math.max(RG.y0, Math.floor(b.y0 * ppu) / ppu), x1 = Math.min(RG.x1, b.x1), y1 = Math.min(RG.y1, b.y1);
    this.key = key; this.ver = L.baseVer;
    if (x1 - x0 < 1 || y1 - y0 < 1) { this.on = false; return; }
    const tw = Math.ceil((x1 - x0) * ppu), th = Math.ceil((y1 - y0) * ppu), cw = Math.ceil(tw / 64) * 64, ch = Math.ceil(th / 64) * 64;
    if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
    this.R = { x0, y0, x1: x0 + tw / ppu, y1: y0 + th / ppu, ppu, tw, th };
    L.withFlat(this.g, this.R, paint);
    this.on = true; this.paints++;
  }
  clear() { this.on = false; this.key = null; }
  draw(c, alpha = 1) {
    if (!this.on || alpha <= 0) return;
    const R = this.R, P = { lv: { get: () => this.cv }, x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, pX: R.ppu, pY: R.ppu };
    // The flash only pulses in ALPHA; its perspective shape is fixed until the camera moves or its content is repainted. Warping it into strips
    // every frame (hundreds of clip+drawImage) is what made the post-battle blink stutter in 3D, so cache the warp once and just blit it.
    if (this.cacheable) {
      const cv = E.cv, key = this.L.camKey() + '|' + this.paints + '|' + R.x0 + ',' + R.y0 + ',' + R.x1 + ',' + R.y1 + ',' + R.ppu;
      if (this.pkey !== key) {
        const pc = this.pcache || (this.pcache = mk(cv.width, cv.height));
        if (pc.width !== cv.width || pc.height !== cv.height) { pc.width = cv.width; pc.height = cv.height; }
        const g = pc.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, pc.width, pc.height);
        g.setTransform(cv.width / E.W, 0, 0, cv.height / E.H, 0, 0); this.L.drawPlane(g, P, 0);
        this.pkey = key;
      }
      c.save(); c.globalAlpha = alpha; c.drawImage(this.pcache, 0, 0, E.W, E.H); c.restore();
      return;
    }
    c.save(); c.globalAlpha = alpha;
    this.L.drawPlane(c, P, 0);
    c.restore();
  }
}

export class Layer3D {
  // deskImg: the desk texture (an <img>); acc: the AccessoryLayer (desk rect)
  static create(cam, bounds, deskImg, acc, tile = null) { return new Layer3D(cam, bounds, deskImg, acc, tile); }

  constructor(cam, bounds, deskImg, acc, tile = null) {
    this.cam = cam; this.acc = acc; this.bounds = bounds;
    this.flat = new Camera(bounds); this.flat.tilt = false; this.flat.desk3d = false;    // the flat top-down camera the map is drawn with
    this.base = mk(64, 64); this.baseCtx = this.base.getContext('2d');
    this.flash = new Overlay(this); this.flash.cacheable = !E.exp('flashwarp');   // the flash pulses only in alpha -> cache its perspective warp (see Overlay.draw). ?exp=flashwarp restores the old per-frame warp. Arrows are always uncached (their tip grows).
    this.arrows = new Overlay(this);
    this.baseVer = 0; this.deskVer = 0; this.repaints = 0;
    this.setDesk(deskImg, tile);
  }

  // the desk texture changed (Options > 特效 > 桌面)
  // tile: an optional seamless tile of the same desk; when there is one it is repeated at real size instead of stretching the whole photo
  setDesk(img, tile = null) {
    this.deskImg = img; this.deskLv = new Levels(img); this.tileLv = tile ? new Levels(tile) : null; this.tileSize = tile ? size(tile) : null; this.patterns = new WeakMap();
    this.deskVer++; this.cacheKey = null;
  }
  // the repeating pattern of a tile level for a context
  pattern(c, lvl) {
    let m = this.patterns.get(c); if (!m) this.patterns.set(c, m = []);
    return m[lvl] || (m[lvl] = c.createPattern(this.tileLv.get(lvl), 'repeat'));
  }

  camKey() { const c = this.cam; return `${c.x}|${c.y}|${c.zoom}|${E.W}|${E.H}`; }

  // The part of the map that is on screen: the visible desk quad clipped to the map rect + its paper border, and the highest magnification
  // (screen px per map unit) in it. null if none of the map is visible.
  needRect() {
    const cam = this.cam, b = this.bounds, quad = cam.groundQuad(), xs = quad.map(p => p.x), ys = quad.map(p => p.y);
    const x0 = Math.max(Math.min(...xs), b.x0 - BORDER), x1 = Math.min(Math.max(...xs), b.x1 + BORDER);
    const y0 = Math.max(Math.min(...ys), b.y0 - BORDER), y1 = Math.min(Math.max(...ys), b.y1 + BORDER);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x0, y0, x1, y1, near: Math.max(...[[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => cam.project(x, y).k)) };
  }
  covers(N, key, ignoreKey = false) {
    const R = this.region;
    const need = Math.min(N.near * SHARP, NATIVE);                    // the texel density wanted now, compared with what was wanted when the region was painted
    return !!R && (ignoreKey || R.key === key) && N.x0 >= R.x0 - 0.5 && N.x1 <= R.x1 + 0.5 && N.y0 >= R.y0 - 0.5 && N.y1 <= R.y1 + 0.5 && need <= R.need * 1.1 && R.need <= need * 3;
  }

  // run fn(g, flatCam) with the flat camera looking at the painted region and E.ctx / E.W / E.H temporarily being that canvas
  withFlat(g, R, fn) {
    const flat = this.flat, save = { ctx: E.ctx, W: E.W, H: E.H };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.save(); g.beginPath(); g.rect(0, 0, R.tw, R.th); g.clip();
    E.ctx = g; E.W = R.tw; E.H = R.th; flat.zoom = R.ppu; flat.x = R.x0 + R.tw / R.ppu / 2; flat.y = R.y0 + R.th / R.ppu / 2; flat._rigKey = null; flat._view = null;
    try { fn(g, flat); } finally { E.ctx = save.ctx; E.W = save.W; E.H = save.H; g.restore(); }
  }

  // Paint the flat map (without the flash) into `base`: an area around N, as large as the canvas allows at the needed resolution.
  paintBase(paint, N, key) {
    const b = this.bounds, mx0 = b.x0 - BORDER, mx1 = b.x1 + BORDER, my0 = b.y0 - BORDER, my1 = b.y1 + BORDER;
    const nw = N.x1 - N.x0, nh = N.y1 - N.y0;
    const ppu = Math.max(0.02, Math.min(N.near * SHARP, NATIVE, TEX / Math.max(nw, nh))), S = TEX / ppu;
    const fit = (n0, n1, want, lo, hi) => {                                   // a window of length `want` around [n0, n1], kept inside [lo, hi]
      let a = (n0 + n1) / 2 - want / 2, z = a + want;
      if (a < lo) { z += lo - a; a = lo; }
      if (z > hi) { a -= z - hi; z = hi; }
      return [Math.max(a, lo), Math.min(z, hi)];
    };
    const [fx0, rx1] = fit(N.x0, N.x1, Math.min(S, nw * (1 + 2 * MARGIN)), mx0, mx1), [fy0, ry1] = fit(N.y0, N.y1, Math.min(S, nh * (1 + 2 * MARGIN)), my0, my1);
    const rx0 = Math.floor(fx0 * ppu) / ppu, ry0 = Math.floor(fy0 * ppu) / ppu;               // the region starts on a whole texel: at 2 texels / unit the tiles land 1:1
    const tw = Math.min(TEX, Math.ceil((rx1 - rx0) * ppu)), th = Math.min(TEX, Math.ceil((ry1 - ry0) * ppu));
    const cw = Math.ceil(tw / 64) * 64, ch = Math.ceil(th / 64) * 64;         // canvases rounded up so they are rarely reallocated
    if (this.base.width !== cw || this.base.height !== ch) { this.base.width = cw; this.base.height = ch; }
    const R = this.region = { x0: rx0, y0: ry0, x1: rx0 + tw / ppu, y1: ry0 + th / ppu, ppu, need: Math.min(N.near * SHARP, NATIVE), key, tw, th, cw, ch };
    this.withFlat(this.baseCtx, R, paint);
    if (this.baseLv) this.baseLv.reset(this.base); else this.baseLv = new Levels(this.base);
    this.baseVer++; this.repaints++;
  }
  // ---- drawing ----
  // Draw a flat picture P = { lv: Levels, x0, y0, x1, y1 (desk rect it covers), pX, pY (texels per map unit) } lying on the desk, as strips.
  drawPlane(c, P, maxLevel = 4) {
    const cam = this.cam, R = cam.rig, W = E.W, H = E.H, rowY = sy => cam.toWorldWith(R, W / 2, sy).y;
    const yTop = Math.max(P.y0, rowY(0)), yBot = Math.min(P.y1, rowY(H));      // the rows of the picture that are on screen
    if (yBot <= yTop) return;
    // the strips' ends are stair-stepped on a slanted edge: clip to the plane's exact outline (a clip is antialiased), and let the edge strips
    // reach a few px past it so the clip, not the strip end, decides where the edge is
    const o0 = cam.project(P.x0, yTop), o1 = cam.project(P.x1, yTop), o2 = cam.project(P.x1, yBot), o3 = cam.project(P.x0, yBot);
    c.save(); c.beginPath(); c.moveTo(o0.x, o0.y); c.lineTo(o1.x, o1.y); c.lineTo(o2.x, o2.y); c.lineTo(o3.x, o3.y); c.closePath(); c.clip();
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = P.smooth || 'low';
    // strips start and end on whole DEVICE pixels, so neighbours abut exactly (no seam, no overlap: an overlap would blend a translucent layer twice)
    const sc = E.cv.width / E.W, dTop = Math.max(0, Math.floor(cam.project(cam.x, yTop).y * sc)), dBot = Math.min(Math.floor(H * sc), Math.ceil(cam.project(cam.x, yBot).y * sc));
    let ya = Math.max(P.y0, rowY(dTop / sc));
    for (let d0 = dTop; d0 < dBot; d0 += STEP) {
      const d1 = Math.min(d0 + STEP, dBot), sy0 = d0 / sc, sy1 = d1 / sc, yb = Math.min(P.y1, rowY(sy1));
      if (yb > ya) {
        const k = cam.project(cam.x, (ya + yb) / 2).k;                          // px per map unit along this row
        const xa = Math.max(P.x0, cam.x - (W / 2 + 2) / k), xb = Math.min(P.x1, cam.x + (W / 2 + 2) / k);
        if (xb > xa) {
          const m = Math.min(P.pX / k, (yb - ya) * P.pY / (sy1 - sy0)), lvl = m >= 2 ? Math.min(maxLevel, Math.floor(Math.log2(m))) : 0, f = 2 ** lvl, src = P.lv.get(lvl);
          const el = xa === P.x0 ? 3 : 0, er = xb === P.x1 ? 3 : 0;
          if (P.tiled) {                                                       // a repeating pattern, placed so that texel (0,0) is at the plane's corner
            const dh = sy1 - sy0, pat = this.pattern(c, lvl);
            pat.setTransform(new DOMMatrix([k * f / P.pX, 0, 0, f * dh / (P.pY * (yb - ya)), W / 2 + (P.x0 - cam.x) * k, sy0 + (P.y0 - ya) * dh / (yb - ya)]));
            c.fillStyle = pat; c.fillRect(W / 2 + (xa - cam.x) * k - el, sy0, (xb - xa) * k + el + er, dh);
          } else
          c.drawImage(src, (xa - P.x0) * P.pX / f, (ya - P.y0) * P.pY / f, (xb - xa) * P.pX / f, (yb - ya) * P.pY / f,
            W / 2 + (xa - cam.x) * k - el, sy0, (xb - xa) * k + el + er, sy1 - sy0);
        }
      }
      ya = Math.max(ya, yb);
    }
    c.restore();
  }
  // room: null (the dark void), or { wall, floor, floorFrac, heightMM } (render/rooms.js)
  setRoom(room) {
    this.room = room; this.floorPat = new WeakMap(); this.floorMip = null; this.deskVer++;
    // The floor tile as ImageBitmaps, decoded ONCE: level 0 (full size) and its mip levels. Filled straight from the <img> (a JPEG), the browser
    // re-decoded it every frame - the whole 3D lag of the floor (75-135 ms a frame vs 13 without it, in the frame loop; an isolated bench
    // drawing it 10x in a row did not show it). ?exp=floorimg: the <img> again; ?exp=floornomip: level 0 only.
    const img = room && room.floor;
    if (img && window.createImageBitmap && !E.exp('floorimg')) {
      const [w, h] = size(img), n = E.exp('floornomip') ? 0 : Math.max(1, Math.floor(Math.log2(Math.min(w, h) / 8)));
      Promise.all([createImageBitmap(img), ...[...Array(n)].map((_, i) => createImageBitmap(img, { resizeWidth: Math.max(1, w >> (i + 1)), resizeHeight: Math.max(1, h >> (i + 1)), resizeQuality: 'high' }))])
        .then(lv => { if (this.room === room) { this.floorMip = lv; this.floorPat = new WeakMap(); this.deskVer++; this.cacheKey = null; } }).catch(() => {});
    }
    this.cacheKey = null;
  }
  // The floor plane at height hf = -TABLE_MM, drawn in horizontal screen strips: each strip's rows are the rays through that screen row, where
  // they hit the floor (like drawPlane does for the desk, but at the floor's height), from the far wall down to the bottom of the screen.
  // Cost (probe g.floor): each strip is a pattern fill over the full width. The desk is drawn over the floor right after, so in the rows the desk
  // covers only the floor left / right of it is filled - that took the floor from the most expensive part of the 3D view to a small one.
  // Cost history (probe g.floor; A/B in public/exp.html group C): the floor was the whole 3D lag. On a canvas rasterised on the CPU a
  // pattern fill with a transform is a slow path (60-120 ms a frame); the strips are now drawImage from a pre-repeated strip of the tile
  // (fast path, like the desk and map), with mip levels (ImageBitmaps, setRoom), and the rows the desk hides are skipped.
  //   ?exp=floorpattern: pattern fills   ?exp=floornomip: no mip levels   ?exp=floorold: the first version   ?exp=nofloor
  drawFloor(c) {
    const img = this.room && this.room.floor; if (!img || !img.width) return;
    const sc = E.cv.width / E.W;
    const old = E.exp('floorold');
    const cam = this.cam, R = cam.rig, W = E.W, H = E.H, upm = cam.upm, hf = -TABLE_MM * upm, d = this.acc.desk();
    const yWall = d.y0 - WALL_MM * upm;
    const rowY = sy => { const b = -(sy - H / 2) / R.focal, dy = R.f.y + b * R.u.y, dz = R.f.z + b * R.u.z; return dy < -1e-6 ? R.eye.z + (hf - R.eye.y) / dy * dz : null; };
    const wallRow = cam.project(cam.x, yWall, hf); if (!(wallRow.depth > 0)) return;
    const mip = !old && this.floorMip;
    let pats = this.floorPat.get(c); if (!pats) this.floorPat.set(c, pats = []);
    const patOf = lvl => pats[lvl] || (pats[lvl] = c.createPattern(mip ? mip[lvl] : img, 'repeat'));
    // The fills: a pattern fill with a transform is a slow path when the canvas is rasterised on the CPU (the floor cost 60-120 ms a frame that
    // way, a plain colour fill of the same strips ~0). drawImage of a plain scaled rectangle is the fast path the desk and the map use, so each
    // level gets a "strip": the tile repeated side by side, wide enough for a whole screen row (~2 screen widths of texels + one tile).
    // ?exp=floorpattern: the pattern fills.
    const strip = !old && !E.exp('floorpattern') && mip ? lvl => {
      const t = mip[lvl], [w1, h1] = size(t), need = Math.ceil((2 * E.cv.width + w1) / w1) * w1;
      const S = this.floorStrip || (this.floorStrip = []);
      let cv = S[lvl];
      if (!cv || cv.src !== t || cv.width < need) {
        cv = S[lvl] = mk(need, h1); cv.src = t; const g = cv.getContext('2d');
        for (let x = 0; x < need; x += w1) g.drawImage(t, x, 0);
      }
      return cv;
    } : null;
    // the desk top's outline on screen, for rows it covers fully between its far and near edge: x range per screen row (desk top is at h = 0)
    const deskRowY = sy => cam.toWorldWith(R, W / 2, sy).y;
    const pf = cam.project(cam.x, d.y0), pn = cam.project(cam.x, d.y1);
    const deskTop = pf.depth > 0 ? pf.y : -Infinity, deskBot = pn.depth > 0 ? pn.y : Infinity;
    const tileU = FLOOR_TILE_MM * upm, [tw, th] = size(img);
    const d0 = Math.max(0, Math.floor(wallRow.y * sc)), d1 = Math.ceil(H * sc);
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low';
    for (let dv = d0; dv < d1; dv += FLOOR_STEP) {
      const sy0 = dv / sc, sy1 = Math.min(d1, dv + FLOOR_STEP) / sc, ya = rowY(sy0), yb = rowY(sy1); if (ya == null || yb == null || yb <= ya) continue;
      const k = cam.project(cam.x, (ya + yb) / 2, hf).k, dh = sy1 - sy0;
      // where the desk hides this strip completely (all its height), fill only the floor outside the desk's left / right edge
      let xs = [[0, W]];
      if (!old && sy0 >= deskTop && sy1 <= deskBot) {
        const ra = deskRowY(sy0), rb = deskRowY(sy1), ka = cam.project(cam.x, ra).k, kb = cam.project(cam.x, rb).k;
        const L = Math.max(W / 2 + (d.x0 - cam.x) * ka, W / 2 + (d.x0 - cam.x) * kb), Rr = Math.min(W / 2 + (d.x1 - cam.x) * ka, W / 2 + (d.x1 - cam.x) * kb);
        xs = [[0, Math.min(W, L + 2)], [Math.max(0, Rr - 2), W]].filter(([a, b]) => b > a);
      }
      if (!xs.length) continue;
      // the mip level: the tile halved until about one texel per screen px along the row (strong minification is what makes a fill slow)
      const m = mip ? Math.min(tw / (k * tileU), th * (yb - ya) / (tileU * dh)) : 1, lvl = m >= 2 ? Math.min(mip.length - 1, Math.floor(Math.log2(m))) : 0;
      const tx = tw / 2 ** lvl, ty = th / 2 ** lvl;
      if (strip) {
        // drawImage from the level's strip (the tile repeated side by side): texel u at screen x, v at floor y; a strip whose rows cross the
        // tile's bottom edge is drawn in two parts
        const src = strip(lvl), uPerPx = tx / (k * tileU), uAt = x => (R.eye.x + (x - W / 2) / k) * tx / tileU;
        let v0 = (ya * ty / tileU) % ty; if (v0 < 0) v0 += ty;
        const vh = (yb - ya) * ty / tileU, parts = v0 + vh <= ty ? [[v0, vh, sy0, dh]] : [[v0, ty - v0, sy0, dh * (ty - v0) / vh], [0, v0 + vh - ty, sy0 + dh * (ty - v0) / vh, dh * (v0 + vh - ty) / vh]];
        for (const [a, b] of xs) {
          let u0 = uAt(a) % tx; if (u0 < 0) u0 += tx;
          const uw = Math.min((b - a) * uPerPx, src.width - u0);
          for (const [pv, ph, py, pdh] of parts) if (ph > 0 && pdh > 0) c.drawImage(src, u0, pv, uw, ph, a, py, uw / uPerPx, pdh + (py + pdh >= sy1 - 1e-6 ? 0.5 / sc : 0));
        }
      } else {
        const pat = patOf(lvl);
        pat.setTransform(new DOMMatrix([k * tileU / tx, 0, 0, dh * tileU / ty / (yb - ya), W / 2 - R.eye.x * k, sy0 - ya * dh / (yb - ya)]));
        c.fillStyle = pat;
        for (const [a, b] of xs) c.fillRect(a, sy0, b - a, dh + 0.5 / sc);
      }
    }
    c.restore();
  }
  // the far wall, a billboard: one perspective scale taken where it meets the floor under the desk's centre line
  drawBackdrop(c) {
    const R0 = this.room, img = R0 && R0.wall; if (!img || !img.width) return;
    const d = this.acc.desk(), upm = this.cam.upm, x = (d.x0 + d.x1) / 2, y = d.y0 - WALL_MM * upm;
    const p = this.cam.project(x, y, -TABLE_MM * upm); if (!(p.depth > 0)) return;
    const floorRow = R0.floorFrac * img.height, sc = R0.heightMM / floorRow * upm * p.k, w = img.width * sc, h = img.height * sc, top = p.y - floorRow * sc;
    if (top > E.H || top + h < 0) return;
    let x0 = p.x - w / 2; while (x0 > 0) x0 -= 2 * w;                                                  // start left of the screen on an unmirrored tile
    for (let i = 0, xs = x0; xs < E.W; i++, xs += w) {
      if (xs + w < 0) continue;
      const mirror = Math.round((xs - (p.x - w / 2)) / w) % 2 !== 0;                                 // tiles alternate plain / mirrored about the centre one
      if (mirror) { c.save(); c.translate(xs + w, top); c.scale(-1, 1); c.drawImage(img, 0, 0, w, h); c.restore(); }
      else c.drawImage(img, xs, top, w, h);
    }
  }
  strips(c) {
    Perf.mark('n.strips', 1);                                               // how many full ground passes this frame (0 = the cached frame was reused)
    c.fillStyle = ROOM; c.fillRect(0, 0, E.W, E.H);
    if (!E.exp('nofloor')) probe('g.floor', () => this.drawFloor(c));
    if (!E.exp('nowall')) probe('g.wall', () => this.drawBackdrop(c));
    const d = this.acc.desk();
    if (!E.exp('nodesk')) probe('g.desk', () => {
      this.drawDeskEdges(c, d);
      if (this.tileLv) {                                                     // the seamless tile, repeated at TILE_MM of real desk per tile
        const [tw, th] = this.tileSize, uw = TILE_MM * (this.bounds.x1 - this.bounds.x0) / MAP_MM, uh = uw * th / tw;
        this.drawPlane(c, { lv: this.tileLv, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, pX: tw / uw, pY: th / uh, tiled: true });
      } else {
        const [iw, ih] = size(this.deskImg);
        this.drawPlane(c, { lv: this.deskLv, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, pX: iw / (d.x1 - d.x0), pY: ih / (d.y1 - d.y0) });
      }
    });
    const R = this.region; if (!R || E.exp('nomap')) return;
    probe('g.map', () => this.drawPlane(c, { lv: this.baseLv, x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, pX: R.ppu, pY: R.ppu }));
  }
  drawDeskEdges(c, d) {
    const drop = 38 * this.cam.upm, corners = [[d.x0,d.y0],[d.x1,d.y0],[d.x1,d.y1],[d.x0,d.y1]];
    const top = corners.map(([x,y]) => this.cam.project(x,y,0));
    const bottom = corners.map(([x,y]) => this.cam.project(x,y,-drop));
    if (top.some(p => p.depth <= 0) || bottom.some(p => p.depth <= 0)) return;
    c.save(); c.fillStyle = this.deskImg.edgeColor || '#382719';
    for (const [a,b] of [[0,1],[1,2],[3,0],[2,3]]) {
      c.beginPath(); c.moveTo(top[a].x,top[a].y); c.lineTo(top[b].x,top[b].y);
      c.lineTo(bottom[b].x,bottom[b].y); c.lineTo(bottom[a].x,bottom[a].y);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,232,186,.25)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(top[a].x,top[a].y); c.lineTo(top[b].x,top[b].y); c.stroke();
    }
    c.restore();
  }

  // Draws desk + map into `c`.
  //   paints.base(g, flatCam): the flat map without the selection flash
  //   baseKey: everything (besides the camera) that changes the base
  //   over: null, or { flash: { key, bounds, paint, alpha }, arrows: { key, bounds, paint } } (either may be null): the layers over the base
  renderGround(c, paints, baseKey = '', over = null) {
    const N = this.needRect();
    if (N && !this.covers(N, baseKey)) {
      // When only the content changed (a tile / zone image arrived) and the view is still covered, repaint at most ~3 times a second:
      // entering a battle loads hundreds of images and painting the whole map for each one froze the game.
      const now = performance.now(), contentOnly = this.covers(N, baseKey, true);
      if (!(contentOnly && now - (this.lastPaint || 0) < 330)) { probe('g.paintBase', () => this.paintBase(paints.base, N, baseKey)); this.lastPaint = now; }
    }
    if (this.region) {
      const tu = performance.now();
      if (over && over.flash) this.flash.update(over.flash.bounds, over.flash.key, over.flash.paint); else this.flash.clear();
      if (over && over.arrows) this.arrows.update(over.arrows.bounds, over.arrows.key, over.arrows.paint); else this.arrows.clear();
      this.glRenders = this.flash.paints + this.arrows.paints; Perf.mark('g.overPaint', performance.now() - tu);
    }
    const ck = this.camKey(), key = `${ck}|${this.baseVer}|${this.deskVer}`;                 // the static part: desk + base map
    this.still = ck === this.lastCam ? (this.still || 0) + 1 : 0; this.lastCam = ck;
    if (this.cache && this.cacheKey === key && !E.exp('nogroundcache')) probe('g.cached', () => c.drawImage(this.cache, 0, 0, E.W, E.H));          // nothing static changed: one drawImage
    else {
      this.strips(c);
      if (this.still >= 2) {                                                                     // the camera has rested: keep the frame
        const cv = E.cv, cache = this.cache || (this.cache = mk(cv.width, cv.height));
        if (cache.width !== cv.width || cache.height !== cv.height) { cache.width = cv.width; cache.height = cv.height; }
        const g = cache.getContext('2d'); g.setTransform(cv.width / E.W, 0, 0, cv.height / E.H, 0, 0); const t = performance.now(); this.strips(g); Perf.mark('g.cacheFill', performance.now() - t); this.cacheKey = key;
      }
    }
    probe('g.flash', () => this.flash.draw(c, over && over.flash ? over.flash.alpha : 1));    // the flash: drawn with the pulsing alpha, never repainted for it
    probe('g.arrows', () => this.arrows.draw(c));
  }

  glInfo() { return '2D 画布条带绘制（不使用 WebGL）'; }
  dispose() {}
}
