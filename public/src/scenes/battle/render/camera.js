// Pan / zoom over the world in map units, limited to the stage's scene rect.
import { E } from '../../../core/index.js';
import { MAP_MM } from './accessories.js';

export const BOX = 1500;               // legacy constant (kept for UNIT_PX co-export); no longer used for frame rendering
export const UNIT_PX = 2;            // @2x art pixels per map unit (world tiles: 1024px = 512 units)

// ---- the player's body (tilt view) ----
// A 175 cm player stands at the near (+y) edge of a 100 cm high table (eyes 165 cm, i.e. 65 cm over the desk). Zooming is his posture:
//  - zoomed in, he is bent over the map: eyes D_MIN_MM from the focus, gaze PITCH_BENT (36 deg) down; further zoom only narrows the view;
//  - zooming out, he straightens up: the eyes rise and the gaze lifts, until he stands upright (eyes 65 cm over the desk) looking across the
//    table at PITCH_UP (18 deg) - the zoom floor (minZoom). This slightly higher gaze reveals more of the room wall.
//  - he stays at the table: never so far back that the floor in front of it shows (see nearLimit). The characters sitting at the desk's two
//    SIDES are reached by dragging left / right: the focus may travel the whole width of the desk (see stayAtTable).
// The map is still DRAWN by the original flat 2D code, but into a texture that lies on the desk (layer3d.js), so everything on the desk -
// the map, the accessories, the desk itself - gets the same perspective (near big, far small). The units are the original 2D icons, standing
// upright on the map at the perspective scale of their spot.
export const TABLE_MM = 1000, PLAYER_EYE_MM = 1650;
export const EYE_ABOVE_MM = PLAYER_EYE_MM - TABLE_MM;
const PITCH_BENT = 36 * Math.PI / 180, PITCH_UP = 18 * Math.PI / 180;   // gaze below horizontal: bent over the map / standing upright
const D_MIN_MM = 450, D_MAX_MM = EYE_ABOVE_MM / Math.sin(PITCH_UP);      // eye distance from the focus: fully bent / standing upright
const TAN_REF = Math.tan(25 * Math.PI / 180);          // natural vertical half field of view (50 deg)

export class Camera {
  constructor(bounds) {
    this.bounds = bounds; this.x = 4000; this.y = 1750; this.zoom = 2.5; this.bouncing = false;
    this.tilt = false;                                   // true: the whole map in the standing-player perspective (unused: the map stays flat, see desk3d)
    this.desk3d = true;                                  // the desk, the room and the accessories are 3D (layer3d.js) behind / over the flat 2D map
    this.upm = (bounds.x1 - bounds.x0) / MAP_MM;         // map units per mm of the 1200 mm paper map
  }

