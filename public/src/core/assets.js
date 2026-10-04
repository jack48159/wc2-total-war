// Image / JSON / atlas loading and sprite drawing.
import { E } from './kernel.js';

// Keep a strong reference to every <img> while it loads: an unreferenced Image can be garbage-collected
// before onload fires, which would leave the promise pending forever.
const pendingImgs = new Set();
E.image = url => E.imgs[url] || (E.imgs[url] = new Promise((res, rej) => {
  const i = new Image(); pendingImgs.add(i);
  i.onload = () => { pendingImgs.delete(i); res(i); };
  i.onerror = () => { pendingImgs.delete(i); delete E.imgs[url]; rej(new Error('image ' + url)); };
  i.src = url;
}));
E.json = url => fetch(url).then(r => r.json());

// Atlas XML: <Texture name=".."/><Images><Image name x y w h refx refy/></Images>
E.atlas = async name => {
  if (E.atlases[name]) return E.atlases[name];
  const txt = (await (await fetch(`assets/${name}.xml`)).text()).replace(/^﻿/, '');
  const doc = new DOMParser().parseFromString('<root>' + txt.replace(/<\?xml[^>]*\?>/, '') + '</root>', 'text/xml');
  const img = await E.image('assets/' + doc.querySelector('Texture').getAttribute('name'));
  const frames = {};
  doc.querySelectorAll('Image').forEach(n => {
    const g = a => +n.getAttribute(a) || 0;
    const nm = n.getAttribute('name').replace(/\.png$/, '');
    frames[nm] = { img, x: g('x'), y: g('y'), w: g('w'), h: g('h'), rx: g('refx'), ry: g('refy'), name: nm, atlas: name };
  });
  if (name === 'ui1_hd') await loadHudRedraw();
  return (E.atlases[name] = frames);
};

// Battle-scoped view: shared menu atlases and detached original canvases stay original.
// Resolve every access so hudArt changes work even on an already-open battle.
let hudRedrawLoad;
const hudRedrawFrames = {};
function loadHudRedraw() {
  return hudRedrawLoad || (hudRedrawLoad = E.json('ui_hd_redraw/manifest.json').then(async manifest => {
    await Promise.all(manifest.frames.map(async f => {
      const img = await E.image('ui_hd_redraw/' + f.file);
      hudRedrawFrames[f.name] = { ...f, img, x: 0, y: 0, atlas: f.atlas, hudRedraw: true };
    }));
  }).catch(error => { hudRedrawLoad = null; throw error; }));
}
E.hudAtlas = frames => new Proxy(frames, {
  get(target, name) {
    return E.state.hudArt === 'redraw' && hudRedrawFrames[name] || target[name];
  }
});

// Draw a frame; top-left is (x - refx*s, y - refy*s) unless o.noRef.
E.drawFrame = (f, x, y, o = {}) => {
  if (!f) return;
  const c = E.ctx, s = o.scale == null ? E.S : o.scale, sx = o.sx == null ? s : o.sx, sy = o.sy == null ? s : o.sy;
  let dx = x - (o.noRef ? 0 : f.rx * sx), dy = y - (o.noRef ? 0 : f.ry * sy), dw = f.w * sx, dh = f.h * sy;
  if (E.layout.on && f.name && !o.noLayout) {                    // layout editor / saved layout (core/layout.js)
    const r = E.layout.sprite(f, dx, dy, dw, dh, o.lid, o.layoutGroup, o.alpha ?? c.globalAlpha);
    if (r) { if (r.hidden) return; dx = r.x; dy = r.y; dw = r.w; dh = r.h; o = { ...o, alpha: r.alpha }; }
  }
  const changeState = o.alpha != null || (o.filter && o.filter !== 'none');
  if (changeState) c.save();
  if (o.alpha != null) c.globalAlpha = o.alpha;
  if (o.filter && o.filter !== 'none') c.filter = o.filter;
  if (f.cv) c.drawImage(f.cv, dx, dy, dw, dh); else c.drawImage(f.img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  if (changeState) c.restore();
};
// Give every frame of an atlas its own small canvas (the HUD's corner boards / buttons): drawing them no longer samples the big shared sheet,
// which the browser was re-uploading / evicting when the battle filled GPU memory (the corner widgets flickered and stuttered).
E.detachFrames = frames => { for (const f of Object.values(frames)) { if (f.cv || !f.w || !f.h) continue; const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h; cv.getContext('2d').drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h); f.cv = cv; } };
E.drawFrameCentered = (f, cx, cy, o = {}) => {
  if (!f || !(f.w > 0) || !(f.h > 0)) return;
  const s = o.scale == null ? E.S : o.scale;
  const sx = o.sx == null ? s : o.sx, sy = o.sy == null ? s : o.sy;
  E.drawFrame(f, cx - f.w * sx / 2, cy - f.h * sy / 2, Object.assign({}, o, { noRef: true }));
};
E.cover = img => {
  // 触屏有安全区时，背景图铺满整个屏幕(含刘海/圆角外的区域)，不是只铺安全区；桌面没有安全区，il/ir/it/ib 都是 0，行为不变
  const v = E.view || {}, k = v.scale || 1, l = (v.il || 0) / k, r = (v.ir || 0) / k, t = (v.it || 0) / k, b = (v.ib || 0) / k;
  const W = E.W + l + r, H = E.H + t + b, s = Math.max(W / img.width, H / img.height);
  E.layout.canvas(E.ctx, 'core/assets.js/cover').drawImage(img, -l + (W - img.width * s) / 2, -t + (H - img.height * s) / 2, img.width * s, img.height * s);
};
