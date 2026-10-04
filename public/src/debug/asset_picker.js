// Modal asset picker for the layout editor ("add asset"): image files under public/assets, or single frames of an atlas.
// Resolves to { kind: 'image', src, w, h } | { kind: 'frame', atlas, frame, w, h } | null when cancelled.
import { E } from '../core/index.js';

const IMG = /\.(png|webp|jpe?g)$/i;
let listCache = null;
const files = async () => listCache || (listCache = fetch('/api/assets').then(r => r.json()).catch(() => []));

export async function pickAsset() {
  const all = await files();
  const images = all.filter(a => IMG.test(a.path) && !/^map\/|^zones\//.test(a.path));
  const atlases = all.filter(a => /\.xml$/i.test(a.path) && !a.path.includes('/')).map(a => a.path.replace(/\.xml$/i, ''));
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '15px "Microsoft YaHei",sans-serif' });
    wrap.innerHTML = `<div style="background:#231a10;border:2px solid #c9a464;border-radius:10px;padding:16px 18px;width:min(900px,92vw);height:min(640px,88vh);color:#f3e7c6;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:10px;align-items:center"><b style="font-size:18px">添加素材</b>
        <button data-t="img">图片文件</button><button data-t="frame">图集帧</button>
        <input class="q" placeholder="搜索" style="flex:1;padding:6px 8px"><select class="at" style="display:none;padding:6px"></select>
        <button class="x">取消</button></div>
      <div class="grid" style="flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;align-content:start"></div>
      <div class="hint" style="color:#cdbb95;font-size:13px">点击一项即可放到当前界面中央，然后可以拖动 / 缩放。</div></div>`;
    const grid = wrap.querySelector('.grid'), q = wrap.querySelector('.q'), sel = wrap.querySelector('.at'), hint = wrap.querySelector('.hint');
    let tab = 'img';
    const done = v => { wrap.remove(); resolve(v); };
    const cell = (label, node, onPick) => {
      const d = document.createElement('div');
      Object.assign(d.style, { background: '#3a2a18', border: '1px solid #6b4a22', borderRadius: '6px', padding: '6px', cursor: 'pointer', textAlign: 'center', overflow: 'hidden' });
      const box = document.createElement('div'); Object.assign(box.style, { height: '78px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-conic-gradient(#555 0 25%,#666 0 50%) 0 0/12px 12px' });
      box.appendChild(node); d.appendChild(box);
      const l = document.createElement('div'); l.textContent = label; Object.assign(l.style, { fontSize: '12px', marginTop: '4px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }); l.title = label; d.appendChild(l);
      d.onclick = onPick; return d;
    };
    const render = async () => {
      grid.textContent = ''; const key = q.value.trim().toLowerCase();
      if (tab === 'img') {
        sel.style.display = 'none';
        for (const a of images.filter(x => !key || x.path.toLowerCase().includes(key)).slice(0, 160)) {
          const im = new Image(); im.src = 'assets/' + a.path; im.loading = 'lazy'; Object.assign(im.style, { maxWidth: '100%', maxHeight: '78px' });
          grid.appendChild(cell(a.path, im, () => { const p = new Image(); p.onload = () => done({ kind: 'image', src: a.path, w: p.width, h: p.height }); p.src = 'assets/' + a.path; }));
        }
      } else {
        sel.style.display = '';
        if (!sel.value) { hint.textContent = '选择一个图集'; return; }
        let frames; try { frames = await E.atlas(sel.value); } catch (e) { hint.textContent = '这个 xml 不是图集：' + sel.value; return; }
        hint.textContent = '点击一项即可放到当前界面中央，然后可以拖动 / 缩放。';
        for (const [name, f] of Object.entries(frames).filter(([n]) => !key || n.toLowerCase().includes(key)).slice(0, 300)) {
          const cv = document.createElement('canvas'), k = Math.min(1, 78 / f.h, 100 / f.w); cv.width = Math.max(1, Math.round(f.w * k)); cv.height = Math.max(1, Math.round(f.h * k));
          cv.getContext('2d').drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, cv.width, cv.height);
          grid.appendChild(cell(name, cv, () => done({ kind: 'frame', atlas: sel.value, frame: name, w: f.w, h: f.h })));
        }
      }
    };
    sel.innerHTML = '<option value="">选择图集…</option>' + atlases.map(a => `<option>${a}</option>`).join('');
    wrap.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
    q.oninput = render; sel.onchange = render; wrap.querySelector('.x').onclick = () => done(null);
    wrap.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
    document.body.appendChild(wrap); q.focus(); render();
  });
}
