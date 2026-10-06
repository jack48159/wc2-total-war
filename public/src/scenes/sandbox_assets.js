import { authFetch, authToken, requireNetworkLogin } from '../core/auth.js';
import { localRead, localWrite } from '../core/local_data.js';
import { element, loadSandboxStyles } from './sandbox_ui.js';
const assetUrl=id=>'https://208.87.207.49/api/library/files/'+id;
async function request(path,options={}){const r=await authFetch(path,options),data=await r.json();if(!r.ok)throw Error(data.error||'素材库请求失败');return data;}
export function assetIds(config){const ids=new Set();const walk=(v,depth=0)=>{if(depth>24)return;if(typeof v==='string'){const match=/^https:\/\/208\.87\.207\.49\/api\/library\/files\/([0-9a-f-]{36})$/.exec(v);if(match)ids.add(match[1]);}else if(v&&typeof v==='object')for(const child of Object.values(v))walk(child,depth+1);};walk(config);return [...ids];}
export async function syncAssetRefs(workId,title,config){const ids=assetIds(config);if(!authToken()){if(ids.length)throw Error('含素材的作品需要登录后保存素材引用');return;}await request('/api/library/refs',{method:'POST',body:JSON.stringify({workId,title,assets:ids})});}
export async function pinSharedAssets(config){if(!assetIds(config).length)return;await requireNetworkLogin();const bytes=new TextEncoder().encode(JSON.stringify(config)),digest=await crypto.subtle.digest('SHA-256',bytes),id='share-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');await syncAssetRefs(id,config.name+'（已分享）',config);}

const CATEGORIES = [['other','其他'],['unit','兵种'],['card','卡牌'],['event','事件插图'],['cover','战役封面']];
const bytesLabel = n => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.ceil(n / 1024) + ' KB';
const tagsOf = value => [...new Set(value.split(/[,，、\n]/).map(t => t.trim()).filter(Boolean))];
const categoryName = id => CATEGORIES.find(c => c[0] === id)?.[1] || '其他';

function button(parent, text, run, className = '') {
  const b = element(parent, 'button', text, 'mp-header-btn ' + className);
  b.type = 'button'; b.onclick = run; return b;
}
function field(parent, title, value = '', type = 'text') {
  const label = element(parent, 'label', title);
  const input = element(label, 'input'); input.type = type; input.value = value;
  return input;
}
function selectField(parent, title, items, value) {
  const label = element(parent, 'label', title), input = element(label, 'select');
  for (const [id, text] of items) { const option = element(input, 'option', text); option.value = id; }
  input.value = value; return input;
}
function confirmDialog(parent, title, text) {
  return new Promise(resolve => {
    const overlay = element(parent, 'div', '', 'sb-library-confirm');
    const panel = element(overlay, 'section'); panel.setAttribute('role', 'alertdialog');
    element(panel, 'h3', title); element(panel, 'p', text);
    const finish = ok => { overlay.remove(); resolve(ok); };
    button(panel, '取消', () => finish(false)).focus();
    button(panel, '确认', () => finish(true), 'is-danger');
  });
}