  // ---- tilt view: camera rig + projection ----
  // Rig for a focus point (fx, fy) on the desk and a zoom. `zoom` keeps its meaning: pixels per map unit on the ground at the focus.
  rigAt(fx, fy, zoom) {
    const H = E.H, upm = this.upm, Dmm = Math.max(H / 2 / TAN_REF / zoom / upm, D_MIN_MM), D = Dmm * upm;
    const th = this.pitchAt(Dmm);                                                                    // the posture's gaze angle
    const s = Math.sin(th), c = Math.cos(th);
    // the player stands on the +y side (screen bottom) and looks toward -y; screen right = +x
    return { fx, fy, zoom, D, th, eye: { x: fx, y: D * s, z: fy + D * c }, f: { y: -s, z: -c }, u: { y: c, z: -s }, focal: zoom * D, eyeMm: D * s / upm };
  }
  get rig() {
    const k = this.x + '|' + this.y + '|' + this.zoom + '|' + E.H + '|' + (E.camTune && E.camTune.pitch);
    if (this._rigKey !== k) { this._rigKey = k; this._rig = this.rigAt(this.x, this.y, this.zoom); this._view = null; }
    return this._rig;
  }
  // world point (x, h above the desk, z = map y) -> { x, y screen, k = px per map unit at that depth }
  project(ux, uy, h = 0, r = this.rig) {
    const vy = h - r.eye.y, vz = uy - r.eye.z, zc = vy * r.f.y + vz * r.f.z, yc = vy * r.u.y + vz * r.u.z, k = r.focal / zc;
    return { x: E.W / 2 + (ux - r.eye.x) * k, y: E.H / 2 - yc * k, k, depth: zc };
  }
  // screen point -> desk point under it (rays that miss the desk are clamped far away)
  toWorldWith(r, sx, sy) {
    const a = (sx - E.W / 2) / r.focal, b = -(sy - E.H / 2) / r.focal, dy = r.f.y + b * r.u.y, dz = r.f.z + b * r.u.z;
    const t = dy < -1e-4 ? -r.eye.y / dy : 40 * r.D;
    return { x: r.eye.x + t * a, y: r.eye.z + t * dz };
  }
  // The 3D desk world (desk, map texture, accessories) through the rig. h = height above the desk. Returns the screen point and
  // k = px per map unit there (sizes of things standing at that spot).
  warp(ux, uy, h = 0) { return this.project(ux, uy, h); }
  toScreen3(ux, uy, h = 0) { return this.project(ux, uy, h); }
  scale3(ux, uy) { return this.project(ux, uy).k; }
  toWorld3(sx, sy) { return this.toWorldWith(this.rig, sx, sy); }
  // pixels per map unit for an upright object standing at the ground point (ux, uy)
  scaleAt(ux, uy) { return this.tilt ? this.project(ux, uy).k : this.zoom; }
  // the visible ground: four corner points (screen top-left, top-right, bottom-right, bottom-left)
  groundQuad() { const r = this.rig; return [[0, 0], [E.W, 0], [E.W, E.H], [0, E.H]].map(([x, y]) => this.toWorldWith(r, x, y)); }

