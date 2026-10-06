// Layout overrides: per-scene position / scale tweaks for sprites (E.drawFrame) and text (E.text).
//   overrides[sceneClassName][itemId] = { dx, dy, sx, sy }      dx/dy in the drawing's own coordinates, sx/sy multipliers
// Item ids are "<kind>:<atlas>/<frame>#<n>" where n counts identical items in draw order, so they stay stable while the
// scene's draw order does.
//
// Components: an item drawn inside the (base) rect of an item drawn earlier is that item's child (smallest enclosing
// item = parent). A parent's move / scale carries all its descendants along: every item's effective transform is its own
// override followed by the overrides of its ancestors, each scaling about the ancestor's own anchor (sprite: centre,
// text: its draw point).
//
// Beyond moving / scaling, a recording can also DELETE an item (override.hidden - its whole component disappears) and ADD
// assets to a scene (added[scene] = [{uid, kind: 'frame'|'image', atlas, frame, src, x, y}], placed in the centred
// 1600x900 content space; once added they are ordinary items that can be moved / scaled / deleted like any other).
//
// Layouts are saved one file per recording (data/layouts/<name>.json) and are applied only while the editor is active or
// when the page is opened with ?layout=<name>; saving never changes the game by itself.
// The editor UI lives in src/debug/layout_editor.js (loaded on demand through L.editorLoader).
import { E } from './kernel.js';
import { installCanvasLayout } from './layout_canvas.js';

const TOL = 4;   // design px of slack for "inside the parent"

