// Visual layout editor (F2, or ?edit / ?edit=<saved name> to continue an old recording). Works on whatever scene is
// showing: every sprite and text drawn through E.drawFrame / E.text becomes a movable, scalable item, and items inside
// another item follow it (see core/layout.js). One F2..F2 session is one recording; when it ends you name it and it is
// written to data/layouts/<name>.json. Recordings are only used by the game when opened with ?layout=<name>.
import { E } from '../core/index.js';
import { pickAsset } from './asset_picker.js';

const clone = o => JSON.parse(JSON.stringify(o));

const HANDLE = 11;
const HELP = '左键拖动=移动  右键=游戏点击  角点/滚轮=缩放  方向键=微调  T=层级树  I=检查器  A=添加素材  Del=删除所选  Backspace=复位所选  Shift+Backspace=复位本页  Ctrl+Z=撤销  B=框  S=同款同步  F2/Esc=结束录制';

export class LayoutEditor {
  constructor(L) { this.L = L; this.sel = null; this.drag = null; this.undo = []; this.showAll = true; this.alt = false; this.lastClick = null; this.toast = null; this.name = ''; this.sync = true; this.showTree = false; this.showInspector = true; this.treeHover = null; }

  start(base, name) {
    const L = this.L; L.active = true; L.tap = this; L.overrides = base ? clone(base.scenes) : {}; L.added = base ? clone(base.added) : {}; L.refresh();
    this.sel = null; this.undo = []; this.name = name || '';
    this.mountPanels();
    L.drawOverlay = ctx => this.overlay(ctx);
  }
  // end of the recording: name it, save it, go back to the game as it was
  async stop() {
    this.unmountPanels();
    const L = this.L; L.active = false; L.tap = null; this.drag = null; L.refresh();
    const has = L.prune();
    if (!has) this.say('没有任何改动，未保存');
    else {
      let warn = '', existing = null;
      for (;;) {
        const name = await this.askName(this.name || this.defaultName(), warn);
        if (name == null) { this.say('已放弃本次录制'); break; }
        const res = await L.saveNamed(name, name === existing);
        if (res === 'ok') {
          if (await this.askYesNo('布局已保存', `已保存为 data/layouts/${name}.json。
是否立即采用这份布局？
（采用后立刻生效，下次启动游戏也会沿用；随时可用 ?layout=none 取消）`, '立即采用', '暂不采用')) {
            L.applied = { scenes: clone(L.overrides), added: clone(L.added) }; L.applySaved = true;
            try {                                                                   // write it into the global config right away (embedded, so the game needs no other file)
              const cur = await (await fetch('/api/game-config')).json().catch(() => ({}));
              await fetch('/api/game-config', { method: 'POST', body: JSON.stringify({ ...cur, layout: { name, ...clone(L.applied) } }) });
            } catch (e) {}
            this.say(`已采用布局「${name}」`);
          } else this.say(`已保存 → data/layouts/${name}.json（未采用；用 ?layout=${name} 打开可采用）`);
          break;
        }
        if (res === 'exists') { existing = name; warn = `「${name}」已存在。再点一次“保存”覆盖，或改个名字。`; this.name = name; continue; }
        warn = '保存失败：服务器不可用'; existing = null;
      }
    }
    L.overrides = L.applied ? clone(L.applied.scenes) : {}; L.added = L.applied ? clone(L.applied.added) : {};
    L.refresh(); this.sel = null;
  }
  defaultName() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `录制-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
  say(text) { this.toast = { text, until: E.time + 6 }; }

  // yes / no modal -> Promise<boolean>
  askYesNo(title, text, yes, no) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '16px "Microsoft YaHei",sans-serif' });
      wrap.innerHTML = `<div style="background:#2a1d10;border:2px solid #c9a464;border-radius:10px;padding:22px 26px;width:440px;color:#f3e7c6">
        <div style="font-size:20px;font-weight:bold;margin-bottom:12px"></div>
        <div class="t" style="white-space:pre-line;line-height:1.6;margin-bottom:16px"></div>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button class="no" style="padding:8px 18px;font-size:16px;cursor:pointer"></button>
          <button class="ok" style="padding:8px 22px;font-size:16px;cursor:pointer;background:#4c8f3a;color:#fff;border:0;border-radius:4px"></button></div></div>`;
      wrap.firstElementChild.firstElementChild.textContent = title; wrap.querySelector('.t').textContent = text;
      wrap.querySelector('.ok').textContent = yes; wrap.querySelector('.no').textContent = no;
      const done = v => { wrap.remove(); resolve(v); };
      wrap.querySelector('.ok').onclick = () => done(true); wrap.querySelector('.no').onclick = () => done(false);
      wrap.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
      document.body.appendChild(wrap); wrap.querySelector('.ok').focus();
    });
  }

  // DOM modal (a real <input> so IME / CJK typing works). Resolves to the trimmed name or null when cancelled.
  askName(def, warn) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '16px "Microsoft YaHei",sans-serif' });
      wrap.innerHTML = `<div style="background:#2a1d10;border:2px solid #c9a464;border-radius:10px;padding:22px 26px;width:420px;color:#f3e7c6">
        <div style="font-size:20px;font-weight:bold;margin-bottom:12px">保存本次布局录制</div>
        <div style="margin-bottom:8px;color:#cdbb95">录制名称（同时作为文件名）</div>
        <input style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:18px;background:#fff8e1;color:#2b1a08;border:2px solid #e6a33a;border-radius:6px;outline:none" maxlength="60">
        <div class="w" style="min-height:22px;margin-top:8px;color:#ff9a7a"></div>
        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px">
          <button class="no" style="padding:8px 18px;font-size:16px;cursor:pointer">放弃</button>
          <button class="ok" style="padding:8px 22px;font-size:16px;cursor:pointer;background:#4c8f3a;color:#fff;border:0;border-radius:4px">保存</button></div></div>`;
      const input = wrap.querySelector('input'); input.value = def; wrap.querySelector('.w').textContent = warn || '';
      const done = v => { wrap.remove(); resolve(v); };
      const ok = () => { const v = input.value.trim(); if (v) done(v); else { wrap.querySelector('.w').textContent = '名称不能为空'; } };
      wrap.querySelector('.ok').onclick = ok; wrap.querySelector('.no').onclick = () => done(null);
      wrap.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') ok(); else if (e.key === 'Escape') done(null); });
      document.body.appendChild(wrap); input.focus(); input.select();
    });
  }


  mountPanels() {
    this.unmountPanels();
    const make = (side, width) => {
      const el = document.createElement('section');
      Object.assign(el.style, {position:'fixed',top:'42px',[side]:'12px',width:width+'px',maxHeight:'calc(100vh - 100px)',overflow:'auto',background:'rgba(20,23,27,.96)',color:'#eee',padding:'12px',border:'1px solid #607080',borderRadius:'6px',zIndex:80,font:'13px sans-serif',boxSizing:'border-box'});
      for (const event of ['pointerdown','pointerup','pointermove','click','wheel','keyup','contextmenu']) el.addEventListener(event,e=>e.stopPropagation());
      el.addEventListener('keydown',e=>{
        e.stopPropagation();
        if(e.target.closest('input,textarea,select,[contenteditable]'))return;
        if(e.key==='F2'){e.preventDefault();this.stop();return;}
        this.key(e);
      });
      document.body.appendChild(el); return el;
    };
    this.inspector = make('right',280); this.tree = make('left',300);
    this.inspector.innerHTML = '<strong>布局检查器 · I 隐藏</strong><div data-meta style="white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0"></div><div data-fields></div><div data-error style="color:#ffa080;margin-top:8px"></div>';
    this.fields = {};
    for(const [key,label] of [['x','x'],['y','y'],['w','宽'],['h','高'],['fontSize','字号'],['color','颜色 hex'],['alpha','透明度']]) {
      const row=document.createElement('label'); Object.assign(row.style,{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'});
      const caption=document.createElement('span'); caption.textContent=label; caption.style.width='72px';
      const input=document.createElement('input'); input.type=key==='color'?'text':'number'; input.step=key==='alpha'?'0.01':'0.1';
      if(key==='alpha'){input.min='0';input.max='1';} if(['w','h','fontSize'].includes(key))input.min='0.1';
      Object.assign(input.style,{width:'150px',boxSizing:'border-box'}); input.setAttribute('aria-label',label);
      input.addEventListener('focus',()=>{input.dataset.item=this.sel||'';});
      input.addEventListener('change',()=>this.editField(key,input));
      input.addEventListener('keydown',e=>{if(e.key==='Enter'){input.blur();} if(e.key==='Escape'){input.blur();}});
      row.append(caption,input); this.inspector.querySelector('[data-fields]').appendChild(row);this.fields[key]=input;
    }
    this.treeTitle=document.createElement('strong');this.treeTitle.textContent='当前页面层级 · T 隐藏';
    this.treeList=document.createElement('div');this.treeList.setAttribute('role','tree');this.tree.append(this.treeTitle,this.treeList);this.treeKey='';
  }
  unmountPanels() {
    this.inspector?.remove();this.tree?.remove();this.inspector=null;this.tree=null;this.treeHover=null;
  }
  editField(key,input) {
    const it=this.item(input.dataset.item); if(!it || it.id!==this.sel)return;
    let value=key==='color'?input.value.trim():Number(input.value);
    const error=this.inspector.querySelector('[data-error]');
    if(key==='color'?!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value):input.value.trim()===''||!Number.isFinite(value)||(['w','h','fontSize'].includes(key)&&value<=0)||(key==='alpha'&&(value<0||value>1))) {
      error.textContent='请输入有效数值；颜色用 #RRGGBB 或 #RRGGBBAA。';return;
    }
    error.textContent='';this.pushUndo();const r=this.disp(it),o=this.write(it);
    if(key==='x'||key==='y') {
      const axis=key==='x'?'dx':'dy',scale=key==='x'?r.gx:r.gy;
      o[axis]=(o[axis]||0)+(value-r[key])/(it.k*scale);
    } else if(key==='w'||key==='h') {
      const axis=key==='w'?'sx':'sy';o[axis]=(o[axis]??1)*value/r[key];
    } else o[key]=value;
  }
  colorHex(value) {
    if(typeof value!=='string')return '';
    if(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))return value;
    if(/^#[0-9a-f]{3}$/i.test(value))return '#'+[...value.slice(1)].map(x=>x+x).join('');
    const rgb=value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
    if(rgb)return '#'+rgb.slice(1,4).map(x=>Math.round(Number(x)).toString(16).padStart(2,'0')).join('')+(rgb[4]!=null?Math.round(Number(rgb[4])*255).toString(16).padStart(2,'0'):'');
    return '';
  }
  updatePanels() {
    if(!this.inspector)return;
    this.inspector.hidden=!this.showInspector;this.tree.hidden=!this.showTree;
    const it=this.item(this.sel);
    if(this.showInspector) {
      const meta=this.inspector.querySelector('[data-meta]');
      meta.textContent=it?`${it.name}\n来源（注册名）：${it.source||it.id}\n父项目：${it.parent||'无'}\n字体：${it.font||'—'}\n原始颜色：${typeof it.color==='string'?it.color:it.color?'渐变/图案':'—'}\n实际透明度：${this.L.style(it).alpha.toFixed(3)}`:'点击画面或层级树选择元素';
      const r=it?this.disp(it):{},o=it?this.peek(it):{};
      const values={...r,fontSize:o.fontSize??it?.size??'',color:this.colorHex(o.color??it?.color),alpha:o.alpha??it?.alpha??1};
      for(const [key,input] of Object.entries(this.fields)) {
        input.disabled=!it||(key==='fontSize'&&!it.size)||(key==='color'&&['sprite','image'].includes(it.kind));
        if(document.activeElement!==input){const value=values[key];input.value=typeof value==='number'?Math.round(value*1000)/1000:value??'';}
      }
    }
    if(this.showTree) {
      const key=this.sk+'|'+this.L.items.map(it=>it.id+'>'+it.parent).join('\n');
      if(key!==this.treeKey) {
        this.treeKey=key;this.treeList.replaceChildren();this.treeRows=new Map();
        const children=new Map();for(const it of this.L.items){const p=it.parent||'';if(!children.has(p))children.set(p,[]);children.get(p).push(it);}
        const add=(parent,depth)=>{for(const item of children.get(parent)||[]){
          const row=document.createElement('button');row.type='button';row.setAttribute('role','treeitem');row.setAttribute('aria-level',depth+1);
          row.textContent=`${item.kind==='button'?'▣':'·'} ${item.name}`;row.title=item.source||item.id;
          Object.assign(row.style,{display:'block',width:'100%',textAlign:'left',padding:`5px 4px 5px ${6+depth*12}px`,border:0,color:'#eee',background:'transparent',cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});
          row.onclick=()=>{this.sel=item.id;this.selScene=this.sk;this.drag=null;};
          row.onmouseenter=()=>{this.treeHover=item.id;};row.onmouseleave=()=>{if(this.treeHover===item.id)this.treeHover=null;};
          this.treeList.appendChild(row);this.treeRows.set(item.id,row);add(item.id,depth+1);
        }};add('',0);
      }
      for(const [id,row] of this.treeRows||[]) { const item=this.item(id); if(item)row.textContent=`${item.kind==='button'?'▣':'·'} ${item.name}`; row.style.background=id===this.sel?'#526045':'transparent';row.setAttribute('aria-selected',String(id===this.sel));}
    }
  }

  // ---- data helpers ----
  get sk() { return this.L.sceneKey(); }
  // the game keeps running under the right button, so the scene can change while recording: drop a stale selection
  checkScene() { if (this.selScene !== this.sk) { this.sel = null; this.drag = null; this.lastClick = null; this.selScene = this.sk; } }
  // current override of an item (instance entry, else shared group entry, else identity)
  peek(it) { return { dx: 0, dy: 0, sx: 1, sy: 1, ...this.L.ovFor(it) }; }
  // the entry to edit: shared by every instance of the component (sync on) or private to this instance (sync off)
  write(it) {
    const all = (this.L.overrides[this.sk] = this.L.overrides[this.sk] || {}), cur = this.peek(it);
    if (this.sync && !it.added) { delete all[it.id]; return (all[it.gkey] = { ...cur, ...all[it.gkey] }); }
    return (all[it.id] = { ...cur, ...all[it.id] });
  }
  sameGroup(it) { return this.L.items.filter(i => i.gkey === it.gkey); }
  pushUndo() { this.undo.push(JSON.stringify({ o: this.L.overrides, a: this.L.added })); if (this.undo.length > 100) this.undo.shift(); }
  popUndo() { const s = this.undo.pop(); if (!s) return; const d = JSON.parse(s); this.L.overrides = d.o; this.L.added = d.a; }
  item(id) { return this.L.byId.get(id); }
  disp(it) { return this.L.effRect(it); }
  hits(p) { const out = []; for (let i = this.L.items.length - 1; i >= 0; i--) { const r = this.disp(this.L.items[i]); if (p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2) out.push(this.L.items[i]); } const tactics = out.filter(it => it.layoutGroup && it.layoutGroup.startsWith('unit-tactic:')); return tactics.length ? [...tactics, ...out.filter(it => !tactics.includes(it))] : out; }
  corner(it, p) {
    const r = this.disp(it);
    for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) if (Math.abs(p.x - cx) <= HANDLE + 3 && Math.abs(p.y - cy) <= HANDLE + 3) return true;
    return false;
  }
  descendants(id) { return this.L.items.filter(i => i.id !== id && this.L.chain(i).some(c => c.id === id)); }

  // ---- adding / deleting assets ----
  async addAsset() {
    const d = await pickAsset(); if (!d) return;
    this.pushUndo();
    const list = (this.L.added[this.sk] = this.L.added[this.sk] || []), uid = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    list.push({ uid, ...(d.kind === 'frame' ? { kind: 'frame', atlas: d.atlas, frame: d.frame } : { kind: 'image', src: d.src }), x: Math.round(800 - d.w / 2), y: Math.round(450 - d.h / 2) });
    this.sel = 'add:' + uid; this.selScene = this.sk; this.say('已添加，拖动到想要的位置');
  }
  // an added asset is removed outright; a built-in item (and its components) is hidden by an override - Backspace brings it back
  deleteSelected() {
    const it = this.sel && this.item(this.sel); if (!it) return;
    this.pushUndo();
    if (it.added) { const uid = it.id.slice(4), l = this.L.added[this.sk] || []; this.L.added[this.sk] = l.filter(a => a.uid !== uid); }
    else this.write(it).hidden = true;
    this.sel = null;
  }

  // ---- input (called by the runtime instead of the scene) ----
  pointerDown(p) {
    this.checkScene();
    const cur = this.sel && this.item(this.sel);
    if (cur && this.corner(cur, p)) {
      const r = this.disp(cur), o = this.peek(cur);
      this.pushUndo();
      this.drag = { mode: 'scale', id: cur.id, o0: { ...o }, p0: p, ax: r.ax, ay: r.ay, d0: Math.max(8, Math.hypot(p.x - r.ax, p.y - r.ay)), dx0: Math.max(8, Math.abs(p.x - r.ax)), dy0: Math.max(8, Math.abs(p.y - r.ay)) };
      return;
    }
    const hs = this.hits(p);
    if (!hs.length) { this.sel = null; this.lastClick = null; return; }
    let pick = hs.find(it => it.kind === 'button') || hs[0];
    const lc = this.lastClick;
    if (lc && Math.hypot(lc.x - p.x, lc.y - p.y) < 4) { const i = hs.findIndex(h => h.id === this.sel); if (i >= 0) pick = hs[(i + 1) % hs.length]; }
    this.lastClick = { x: p.x, y: p.y }; this.sel = pick.id;
    this.pushUndo();
    const r = this.disp(pick);
    this.drag = { mode: 'move', id: pick.id, o0: { ...this.peek(pick) }, p0: p, kx: pick.k * r.gx, ky: pick.k * r.gy };   // ancestors' scale stretches our offsets
  }
  pointerMove(p) {
    const d = this.drag; if (!d) return;
    const it = this.item(d.id); if (!it) return;
    const o = this.write(it);
    if (d.mode === 'move') { o.dx = d.o0.dx + (p.x - d.p0.x) / d.kx; o.dy = d.o0.dy + (p.y - d.p0.y) / d.ky; }
    else {
      const cl = v => Math.max(0.05, Math.min(20, v));
      if (this.alt && !it.textual) { o.sx = cl(d.o0.sx * Math.abs(p.x - d.ax) / d.dx0); o.sy = cl(d.o0.sy * Math.abs(p.y - d.ay) / d.dy0); }
      else { const r = Math.hypot(p.x - d.ax, p.y - d.ay) / d.d0; o.sx = cl(d.o0.sx * r); o.sy = cl(d.o0.sy * r); }
    }
  }
  pointerUp() { this.drag = null; }
  wheel(dy) {                      // true = consumed; with nothing selected the wheel goes to the game (e.g. map zoom)
    if (!this.sel) return false;
    const it = this.item(this.sel); if (!it) return false;
    this.pushUndo(); const o = this.write(it), f = dy < 0 ? 1.04 : 1 / 1.04;
    o.sx = Math.max(0.05, Math.min(20, o.sx * f)); o.sy = Math.max(0.05, Math.min(20, o.sy * f));
    return true;
  }
  keyUp(e) { if (e.key === 'Alt') this.alt = false; }
  key(e) {
    if (e.target?.closest?.('input,textarea,select,[contenteditable]')) return;
    if (e.key.toLowerCase() === 't') { this.showTree = !this.showTree; this.treeHover = null; e.preventDefault(); return; }
    if (e.key.toLowerCase() === 'i') { this.showInspector = !this.showInspector; e.preventDefault(); return; }
    if (e.key === 'Alt') { this.alt = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { this.stop(); return; }
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); this.popUndo(); return; }
    if (e.key === 'b' || e.key === 'B') { this.showAll = !this.showAll; return; }
    if (e.key === 's' || e.key === 'S') { this.sync = !this.sync; this.say(this.sync ? '同步已开：同款组件的所有实例一起改' : '同步已关：只改当前这一个'); return; }
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); this.addAsset(); return; }
    if (e.key === 'Delete') { e.preventDefault(); this.deleteSelected(); return; }
    if (e.key === 'Backspace') {                                    // reset: undo moves / scaling / deletion of the selection (or the page)
      e.preventDefault(); this.pushUndo();
      if (e.shiftKey) { delete this.L.overrides[this.sk]; delete this.L.added[this.sk]; }
      else { const s = this.sel && this.item(this.sel); if (s && this.L.overrides[this.sk]) { delete this.L.overrides[this.sk][s.id]; delete this.L.overrides[this.sk][s.gkey]; delete this.L.overrides[this.sk][s.legacyGkey]; } }
      return;
    }
    const step = e.shiftKey ? 10 : 1, it = this.sel && this.item(this.sel);
    if (it && e.key.startsWith('Arrow')) {
      e.preventDefault(); this.pushUndo(); const o = this.write(it), r = this.disp(it), kx = it.k * r.gx, ky = it.k * r.gy;
      if (e.key === 'ArrowLeft') o.dx -= step / kx; else if (e.key === 'ArrowRight') o.dx += step / kx; else if (e.key === 'ArrowUp') o.dy -= step / ky; else o.dy += step / ky;
    }
  }

  // ---- drawing (design coordinates, drawn over the scene) ----
  overlay(ctx) {
    if (this.L.active) { this.checkScene(); this.updatePanels(); }
    const toast = this.toast && E.time < this.toast.until ? this.toast : null;
    if (!this.L.active && !toast) return;
    ctx.save(); ctx.lineWidth = 1.5; ctx.font = '15px sans-serif'; ctx.textBaseline = 'middle';
    if (this.L.active) {
      const items = this.L.items, box = (it, style, w = 1.5, dash = null) => { const r = this.disp(it); ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]); };
      if (this.showAll) for (const it of items) { if (this.disp(it).hidden) box(it, 'rgba(255,70,70,0.8)', 1.5, [4, 4]); else box(it, 'rgba(0,200,255,0.35)'); }
      const hv = this.drag ? [] : this.hits(E.pointer);
      if (hv.length) box(hv[0], '#ff9a2e', 2);
      const treeItem = this.item(this.treeHover); if (treeItem) box(treeItem, '#ff9a2e', 3);
      const it = this.sel && this.item(this.sel);
      if (it) {
        const r = this.disp(it), o = this.peek(it);
        for (const g of this.sameGroup(it)) if (g.id !== it.id) box(g, '#00e5ff', 1.5, [2, 3]);       // other instances of the same component
        if (it.parent && this.item(it.parent)) box(this.item(it.parent), '#d070ff', 2, [6, 4]);       // parent: purple dashed
        for (const c of this.descendants(it.id)) box(c, '#4cff7a', 1.5, [3, 3]);                       // followers: green dashed
        box(it, '#ffe14a', 2.5);
        ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) { ctx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE); ctx.strokeRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE); }
        const kids = this.descendants(it.id).length;
        const label = `${it.name}   dx ${o.dx.toFixed(1)}  dy ${o.dy.toFixed(1)}  ×${o.sx.toFixed(2)}${it.textual ? '' : ' ×' + o.sy.toFixed(2)}${o.hidden || this.disp(it).hidden ? '   [已删除]' : ''}${it.parent ? '   父:' + it.parent.split(':')[1] : ''}${kids ? `   跟随 ${kids} 项` : ''}${this.sameGroup(it).length > 1 ? `   同款 ${this.sameGroup(it).length} 个` : ''}`, w = ctx.measureText(label).width + 14, ly = r.y > 44 ? r.y - 14 : r.y + r.h + 14;
        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(r.x, ly - 11, w, 22); ctx.fillStyle = '#ffe14a'; ctx.fillText(label, r.x + 7, ly);
      }
      const n = Object.keys(this.L.overrides[this.sk] || {}).length;
      ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, E.W, 30);
      ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.arc(16, 15, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(`录制中 · ${this.sk} · ${items.length} 项 · 本页已改 ${n} · 同步${this.sync ? '开' : '关'}`, 30, 15);
      ctx.fillStyle = '#ddd'; ctx.font = '13px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(HELP, E.W - 8, 15); ctx.textAlign = 'left';
    }
    if (toast) { ctx.font = 'bold 18px sans-serif'; const w = ctx.measureText(toast.text).width + 30; ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect((E.W - w) / 2, E.H - 70, w, 40); ctx.fillStyle = '#8dff9a'; ctx.textAlign = 'center'; ctx.fillText(toast.text, E.W / 2, E.H - 50); }
    ctx.restore();
  }
}