export async function showAssetLibrary(select = null, options = {}) {
  await requireNetworkLogin(); await loadSandboxStyles();
  const screen = element(document.body, 'div', '', 'sb-library');
  screen.setAttribute('role', 'dialog'); screen.setAttribute('aria-modal', 'true'); screen.setAttribute('aria-label', '个人素材库');
  const previousFocus = document.activeElement;
  const state = { assets: [], chosen: new Set(), query: '', category: 'all', usage: 'all', sort: 'newest', active: null };
  const header = element(screen, 'header', '', 'sb-library-header');
  const title = element(header, 'div'); element(title, 'h2', select ? '选择素材' : '个人素材库'); element(title, 'p', '兵种 · 卡牌 · 事件 · 战役');
  const headerActions = element(header, 'div', '', 'sb-library-actions');
  const status = element(screen, 'p', '正在读取素材…', 'sb-library-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const run = fn => async () => { try { await fn(); } catch (e) { status.textContent = e.message; } };
  const close = () => { if (screen.querySelector('.sb-library-upload')) return; screen.remove(); options.onClose?.(); previousFocus?.focus?.(); };
  button(headerActions, '上传素材', run(() => chooseFiles()), 'is-primary');
  button(headerActions, '关闭', close);
  const tabs=element(screen,'nav','','sb-library-bulk');
  button(tabs,'图片素材',()=>{});
  if(!select)for(const [kind,title] of [['unit','兵种素材'],['card','卡牌素材']])button(tabs,title,run(async()=>{const {showContentLibrary}=await import('./sandbox_content_library.js');await showContentLibrary(kind,options.editor); }));
  const quota = element(screen, 'section', '', 'sb-library-quota');
  const quotaLabel = element(quota, 'span'); const meter = element(quota, 'progress'); meter.max = 30 * 1048576;
  const controls = element(screen, 'section', '', 'sb-library-controls');
  const search = field(controls, '搜索名称或标签'); search.type = 'search'; search.placeholder = '输入关键词';
  const category = selectField(controls, '分类', [['all','全部素材'], ...CATEGORIES], 'all');
  const usage = selectField(controls, '使用状态', [['all','全部'],['unused','未使用'],['used','已被作品引用']], 'all');
  const sort = selectField(controls, '排序', [['newest','最新上传'],['name','名称'],['largest','占用空间']], 'newest');
  const bulk = element(screen, 'section', '', 'sb-library-bulk');
  const body = element(screen, 'main', '', 'sb-library-body');
  const grid = element(body, 'section', '', 'sb-library-grid');
  const detail = element(body, 'aside', '', 'sb-library-detail');
  const footer = element(screen, 'footer', '支持 PNG、JPEG、WebP · 每账号 30 MB · 单张上传后最多 4 MB');
  const selectedAssets = () => state.assets.filter(a => state.chosen.has(a.id));
  const filtered = () => state.assets.filter(a => (state.category === 'all' || a.category === state.category) &&
    (state.usage === 'all' || (a.references.length > 0) === (state.usage === 'used')) &&
    (!state.query || [a.name, ...(a.tags || [])].join(' ').toLocaleLowerCase().includes(state.query)))
    .sort((a,b) => state.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : state.sort === 'largest' ? b.size - a.size : 0);
  async function refresh(message) {
    const data = await request('/api/library/assets'); if (!screen.isConnected) return;
    state.assets = data.assets;
    state.chosen = new Set([...state.chosen].filter(id => state.assets.some(a => a.id === id)));
    quotaLabel.textContent = '已用 ' + bytesLabel(data.used) + ' / 30 MB · ' + state.assets.length + ' 张素材';
    meter.value = data.used; quota.dataset.full = data.used > data.limit * .9;
    if (state.active) state.active = state.assets.find(a => a.id === state.active.id) || null;
    render(); if (message) status.textContent = message;
  }
  const onFilter = () => { state.query = search.value.trim().toLocaleLowerCase(); state.category = category.value; state.usage = usage.value; state.sort = sort.value; render(); };
  search.oninput = onFilter; category.onchange = usage.onchange = sort.onchange = onFilter;
  function render() {
    const assets = filtered(); grid.replaceChildren(); bulk.replaceChildren();
    element(bulk, 'span', '显示 ' + assets.length + ' 张 · 已选 ' + state.chosen.size + ' 张');
    button(bulk, '全选当前结果', () => { for (const a of assets) state.chosen.add(a.id); render(); });
    if (state.chosen.size) {
      button(bulk, '取消选择', () => { state.chosen.clear(); render(); });
      const move = selectField(bulk, '批量分类', [['','选择分类'], ...CATEGORIES], '');
      move.onchange = run(async () => { if (!move.value) return; for (const a of selectedAssets()) await updateMeta(a, {category:move.value}); await refresh('分类已更新'); });
      button(bulk, '删除所选', run(async () => {
        const owned = selectedAssets(), unused = owned.filter(a => !a.references.length);
        if (!unused.length) throw Error('所选素材均被作品引用，请在详情查看引用后处理');
        if (!await confirmDialog(screen, '删除素材', '删除 ' + unused.length + ' 张未使用素材？被引用的 ' + (owned.length-unused.length) + ' 张会保留。删除无法撤销。')) return;
        let deleted = 0, blocked = 0;
        for (let i = 0; i < unused.length; i += 100) {
          const result = await request('/api/library/assets/delete', {method:'POST',body:JSON.stringify({ids:unused.slice(i,i+100).map(a => a.id)})});
          deleted += result.deleted.length; blocked += result.blocked.length;
        }
        await refresh('已删除 ' + deleted + ' 张' + (blocked ? '，另有 ' + blocked + ' 张因新增引用被保留' : ''));
      }), 'is-danger');
    }
    for (const asset of assets) {
      const card = element(grid, 'article', '', 'sb-library-card'); card.dataset.active = asset.id === state.active?.id;
      const check = element(card, 'input'); check.type = 'checkbox'; check.checked = state.chosen.has(asset.id); check.setAttribute('aria-label', '选择 ' + asset.name);
      check.onchange = () => { check.checked ? state.chosen.add(asset.id) : state.chosen.delete(asset.id); render(); };
      const view = button(card, '', () => { state.active = asset; render(); detail.scrollTop = 0; }, 'sb-library-thumb');
      view.setAttribute('aria-label', '查看 ' + asset.name); const img = element(view, 'img'); img.src = assetUrl(asset.id); img.alt = asset.name; img.loading = 'lazy';
      element(card, 'h3', asset.name); element(card, 'p', categoryName(asset.category) + ' · ' + bytesLabel(asset.size));
      element(card, 'small', asset.references.length ? '已引用' : '未使用');
      if (select) button(card, '使用', () => { select(assetUrl(asset.id)); close(); }, 'is-primary');
    }
    if (!assets.length) {
      const empty = element(grid, 'div', '', 'sb-library-empty');
      element(empty, 'h3', state.assets.length ? '没有匹配的素材' : '把你的战场素材放进来');
      element(empty, 'p', state.assets.length ? '试试其他关键词或分类。' : '上传兵种图标、卡牌、事件插图或战役封面，桌面端也可拖入图片。');
      button(empty, '上传素材', run(() => chooseFiles()), 'is-primary');
    }
    renderDetail();
  }
  async function updateMeta(asset, changes) {
    await request('/api/library/assets/' + asset.id, {method:'POST',body:JSON.stringify({name:asset.name,category:asset.category,tags:asset.tags,...changes})});
  }
  function renderDetail() {
    detail.replaceChildren(); const asset = state.active; body.dataset.detail = !!asset;
    if (!asset) { element(detail, 'h3', '素材详情'); element(detail, 'p', '点选素材可预览、重命名、分类，或查看引用它的作品。'); return; }
    button(detail, '返回素材列表', () => { state.active = null; render(); }, 'sb-library-detail-back');
    element(detail, 'h3', asset.name);
    const preview = element(detail, 'div', '', 'sb-library-preview'); preview.dataset.background = 'checker';
    const img = element(preview, 'img'); img.src = assetUrl(asset.id); img.alt = asset.name;
    const bg = selectField(detail, '预览背景', [['checker','透明棋盘'],['dark','深色'],['light','浅色']], 'checker'); bg.onchange = () => preview.dataset.background = bg.value;
    const zoom = field(detail, '预览缩放', 100, 'range'); zoom.min = 50; zoom.max = 250; zoom.oninput = () => img.style.width = zoom.value + '%';
    element(detail, 'p', (asset.width ? asset.width + ' × ' + asset.height + ' · ' : '') + asset.mime.replace('image/','').toUpperCase() + ' · ' + bytesLabel(asset.size));
    const name = field(detail, '素材名称', asset.name); name.maxLength = 80;
    const type = selectField(detail, '素材分类', CATEGORIES, asset.category);
    const tags = field(detail, '标签（逗号分隔，最多 8 个）', (asset.tags || []).join('，'));
    button(detail, '保存名称与分类', run(async () => { const list = tagsOf(tags.value); if (!name.value.trim()) throw Error('请填写素材名称'); if (list.length > 8) throw Error('每张素材最多 8 个标签'); await updateMeta(asset,{name:name.value.trim(),category:type.value,tags:list}); await refresh('素材信息已保存'); }), 'is-primary');
    if (select) button(detail, '使用此素材', () => { select(assetUrl(asset.id)); close(); }, 'is-primary');
    button(detail, '上传新版本', run(() => chooseFiles(asset)));
    element(detail, 'p', '新版本可替换本机作品中的图片，已分享的版本和正在进行的对局保持原图。', 'sb-library-hint');
    element(detail, 'h4', '作品引用');
    if (!asset.referenceDetails?.length) element(detail, 'p', '暂无引用，可直接删除。');
    for (const ref of asset.referenceDetails || []) {
      const row = element(detail, 'div', '', 'sb-library-reference'); element(row, 'span', ref.title);
      if (ref.own && ref.shared) button(row, '取消分享保留', run(async () => {
        if (!await confirmDialog(screen,'取消分享保留','取消后，若没有其他作品引用，你可以删除素材。之后旧分享码里的图片可能无法加载；已被其他玩家保存的引用仍会保留。')) return;
        await request('/api/library/refs/release',{method:'POST',body:JSON.stringify({workId:ref.workId})}); await refresh('已取消该分享版本的素材保留');
      }));
    }
    if (asset.references.length) element(detail, 'p', '本机作品请在编辑器移除图片或删除作品后，再删除素材。其他玩家仍在使用的素材会继续保留。', 'sb-library-hint');
    const del = button(detail, '删除素材', run(async () => {
      if (!await confirmDialog(screen, '删除素材', '删除“' + asset.name + '”？此操作无法撤销。')) return;
      await request('/api/library/files/' + asset.id, {method:'DELETE'}); state.active = null; await refresh('素材已删除');
    }), 'is-danger'); del.disabled = !!asset.references.length;
  }
  function chooseFiles(replace = null) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = !replace;
    input.onchange = () => { if (input.files?.length) uploadQueue([...input.files], replace); }; input.click();
  }
  screen.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); screen.classList.add('is-dragging'); } });
  screen.addEventListener('dragleave', e => { if (!screen.contains(e.relatedTarget)) screen.classList.remove('is-dragging'); });
  screen.addEventListener('drop', e => { e.preventDefault(); screen.classList.remove('is-dragging'); if (!screen.querySelector('.sb-library-upload') && e.dataTransfer?.files.length) uploadQueue([...e.dataTransfer.files]); });
  async function replaceLocalWorks(oldId, newId) {
    if (oldId === newId) return 0;
    if(options.editor)await options.editor.save();
    const works = await localRead('sandbox-designs') || [], updated = structuredClone(works); let count = 0;
    function rewrite(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) { if (item === assetUrl(oldId)) value[key] = assetUrl(newId); else if (item && typeof item === 'object') rewrite(item); }
    }
    for (const work of updated) if (assetIds(work.config).includes(oldId)) { rewrite(work.config); work.updatedAt = Date.now(); count++; }
    // Persist replacements before removing old reference protection.
    if (count) { await localWrite('sandbox-designs', updated); for (const work of updated) if (assetIds(work.config).includes(newId)) await syncAssetRefs(work.id, work.name, work.config); }
    if(count&&options.editor){const current=updated.find(w=>w.id===options.editor.id);if(current){options.editor.config=structuredClone(current.config);options.editor.renderPanel();options.editor.drawMap();}}
    return count;
  }
  function uploadQueue(files, replace = null) {
    if (screen.querySelector('.sb-library-upload')) return;
    if (files.length > 30) { status.textContent = '一次最多上传 30 张图片，请分批上传'; return; }
    const overlay = element(screen, 'div', '', 'sb-library-upload'); const panel = element(overlay, 'section');
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','上传素材');
    element(panel, 'h3', replace ? '上传素材新版本' : '批量上传素材');
    element(panel, 'p', '源文件最多 12 MB，压缩后每张最多 4 MB。重复图片自动复用，不重复占空间。');
    const settings = element(panel, 'div', '', 'sb-library-upload-settings');
    const type = selectField(settings, '上传分类', CATEGORIES, replace?.category || (state.category === 'all' ? 'other' : state.category));
    const size = selectField(settings, '最大边长', [['2048','2048 像素 · 插图与封面'],['1024','1024 像素 · 卡牌'],['512','512 像素 · 兵种图标']], '2048');
    const quality = selectField(settings, '图片质量', [['0.9','高清'],['0.75','均衡'],['0.55','节省空间']], '0.9');
    const crop = selectField(settings, '裁剪方式', [['keep','保留完整图片'],['square','中心裁剪为正方形']], 'keep');
    let replaceCheck;
    if (replace) { const label = element(panel,'label','','sb-library-checkbox'); replaceCheck = element(label,'input'); replaceCheck.type='checkbox'; replaceCheck.checked=true; element(label,'span','同步替换本机已保存作品中的引用'); }
    const queue = element(panel, 'div', '', 'sb-library-upload-list');
    const jobs = files.map(file => {
      const row = element(queue, 'article'); const img = element(row,'img'),url = URL.createObjectURL(file); img.src = url; img.alt = file.name;
      const info = element(row,'div'); const name = field(info,'素材名称',replace?.name || file.name.replace(/\.[^.]+$/, '')); name.maxLength=80;
      const tags = field(info,'标签（逗号分隔）',(replace?.tags || []).join('，'));
      const label = element(info,'p',bytesLabel(file.size) + ' · 等待处理');
      const job = {file,row,img,url,name,tags,label,state:'queued'};
      button(row,'处理预览',async()=>{if(busy)return;try{const blob=await prepareImage(file,{size:Number(size.value),quality:Number(quality.value),square:crop.value==='square'});const previewUrl=URL.createObjectURL(blob);URL.revokeObjectURL(job.url);job.url=previewUrl;job.img.src=previewUrl;job.label.textContent=bytesLabel(file.size)+' → '+bytesLabel(blob.size)+' · 尚未上传';}catch(e){job.label.textContent=e.message;}});
      button(row,'移除',()=>{ if(busy) return; job.state='removed';row.remove();URL.revokeObjectURL(url); });
      return job;
    });
    const report = element(panel,'p','','sb-library-queue-status'); report.setAttribute('aria-live','polite');
    const progress = element(panel,'progress'); progress.max=jobs.length;progress.value=0;
    const actions = element(panel,'div','','sb-library-actions'); let busy=false,stopped=false;
    const dismiss = () => { for(const j of jobs) URL.revokeObjectURL(j.url);overlay.remove(); };
    const closeButton = button(actions,'取消',()=>{if(busy){stopped=true;closeButton.textContent='将在当前图片完成后停止';return;}dismiss();});
    const upload = button(actions,'开始上传',async()=>{
      if(busy)return;busy=true;stopped=false;upload.disabled=true;closeButton.textContent='停止后续上传';
      const controls=[type,size,quality,crop,replaceCheck,...jobs.flatMap(j=>[j.name,j.tags])].filter(Boolean);for(const c of controls)c.disabled=true;
      let succeeded=0,failed=0;
      try {
        for(const job of jobs){if(stopped)break;if(['done','removed'].includes(job.state))continue;
          try{
            if(!job.name.value.trim())throw Error('请填写名称');const tags=tagsOf(job.tags.value);if(tags.length>8)throw Error('最多 8 个标签');
            job.label.textContent='正在读取和压缩…';const blob=await prepareImage(job.file,{size:Number(size.value),quality:Number(quality.value),square:crop.value==='square'});
            const previewUrl=URL.createObjectURL(blob);URL.revokeObjectURL(job.url);job.url=previewUrl;job.img.src=previewUrl;
            if(blob.size>4*1048576)throw Error('压缩后仍超过 4 MB，请调小尺寸或降低质量');
            job.label.textContent=bytesLabel(job.file.size)+' → '+bytesLabel(blob.size)+' · 正在上传…';
            const raw=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<raw.length;i+=8192)binary+=String.fromCharCode(...raw.subarray(i,i+8192));
            const result=await request('/api/library/assets',{method:'POST',body:JSON.stringify({name:job.name.value.trim(),category:type.value,tags,base64:btoa(binary)})});
            let changed=0;if(replace&&replaceCheck.checked)changed=await replaceLocalWorks(replace.id,result.asset.id);
            job.label.textContent=(result.duplicate?'已复用已有素材':'上传完成')+' · '+bytesLabel(result.asset.size)+(changed?' · 已更新 '+changed+' 个本机作品':'');
            job.state='done';succeeded++;
          }catch(e){job.state='failed';job.label.textContent=e.message;failed++;}
          progress.value=jobs.filter(j=>j.state==='done'||j.state==='removed').length;
        }
        await refresh('素材库已更新');
        report.textContent='本次完成 '+succeeded+' 张，失败 '+failed+' 张'+(stopped?'，其余已暂停':'');
      }catch(e){report.textContent=e.message;}finally{
        busy=false;for(const c of controls)c.disabled=false;closeButton.textContent='完成';
        upload.textContent='重试 / 继续上传';upload.disabled=jobs.every(j=>['done','removed'].includes(j.state));
      }
    },'is-primary');
  }
  try { await refresh('点击素材查看详情，或上传新素材。'); } catch(e) { status.textContent=e.message;button(headerActions,'重新加载',run(()=>refresh())); }
  search.focus();
}

async function prepareImage(file, {size,quality,square}) {
  if(file.size>12*1048576)throw Error('源图片不能超过 12 MB');
  if(!/^image\/(png|jpeg|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name))throw Error('仅支持 PNG、JPEG、WebP 图片');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('图片无法读取'));image.src=url;});
    if(!image.width||!image.height||image.width*image.height>32000000)throw Error('源图片尺寸过大，最多 3200 万像素');
    const w=square?Math.min(image.width,image.height):image.width,h=square?w:image.height;
    const scale=Math.min(1,size/w,size/h),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    canvas.getContext('2d').drawImage(image,(image.width-w)/2,(image.height-h)/2,w,h,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(!blob)throw Error('图片压缩失败');return blob;
  }finally{URL.revokeObjectURL(url);}
}