  // the desk (a rectangle centred on the map, `ratio` times its size)
  deskGeom() {
    const b = this.bounds, ratio = Math.max(1, E.state?.desktopRatio ?? 1.5), w = (b.x1 - b.x0) * ratio, h = (b.y1 - b.y0) * ratio;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return { cx, cy, x0: cx - w / 2, x1: cx + w / 2, yFar: cy - h / 2, yNear: cy + h / 2 };
  }
  minZoom() {
    const b = this.bounds;
    const ratio = Math.max(1.0, E.state?.desktopRatio ?? 1.5);
    const deskW = (b.x1 - b.x0) * ratio;
    const deskH = (b.y1 - b.y0) * ratio;
    let z = Math.max(E.W / deskW, E.H / deskH);
    // 3D desk view: zooming out = the player straightening up. The eyes can't rise above standing height (EYE_ABOVE_MM over the desk), so the
    // eye distance along the gaze is at most EYE_ABOVE_MM / sin(pitch); that is the zoom floor. At this limit the player stands upright at the
    // table edge, at a human height.
    if (this.desk3d) z = Math.max(z, E.H / 2 / TAN_REF / (this.dMaxMm() * this.upm));
    return z;
  }
  // gaze angle below horizontal (radians) for an eye distance Dmm from the focus: 36 deg bent over the map, lifting to 18 deg standing upright.
  // ?exp=marshal can pin it to one angle (E.camTune.pitch, degrees).
  pitchAt(Dmm) {
    if (E.camTune && E.camTune.pitch != null) return E.camTune.pitch * Math.PI / 180;
    const u = E.clamp((Dmm - D_MIN_MM) / (D_MAX_MM - D_MIN_MM), 0, 1);
    return PITCH_BENT + (PITCH_UP - PITCH_BENT) * u;
  }
  pitch() { return this.rig.th; }
  // the farthest the eyes may be from the focus: standing upright (eyes EYE_ABOVE_MM over the desk)
  dMaxMm() { return E.camTune && E.camTune.pitch != null ? EYE_ABOVE_MM / Math.sin(E.camTune.pitch * Math.PI / 180) : D_MAX_MM; }
  // The player stays at his side of the table: the eyes may be behind the desk's near edge only as far as that edge stays below the bottom of
  // the view (the bottom ray, pitch + half-FOV below horizontal, must meet the desk before the edge). Returns the largest allowed focus y.
  nearLimit() {
    const r = this.rig, g = this.deskGeom();
    const eMax = r.eye.y / Math.tan(r.th + Math.atan(TAN_REF)) * 0.85;
    return g.yNear + eMax - r.D * Math.cos(r.th);
  }
  limits() {
    const z = this.zoom, b = this.bounds;
    const hw = E.W / 2 / z, hh = E.H / 2 / z;
    // Map bounds: viewport edge = map edge
    const minX = b.x0 + hw, maxX = b.x1 - hw;
    const minY = b.y0 + hh, maxY = b.y1 - hh;
    return this.stayAtTable({
      x0: minX > maxX ? (b.x0 + b.x1) / 2 : minX,
      x1: minX > maxX ? (b.x0 + b.x1) / 2 : maxX,
      y0: minY > maxY ? (b.y0 + b.y1) / 2 : minY,
      y1: minY > maxY ? (b.y0 + b.y1) / 2 : maxY,
    });
  }
  // 3D view: (1) the player never steps back from his side of the table (see nearLimit); (2) dragging left / right may go as far as bringing the
  // outer edge of a side leader's chair (sideSeats, set by the battle from render/leaders.js) to the screen edge - no further; where no one
  // sits, as far as the desk's edge. Screen x of a map point at depth y is W/2 + (x - focus x) * k(y), so "x on the left screen edge" means
  // focus x = x + W/2 / k(y).
  stayAtTable(l) {
    if (!this.tilt) return l;
    const yl = this.nearLimit();
    if (l.y1 > yl) { l.y1 = yl; if (l.y0 > yl) l.y0 = yl; }
    // k(y) from the rig at the focus y this clamp will actually produce (the y limit above can move it, and the depths depend on it)
    const g = this.deskGeom(), W2 = E.W / 2, r = this.rigAt(this.x, E.clamp(this.y, l.y0, l.y1), this.zoom), kAt = y => this.project(g.cx, y, 0, r).k;
    let lx = null, rx = null;
    for (const s of (this.sideSeats ? this.sideSeats() : [])) {
      const k = kAt(s.y); if (!(k > 0)) continue;
      if (s.seat === 'left') lx = s.x + W2 / k; else rx = s.x - W2 / k;
    }
    const kc = kAt(g.cy);
    if (lx == null) lx = kc > 0 ? g.x0 + W2 / kc : g.x0;
    if (rx == null) rx = kc > 0 ? g.x1 - W2 / kc : g.x1;
    l.x0 = Math.min(l.x0, lx); l.x1 = Math.max(l.x1, rx);
    if (l.x0 > l.x1) l.x0 = l.x1 = (l.x0 + l.x1) / 2;
    return l;
  }
  // Hard limits at desktop bounds (desktop scale relative to map controlled by E.state.desktopRatio)
  desktopLimits() {
    const z = this.zoom, b = this.bounds;
    const ratio = Math.max(1.0, E.state?.desktopRatio ?? 1.5);
    const marginRatio = (ratio - 1) / 2;
    const mapW = b.x1 - b.x0, mapH = b.y1 - b.y0;
    const dx0 = b.x0 - mapW * marginRatio, dx1 = b.x1 + mapW * marginRatio;
    const dy0 = b.y0 - mapH * marginRatio, dy1 = b.y1 + mapH * marginRatio;
    const hw = E.W / 2 / z, hh = E.H / 2 / z;
    const minX = dx0 + hw, maxX = dx1 - hw;
    const minY = dy0 + hh, maxY = dy1 - hh;
    return this.stayAtTable({
      x0: minX > maxX ? (dx0 + dx1) / 2 : minX,
      x1: minX > maxX ? (dx0 + dx1) / 2 : maxX,
      y0: minY > maxY ? (dy0 + dy1) / 2 : minY,
      y1: minY > maxY ? (dy0 + dy1) / 2 : maxY,
    });
  }
  clamp() {
    this.zoom = Math.max(this.zoom, this.minZoom());
    const l = (E.state?.desktopRebound !== false) ? this.limits() : this.desktopLimits();
    this.x = E.clamp(this.x, l.x0, l.x1);
    this.y = E.clamp(this.y, l.y0, l.y1);
    this.bouncing = false;
  }
  dragTo(x, y) {
    // Beyond map edge, drag has resistance (factor 0.44) if rebound is enabled; hard stops at desktop edge
    const l = this.limits(), dl = this.desktopLimits();
    const rebound = E.state?.desktopRebound !== false;
    const rb = (v, lo, hi, dLo, dHi) => {
      let target = rebound
        ? (v < lo ? lo - (lo - v) * 0.44 : v > hi ? hi + (v - hi) * 0.44 : v)
        : v;
      return E.clamp(target, dLo, dHi);
    };
    this.x = rb(x, l.x0, l.x1, dl.x0, dl.x1);
    this.y = rb(y, l.y0, l.y1, dl.y0, dl.y1);
    this.bouncing = false;
  }
  release() { this.bouncing = E.state?.desktopRebound !== false; }
  update(dt) {
    if (!this.bouncing) return;
    const l = this.limits(), k = 1 - Math.exp(-14 * Math.min(dt, 0.05));
    this.x += (E.clamp(this.x, l.x0, l.x1) - this.x) * k;
    this.y += (E.clamp(this.y, l.y0, l.y1) - this.y) * k;
    if (Math.abs(this.x - E.clamp(this.x, l.x0, l.x1)) < 0.05 && Math.abs(this.y - E.clamp(this.y, l.y0, l.y1)) < 0.05) { this.x = E.clamp(this.x, l.x0, l.x1); this.y = E.clamp(this.y, l.y0, l.y1); this.bouncing = false; }
  }
  // two-finger gesture: zoom by `scale` about the pinch centre (cx, cy) and follow the movement (dx, dy) of that centre
  pinch(scale, cx, cy, dx, dy) {
    this.zoomAt(cx, cy, scale);
    const a = this.toWorld(cx - dx, cy - dy), b = this.toWorld(cx, cy);
    this.x += a.x - b.x; this.y += a.y - b.y; this.clamp();
  }
  focus(x, y) { this.x = x; this.y = y; this.clamp(); }
  toScreen(ux, uy) { if (this.tilt) return this.project(ux, uy); return { x: (ux - this.x) * this.zoom + E.W / 2, y: (uy - this.y) * this.zoom + E.H / 2 }; }
  toWorld(sx, sy) { if (this.tilt) return this.toWorldWith(this.rig, sx, sy); return { x: (sx - E.W / 2) / this.zoom + this.x, y: (sy - E.H / 2) / this.zoom + this.y }; }
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.zoom = E.clamp(this.zoom * factor, this.minZoom(), 4.5);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x; this.y += before.y - after.y; this.clamp();
  }
  // visible world rectangle
  view() {
    if (this.tilt) {                                    // bounding box of the visible ground
      const r = this.rig; if (this._view) return this._view;
      const q = this.groundQuad(), xs = q.map(p => p.x), ys = q.map(p => p.y), mx = (Math.max(...xs) - Math.min(...xs)) * 0.03, my = (Math.max(...ys) - Math.min(...ys)) * 0.03;
      return (this._view = { x0: Math.min(...xs) - mx, x1: Math.max(...xs) + mx, y0: Math.min(...ys) - my, y1: Math.max(...ys) + my, r });
    }
    const z = this.zoom; return { x0: this.x - E.W / 2 / z, y0: this.y - E.H / 2 / z, x1: this.x + E.W / 2 / z, y1: this.y + E.H / 2 / z }; }
  // scene rect on screen
  screenRect() { const b = this.bounds, a = this.toScreen(b.x0, b.y0), e = this.toScreen(b.x1, b.y1); return { x0: a.x, y0: a.y, x1: e.x, y1: e.y }; }
  // canvas transform: afterwards the context draws in map units
  apply(c) { c.translate(E.W / 2 - this.x * this.zoom, E.H / 2 - this.y * this.zoom); c.scale(this.zoom, this.zoom); }
  contains(ux, uy) { const b = this.bounds; return ux >= b.x0 && ux <= b.x1 && uy >= b.y0 && uy <= b.y1; }
}
