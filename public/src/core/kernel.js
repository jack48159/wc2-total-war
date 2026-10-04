// The engine kernel object: shared runtime state (canvas, viewport, pointer, scene slot).
// Everything else in src/core/* attaches services to this object; scenes and UI import it from './core/index.js'.
// Fixed 1600x900 design canvas; W/H grow with the window (no letterbox), ox/oy centre the 1600x900 content layout.
export const DESIGN_W = 1600, DESIGN_H = 900;

export const E = {
  W: DESIGN_W, H: DESIGN_H, ox: 0, oy: 0,
  S: 1.664,                       // original HD sprite -> design-canvas scale
  ctx: null, cv: null, scene: null,
  scenes: {},                     // name -> Scene class, filled by scenes/index.js (see core/scenes.js)
  imgs: {}, atlases: {}, time: 0,
  pointer: { x: -1, y: -1, down: false, touch: false }, pointerC: { x: -1, y: -1 }, keyboard: false, focus: null,
  view: { scale: 1, ox: 0, oy: 0, dpr: 1 }, fade: { a: 1, target: 0 }, busy: false, loading: 0,
};
E.FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
E.SERIF = '"Georgia","Times New Roman",serif';
E.CJK_SERIF = '"Songti SC","Noto Serif CJK SC","SimSun",serif';
E.NUM = '"Arial Black","Impact","Segoe UI","Microsoft YaHei",sans-serif';   // lining, heavy numerals
// Experiment flags for A/B testing on real hardware (?exp=a,b,c). E.exp('name') is true when that flag is set. Used to isolate the cause of the
// 3D post-battle "four corners" stutter by turning suspected per-frame costs on/off one at a time.
E.expSet = new Set((new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('exp') || '').split(',').map(s => s.trim()).filter(Boolean));
E.exp = name => E.expSet.has(name);
E.sleep = ms => new Promise(r => setTimeout(r, ms));
E.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
