// Explicit, source-tagged Canvas entry points. Native canvas is untouched when layout is off.
// Offscreen asset generation is deliberately not registered.
import { E } from './kernel.js';
const pathOps = new Set(['moveTo','lineTo','rect','roundRect','arc','arcTo','ellipse','quadraticCurveTo','bezierCurveTo','closePath']);
const paints = new Set(['fillText','strokeText','fillRect','strokeRect','drawImage','fill','stroke']);
const bounds = points => {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
};
const point = (m,x,y) => ({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});
const corners = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export function installCanvasLayout(L) {
  const states = new WeakMap();
  L.canvas = (c, source) => {
    if (!L.on || c !== E.ctx) return c;
    let st = states.get(c);
    if (!st) { st = { commands: [], points: [], entries: new Map() }; states.set(c,st); }
    if (!st.entries.has(source)) st.entries.set(source, new Proxy(c, {
      get(target,key) {
        if (key === 'beginPath') return (...args) => { st.commands=[]; st.points=[]; return target.beginPath(...args); };
        if (pathOps.has(key)) return (...args) => {
          const m = target.getTransform();
          st.commands.push({key,args,m});
          let ps=[];
          if (key==='rect'||key==='roundRect') ps=corners(...args);
          else if(key==='arc') ps=corners(args[0]-args[2],args[1]-args[2],args[2]*2,args[2]*2);
          else if(key==='ellipse') { const r=Math.max(args[2],args[3]); ps=corners(args[0]-r,args[1]-r,2*r,2*r); }
          else if(key==='arcTo') { const r=args[4]; ps=[...corners(args[0]-r,args[1]-r,2*r,2*r),...corners(args[2]-r,args[3]-r,2*r,2*r)]; }
          else for(let i=0;i+1<args.length;i+=2) ps.push([args[i],args[i+1]]);
          st.points.push(...ps.map(([x,y])=>point(m,x,y)));
          return target[key](...args);
        };
        if (key === 'clip') return (...args) => {
          const parent=L._parent && L.byId.get(L._parent);
          if(!parent || !st.points.length || (args[0] && typeof args[0]!=='string'))return target.clip(...args);
          const r=L.effRect(parent),b=parent.base;if(!r.any)return target.clip(...args);
          const v=E.view.scale,t={sx:r.w/b.w,sy:r.h/b.h};t.tx=(r.x-b.x*t.sx)*v;t.ty=(r.y-b.y*t.sy)*v;
          const m=target.getTransform();replay(target,st,t);target.setTransform(m);target.clip(...args);
          replay(target,st,{sx:1,sy:1,tx:0,ty:0});target.setTransform(m);
        };
        if (paints.has(key)) return (...args) => paint(target,st,source,key,args);
        const v=Reflect.get(target,key,target); return typeof v==='function'?v.bind(target):v;
      },
      set(target,key,value) { target[key]=value; return true; }
    }));
    return st.entries.get(source);
  };
  function replay(c,st,t) {
    c.beginPath();
    for(const op of st.commands) {
      const m=op.m;
      c.setTransform(t.sx*m.a,t.sy*m.b,t.sx*m.c,t.sy*m.d,t.sx*m.e+t.tx,t.sy*m.f+t.ty);
      c[op.key](...op.args);
    }
  }
  function paint(c,st,source,method,args) {
    const m=c.getTransform(), v=E.view.scale, isPath=method==='fill'||method==='stroke';
    const textual=method==='fillText'||method==='strokeText';
    let ps, size, font;
    if(isPath) {
      // Current paths in the UI are built through this adapter, not opaque Path2D instances.
      if(!st.points.length || (args[0] && typeof args[0]!=='string')) return c[method](...args);
      ps=st.points;
    } else {
      let x,y,w,h;
      if(textual) {
        size=Number(c.font.match(/([\d.]+)px/)?.[1]||28); font=c.font;
        const metrics=c.measureText(String(args[0]));
        w=Math.min(metrics.width,args[3]??Infinity);
        const left=metrics.actualBoundingBoxLeft, right=metrics.actualBoundingBoxRight;
        const ratio=metrics.width ? w/metrics.width : 1;
        x=args[1]-(Number.isFinite(left)?left*ratio:c.textAlign==='center'?w/2:c.textAlign==='right'?w:0);
        y=args[2]-(metrics.actualBoundingBoxAscent||size*.5);
        w=Number.isFinite(right)&&Number.isFinite(left)?(left+right)*ratio:w;
        h=(metrics.actualBoundingBoxAscent||size*.5)+(metrics.actualBoundingBoxDescent||size*.5);
      } else if(method==='drawImage') {
        [x,y,w,h]=args.length===9?args.slice(5):args.length===5?args.slice(1):[args[1],args[2],args[0].width,args[0].height];
      } else [x,y,w,h]=args;
      ps=corners(x,y,w,h).map(([px,py])=>point(m,px,py));
    }
    const base=bounds(ps.map(p=>({x:p.x/v,y:p.y/v}))), k=Math.hypot(m.a,m.b)/v||1;
    const stroke=method.startsWith('stroke')||method==='stroke';
    const it=L._record({id:L.nextId('canvas:'+source+':'+method),source,kind:textual?'text':method==='drawImage'?'image':'shape',
      name:textual?String(args[0]).slice(0,40):source+' '+method,base,anchor:{x:base.x,y:base.y},k,m,textual:false,size,font,
      color:stroke?c.strokeStyle:c.fillStyle,alpha:c.globalAlpha,canvasText:textual});
    const r=L.effRect(it); if(r.hidden)return;
    const style=L.style(it);
    if(!r.any) return c[method](...args); // Exact native draw, without even an extra save/restore.
    const t={sx:r.w/base.w,sy:r.h/base.h}; t.tx=(r.x-base.x*t.sx)*v; t.ty=(r.y-base.y*t.sy)*v;
    c.save();
    try {
      if(style.color!=null) c[stroke?'strokeStyle':'fillStyle']=style.color;
      c.globalAlpha=style.alpha;
      if(isPath) {
        replay(c,st,t);
        c.setTransform(t.sx*m.a,t.sy*m.b,t.sx*m.c,t.sy*m.d,t.sx*m.e+t.tx,t.sy*m.f+t.ty);
      } else c.setTransform(t.sx*m.a,t.sy*m.b,t.sx*m.c,t.sy*m.d,t.sx*m.e+t.tx,t.sy*m.f+t.ty);
      return c[method](...args);
    } finally {
      if(isPath) replay(c,st,{sx:1,sy:1,tx:0,ty:0});
      c.restore();
    }
  }
  L.style = it => {
    let color, alpha=L.ovFor(it)?.alpha ?? it.alpha ?? 1;
    for(const p of L.chain(it).reverse()) {
      const o=L.ovFor(p)||{};
      if(o.color!=null)color=o.color;
      if(p !== it && o.alpha!=null)alpha*=o.alpha/(p.alpha || 1);
    }
    return {color,alpha:Math.max(0,Math.min(1,alpha))};
  };
  L.button = (b, source='E.Button') => {
    if(!L.on || !b || b.visible===false || !b.w || !b.h) return null;
    const old=L._buttons.get(b); if(old)return old;
    const m=E.ctx.getTransform(),v=E.view.scale;
    const base=bounds(corners(b.x,b.y,b.w,b.h).map(([x,y])=>{const p=point(m,x,y);return {x:p.x/v,y:p.y/v};}));
    const id=L.nextId('button:'+source+':'+(b.label||b.id||''));
    const it=L._record({id,source,kind:b.layoutKind||'button',name:b.label||b.id||source,base,anchor:{x:base.x,y:base.y},k:Math.hypot(m.a,m.b)/v||1,m,alpha:1,button:b});
    L._buttons.set(b,it); return it;
  };
  L.inputPoint = p => {
    if(!L.on)return p;
    for(let i=L.items.length-1;i>=0;i--) {
      const it=L.items[i];if(it.kind!=='button'||!it.button?.layoutInput)continue;
      const r=L.effRect(it);if(!r.any||r.hidden||p.x<r.x||p.x>r.x+r.w||p.y<r.y||p.y>r.y+r.h)continue;
      return { ...p, x:it.base.x+(p.x-r.x)*it.base.w/r.w, y:it.base.y+(p.y-r.y)*it.base.h/r.h };
    }
    for(const it of L.items) {
      if(!it.button?.layoutInput || !L.effRect(it).any)continue;
      const b=it.base;if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h)return {...p,x:-1e6,y:-1e6};
    }
    return p;
  };
  L.region = (source,rect,draw,kind='group') => L.group({...rect, label:rect.label||source, layoutKind:kind,layoutInput:kind==='button'},source,draw);
  L.group = (b,source,draw) => {
    if(!L.on)return draw();
    const it=L.button(b,source),prev=L._parent;
    if(it)L._parent=it.id;
    try{return draw();}finally{L._parent=prev;}
  };
}