const L = E.layout = {
  on: false,              // anything to do in drawFrame / text at all?
  active: false,          // editor running
  applySaved: false,      // ?layout=<name>
  overrides: {},          // working copy
  added: {},              // working copy of the added assets, per scene
  applied: null,          // { scenes, added } loaded by ?layout=<name> (restored after a recording ends)
  items: [], byId: new Map(), tap: null, drawOverlay: null, editorLoader: null, editor: null,
  _buttons: new WeakMap(), _parent: null, _n: new Map(), _sk: '', _frames: new Map(),

  refresh() {
    const key = this.sceneKey();
    // A saved battle layout must not enable expensive per-draw recording in
    // every unrelated menu. Preserve full recording when the editor is active.
    this.on = this.active || (this.applySaved &&
      (Object.keys(this.overrides[key] || {}).length > 0 || (this.added[key]?.length || 0) > 0));
  },
  sceneKey() { return E.scene ? E.scene.constructor.name : ''; },
  beginFrame() { this._buttons = new WeakMap(); this._parent = null; this.items.length = 0; this.byId.clear(); this._n.clear(); this._sk = this.sceneKey(); },
  get(id, sk = this._sk) { const o = this.overrides[sk]; return o && o[id]; },
  nextId(base) { const n = (this._n.get(base) || 0) + 1; this._n.set(base, n); return base + '#' + n; },

  _mat() { const m = E.ctx.getTransform(); return { a: m.a, d: m.d, e: m.e, f: m.f }; },
  _toDesign(m, x, y) { const v = E.view.scale; return { x: (m.a * x + m.e) / v, y: (m.d * y + m.f) / v }; },
  _toLocal(m, X, Y) { const v = E.view.scale; return { x: (X * v - m.e) / m.a, y: (Y * v - m.f) / m.d }; },

  // register an item drawn now; base rect + anchor are in design coordinates, before any override
  _record(it) {
    let best = this._parent && this.byId.get(this._parent);
    if (!best && !it.layoutGroup) for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i], b = p.base, c = it.base;
      if (p.kind !== 'text' && (p.kind === 'button' || b.w * b.h > c.w * c.h + 1) && c.x >= b.x - TOL && c.y >= b.y - TOL && c.x + c.w <= b.x + b.w + TOL && c.y + c.h <= b.y + b.h + TOL && (!best || b.w * b.h < best.base.w * best.base.h)) best = p;
    }
    it.parent = best ? best.id : null;
    it.source = it.source || it.id; it.alpha ??= E.ctx.globalAlpha;
    if (it.kind === 'text') { it.font ||= E.FONT; it.color ??= '#fff'; }
    // Group key: what this item is *structurally* (frame / text role + place inside its parent chain), so every instance
    // of a repeated component (save slots, cards, units...) shares one override. Position buckets are 6 design px wide.
    const rel = best ? `@${Math.round((it.anchor.x - best.anchor.x) / 6)},${Math.round((it.anchor.y - best.anchor.y) / 6)}` : '';
    it.sig = (best ? best.sig + '>' : '') + (it.kind === 'sprite' ? 'S:' + it.name : it.textual ? 'T:' + (best ? it.size : it.name + '|' + it.size) : it.kind + ':' + it.source + ((it.canvasText && !best) || it.kind === 'button' ? '|' + it.name : '')) + rel;
    it.gkey = it.layoutGroup ? 'G|' + it.layoutGroup : 'G|' + it.sig;
    // Version-1 recordings grouped only legacy sprite/text draws. Retain those keys for loading.
    if (it.kind === 'sprite' || it.textual) {
      let oldParent = null;
      if (!it.layoutGroup) for (const p of this.items) {
        if (!p.legacySig) continue;
        const b=p.base,c=it.base;
        if(c.x>=b.x-TOL&&c.y>=b.y-TOL&&c.x+c.w<=b.x+b.w+TOL&&c.y+c.h<=b.y+b.h+TOL&&(!oldParent||b.w*b.h<=oldParent.base.w*oldParent.base.h))oldParent=p;
      }
      const rel=oldParent?`@${Math.round((it.anchor.x-oldParent.anchor.x)/6)},${Math.round((it.anchor.y-oldParent.anchor.y)/6)}`:'';
      it.legacySig=(oldParent?oldParent.legacySig+'>':'')+(it.kind==='sprite'?'S:'+it.name:'T:'+(oldParent?it.size:it.name+'|'+it.size))+rel;
      it.legacyGkey=it.layoutGroup?'G|'+it.layoutGroup:'G|'+it.legacySig;
    }
    this.items.push(it); this.byId.set(it.id, it);
    return it;
  },
  chain(it) { const out = []; for (let c = it; c && out.length < 32; c = c.parent && this.byId.get(c.parent)) out.push(c); return out; },
  // override of one item: its own instance entry wins over the shared group entry
  ovFor(it) { const o = this.overrides[this._sk]; return o && (o[it.id] || o[it.gkey] || o[it.legacyGkey]); },
  tf(it) {
    const oo = this.ovFor(it), o = oo || {}, fs = (it.canvasText || it.textual) && o.fontSize != null ? o.fontSize / it.size : 1, sx = (o.sx ?? 1) * fs, sy = (o.sy ?? (it.textual ? o.sx ?? 1 : 1)) * fs;
    return { ax: it.anchor.x, ay: it.anchor.y, sx, sy, tx: (o.dx || 0) * it.k, ty: (o.dy || 0) * it.k, has: !!oo, hidden: !!o.hidden };
  },
  // effective rect after own + ancestor overrides (design coords). gx / gy: product of the ancestors' scales.
  effRect(it) {
    let r = { x: it.base.x, y: it.base.y, w: it.base.w, h: it.base.h }, ap = { x: it.anchor.x, y: it.anchor.y }, sc = 1, gx = 1, gy = 1, any = false, hidden = false;
    this.chain(it).forEach((c, i) => {
      const T = this.tf(c); any = any || T.has; hidden = hidden || T.hidden;                     // a deleted parent takes its components with it
      r = { x: T.ax + (r.x - T.ax) * T.sx + T.tx, y: T.ay + (r.y - T.ay) * T.sy + T.ty, w: r.w * T.sx, h: r.h * T.sy };
      ap = { x: T.ax + (ap.x - T.ax) * T.sx + T.tx, y: T.ay + (ap.y - T.ay) * T.sy + T.ty };
      sc *= T.sx; if (i > 0) { gx *= T.sx; gy *= T.sy; }
    });
    return { ...r, ax: ap.x, ay: ap.y, sc, gx, gy, any, hidden };
  },

  // returns the replacement rect { x, y, w, h } (local coordinates) for a sprite, or null
  sprite(f, x, y, w, h, lid, layoutGroup, alpha) {
    const m = this._mat(), k = m.a / E.view.scale, a = this._toDesign(m, x, y);
    const it = this._record({ id: lid || this.nextId(`sprite:${f.atlas}/${f.name}`), added: !!lid, layoutGroup, alpha, kind: 'sprite', name: `${f.atlas}/${f.name}`, k, m, base: { x: a.x, y: a.y, w: w * k, h: h * k }, anchor: { x: a.x + w * k / 2, y: a.y + h * k / 2 }, textual: false });
    const r = this.effRect(it); if (r.hidden) return { hidden: true };
    if (!r.any) return null;
    const style = this.style(it);
    const p = this._toLocal(m, r.x, r.y);
    return { x: p.x, y: p.y, w: r.w / k, h: r.h / k, alpha: style.alpha };
  },

  // returns { x, y, size, k } for a text draw, or null
  text(s, x, y, o) {
    if (s === '' || s == null) return null;
    s = String(s);
    const size = o.size || 28, c = E.ctx; c.save(); c.font = `${o.bold ? 'bold ' : ''}${size}px ${o.font || E.FONT}`; const w = c.measureText(s).width; c.restore();
    const m = this._mat(), k = m.a / E.view.scale, al = o.align || 'left', x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x;
    const a = this._toDesign(m, x, y), p0 = this._toDesign(m, x0, y - size / 2);
    const it = this._record({ id: this.nextId('text:' + s.slice(0, 24)), kind: 'text', name: s.slice(0, 24), k, m, base: { x: p0.x, y: p0.y, w: w * k, h: size * k }, anchor: { x: a.x, y: a.y }, textual: true, size, font: o.font || E.FONT, color: o.color || '#fff', alpha: c.globalAlpha });
    const r = this.effRect(it); if (r.hidden) return { hidden: true };
    if (!r.any) return null;
    const style = this.style(it);
    const p = this._toLocal(m, r.ax, r.ay);
    return { x: p.x, y: p.y, size: size * r.sc, k: r.sc, color: style.color, alpha: style.alpha, aspect: (r.h / it.base.h) / r.sc };
  },

  // ---- added assets ----
  // Resolve an added asset to a drawable frame (cached; the first call starts loading and returns null).
  frameFor(a) {
    const key = a.kind === 'frame' ? a.atlas + '/' + a.frame : 'img/' + a.src;
    if (this._frames.has(key)) return this._frames.get(key);
    this._frames.set(key, null);
    if (a.kind === 'frame') E.atlas(a.atlas).then(at => this._frames.set(key, at[a.frame] || null), () => {});
    else E.image('assets/' + a.src).then(img => this._frames.set(key, { img, x: 0, y: 0, w: img.width, h: img.height, rx: 0, ry: 0, name: a.src, atlas: 'img' }), () => {});
    return null;
  },
  // Draw this scene's added assets (called by the runtime right after the scene, so they sit above everything else).
  drawAdded() {
    const list = this.added[this._sk]; if (!list || !list.length) return;
    const c = E.ctx; c.save(); c.translate(E.ox, E.oy);
    for (const a of list) { const f = this.frameFor(a); if (f) E.drawFrame(f, a.x, a.y, { scale: 1, noRef: true, lid: 'add:' + a.uid }); }
    c.restore();
  },

  // ---- persistence: data/layouts/<name>.json, one file per recording ----
  async list() { try { return await (await fetch(E.platform?.isStaticWeb ? 'web_meta/layouts.json' : '/api/layouts')).json(); } catch (e) { return []; } },
  async loadNamed(name) {
    try { const r = await fetch(E.platform?.isStaticWeb ? 'web_meta/layouts/' + encodeURIComponent(name) + '.json' : '/api/layouts/' + encodeURIComponent(name)); if (r.ok) { const d = await r.json(); return { scenes: d.scenes || {}, added: d.added || {} }; } } catch (e) {}
    return null;
  },
  prune() {
    const out = {};
    for (const [sk, items] of Object.entries(this.overrides)) for (const [id, o] of Object.entries(items)) {
      if (!o || (!o.hidden && o.fontSize == null && o.color == null && o.alpha == null && (o.dx || 0) === 0 && (o.dy || 0) === 0 && (o.sx == null || o.sx === 1) && (o.sy == null || o.sy === 1))) continue;
      (out[sk] = out[sk] || {})[id] = o;
    }
    this.overrides = out;
    for (const sk of Object.keys(this.added)) if (!this.added[sk].length) delete this.added[sk];
    return Object.keys(out).length > 0 || Object.keys(this.added).length > 0;
  },
  // -> 'ok' | 'exists' | 'fail'
  async saveNamed(name, overwrite) {
    const body = JSON.stringify({ version: 2, name, saved: new Date().toISOString(), scenes: this.overrides, added: this.added }, null, 1);
    try { const r = await fetch('/api/layouts/' + encodeURIComponent(name) + (overwrite ? '?overwrite=1' : ''), { method: 'POST', body }); return r.status === 409 ? 'exists' : r.ok ? 'ok' : 'fail'; } catch (e) { return 'fail'; }
  },

  // F2 / ?edit[=name]: start a recording (optionally continuing from a saved one) or finish the running one
  async toggle(from) {
    if (this.active) { this.editor && await this.editor.stop(); return; }
    if (!this.editorLoader) return;
    const loaded = from ? await this.loadNamed(from) : null;
    const base = loaded || (this.applied && this.applied.scenes ? {
      scenes: JSON.parse(JSON.stringify(this.applied.scenes || {})),
      added: JSON.parse(JSON.stringify(this.applied.added || {}))
    } : null);
    const mod = await this.editorLoader();
    this.editor = this.editor || new mod.LayoutEditor(this);
    this.editor.start(base, from || '');
  },
};

installCanvasLayout(L);
