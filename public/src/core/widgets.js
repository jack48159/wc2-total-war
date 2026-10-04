// Button widget (hover / press / focus visuals), focus ring and text drawing.
import { E } from './kernel.js';

// Hit rect in design px. The owner draws it; E.fx(b) gives the hover/press visual state.
// `edge` buttons use real window coordinates, the others the centred 1600x900 content space.
E.Button = class {
  constructor(o) { Object.assign(this, { x: 0, y: 0, w: 100, h: 40, onClick: null, sfx: 'btn.wav', enabled: true, visible: true, edge: false, label: '' }, o); }
  get ptr() { return this.edge ? E.pointer : E.pointerC; }
  hit(p) {
    const hitRect = (point, x, y, w, h) => {
      const min = E.platform?.isTouch && E.cv?.clientHeight > 0 ? 44 * E.H / E.cv.clientHeight : 0;
      const dw = Math.max(0, min - w), dh = Math.max(0, min - h);
      return point.x >= x - dw / 2 && point.x <= x + w + dw / 2 && point.y >= y - dh / 2 && point.y <= y + h + dh / 2;
    };
    const L=E.layout, it=L.on && L._buttons.get(this);
    if(it && L.effRect(it).any) {
      const r=L.effRect(it),m=it.m,v=E.view.scale;
      const x=(m.a*p.x+m.c*p.y+m.e)/v,y=(m.b*p.x+m.d*p.y+m.f)/v;
      return this.visible && !r.hidden && hitRect({x,y},r.x,r.y,r.w,r.h);
    }
    return this.visible && hitRect(p,this.x,this.y,this.w,this.h); }
  get hover() { return this.enabled && !E.pointer.touch && !E.pointer.down && this.hit(this.ptr); }
  get pressed() { return this.enabled && E.pointer.down && !!this._armed && this.hit(this.ptr); }
  get focused() { return E.keyboard && E.focus === this; }
  down(p) { if (this.enabled && this.hit(p)) { this._armed = true; return true; } return false; }
  up(p) { const fire = this._armed && this.hit(p); this._armed = false; if (fire) this.click(); return fire; }
  click() { if (this.sfx) E.playSfx(this.sfx); if (this.onClick) this.onClick(); }
  disarm() { this._armed = false; }
};
// Visual state: hover +brightness, pressed -brightness and 2px down.
E.fx = (b, register = true) => { if (register) E.layout.button(b); return b.pressed ? { dy: 2, filter: 'brightness(0.78)' } : b.hover ? { dy: 0, filter: 'brightness(1.12)' } : { dy: 0, filter: 'none' }; };
E.focusRing = b => {
  const c = E.ctx; c.save(); c.strokeStyle = '#ffd35a'; c.lineWidth = 4; c.shadowColor = 'rgba(255,200,60,.8)'; c.shadowBlur = 10;
  const paint = E.layout.canvas(c, 'core/widgets.js/focusRing');
  paint.beginPath(); paint.roundRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 10); paint.stroke(); c.restore();
};

E.text = (s, x, y, o = {}) => {
  const c = E.ctx;
  if (E.layout.on) {                                               // layout editor / saved layout (core/layout.js)
    const r = E.layout.text(s, x, y, o);
    if (r && r.hidden) return;
    if (r) { x = r.x; y = r.y; o = Object.assign({}, o, { size: r.size, color: r.color ?? o.color, layoutAlpha: r.alpha, layoutAspect: r.aspect, strokeW: (o.strokeW || 5) * r.k }); }
  }
  c.save();
  if (o.layoutAspect != null && o.layoutAspect !== 1) { c.translate(x, y); c.scale(1, o.layoutAspect); x = 0; y = 0; }
  if (o.layoutAlpha != null) c.globalAlpha = o.layoutAlpha;
  c.font = `${o.bold ? 'bold ' : ''}${o.size || 28}px ${o.font || E.FONT}`;
  c.textAlign = o.align || 'left'; c.textBaseline = o.base || 'middle';
  if (o.shadow) { c.shadowColor = o.shadow; c.shadowBlur = 4; c.shadowOffsetY = 2; }
  if (o.stroke) { c.lineWidth = o.strokeW || 5; c.strokeStyle = o.stroke; c.lineJoin = 'round'; c.strokeText(s, x, y); }
  c.fillStyle = o.color || '#fff'; c.fillText(s, x, y); c.restore();
};
