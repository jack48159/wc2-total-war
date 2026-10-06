import { authFetch,authToken,requireNetworkLogin } from '../core/auth.js';
import { localWrite } from '../core/local_data.js';
import { World } from '../game/world.js';
import { validateSandbox } from '../game/sandbox_config.js';
import { E } from '../core/index.js';
import { sandboxLibrary } from './sandbox_editor.js';
import { syncAssetRefs } from './sandbox_assets.js';
import { showSandboxShare } from './sandbox_share.js';
import { element,flagButton } from './sandbox_ui.js';

async function request(path,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await authFetch(path,{...options,signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;}catch(error){if(error.name==='AbortError')throw Error('请求超时，请重试');throw error;}finally{clearTimeout(timer);}}
function dialog(title){const overlay=element(document.body,'div','','sb-share-overlay'),panel=element(overlay,'section','','sb-share-dialog sb-mod-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);element(panel,'h2',title);const close=()=>overlay.remove();return {overlay,panel,close};}
function button(parent,label,run,status){const b=element(parent,'button',label,'mp-header-btn');b.type='button';b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await run();}catch(error){status.textContent=error.message;}finally{b.disabled=false;}};return b;}
export function installModHall(Menu){Object.assign(Menu.prototype,{
 async refreshPublished(){this.publishedWorks=new Map();if(!authToken())return;try{let offset=0;do{const data=await request('/api/mods?mine=1&offset='+offset);for(const m of data.mods)this.publishedWorks.set(m.workId,m);if(!data.hasMore)break;offset+=24;}while(offset<120);}catch(error){this.status.textContent='本地作品已加载；发布状态暂不可用：'+error.message;}},
 renderWorks(grid,match){
  const toolbar=element(this.body,'div','','sb-library-toolbar');this.body.insertBefore(toolbar,grid);
  const list=(this.library||[]).filter(r=>match(r.name));element(toolbar,'span','我的作品 · '+list.length+' 个');
  const sort=element(toolbar,'select');sort.setAttribute('aria-label','作品排序');for(const [id,label]of [['recent','最近编辑'],['name','名称排序']]){const o=element(sort,'option',label);o.value=id;}sort.value=this.workSort||'recent';sort.onchange=()=>{this.workSort=sort.value;this.renderCards();};
  list.sort(this.workSort==='name'?(a,b)=>a.name.localeCompare(b.name,'zh-CN'):(a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  for(const record of list){
   const config=record.config,published=this.publishedWorks?.get(record.id),body=this.card(grid,record.name,'',config.features?.coverUrl||'assets/map/original-world-preview.webp');
   body.parentElement.classList.add('sb-work-card');
   const tags=element(body,'div','','sb-work-meta');for(const text of [config.countries.length+' 国',config.areas.length+' 地块',config.areas.reduce((n,a)=>n+a.armies.length,0)+' 支部队',(config.scenarioEvents?.definitions?.length||0)+' 个事件'])element(tags,'span',text);
   element(body,'p','最近编辑：'+(record.updatedAt?new Date(record.updatedAt).toLocaleString():'未记录'),'sb-work-date');
   if(published?.published)element(body,'p','已共享 · 作者 '+published.author+' · v'+published.version+' · '+published.likes+' 赞','sb-publish-badge');
   else if(record.modSource)element(body,'p','来自 Mod 大厅 · '+record.modSource.author+' · v'+record.modSource.version,'sb-work-origin');
   const flags=element(body,'div','','sb-card-flags');for(const country of config.countries.slice(0,3))flagButton(flags,country,this.name(country.id),country.id===config.player,()=>{});
   const actions=element(body,'div','','sb-card-actions sb-work-primary');this.button(actions,'开始作战',()=>this.playWork(record));this.button(actions,'继续编辑',()=>E.go('sandboxEditor',this,config.stage,{},record));
   const share=element(body,'div','','sb-card-actions');this.button(share,published?.published?'更新共享作品':'共享到 Mod 大厅',()=>this.publishWork(record));
   const more=element(body,'details','','sb-work-more');element(more,'summary','更多操作');const tools=element(more,'div','','sb-card-actions');
   this.button(tools,'复制分享码',()=>showSandboxShare(config));this.button(tools,'创建联机房间',()=>this.hostWork(record));
   this.button(tools,'复制为新作品',async()=>{const copy=structuredClone(record);copy.id=crypto.randomUUID();copy.name+=' · 副本';copy.config.name=copy.name;delete copy.publication;copy.updatedAt=Date.now();const library=await sandboxLibrary();library.unshift(copy);await syncAssetRefs(copy.id,copy.name,copy.config);await localWrite('sandbox-designs',library);this.library=library;this.renderCards();});
   if(published?.published)this.button(tools,'删除大厅共享',()=>this.unpublishWork(record,published));
   const del=this.button(tools,'删除本地作品',async()=>{if(this.deletePending!==record.id){this.deletePending=record.id;del.textContent='再次点击确认删除';this.status.textContent=published?.published?'只删除本地作品，大厅共享仍保留。':'再次点击确认删除本地作品。';return;}if(authToken())await syncAssetRefs(record.id,record.name,{});this.library=(await sandboxLibrary()).filter(r=>r.id!==record.id);await localWrite('sandbox-designs',this.library);this.deletePending=null;this.renderCards();});
  }
 },
 async playWork(record){await World.load();validateSandbox(record.config);E.go('matchSetup',this,record.config.stage,{sandbox:true,sandboxCustom:true,sandboxConfig:structuredClone(record.config),participatingCountries:record.config.countries.map(c=>c.id),player:record.config.player,freeDiplomacy:true,historicalDiplomacy:false},record.name);},
 async hostWork(record){await World.load();validateSandbox(record.config);await requireNetworkLogin();const data=await request('/api/mp/rooms',{method:'POST',body:JSON.stringify({stage:record.config.stage,name:record.name,playerLimit:Math.min(4,record.config.countries.filter(c=>!c.dormant).length),customContentEnabled:true,sandboxConfig:record.config,fogOfWar:!!record.config.features?.fogOfWar})});E.go('multiplayer',data.room.id);},
 async publishWork(record){
  const user=await requireNetworkLogin(),d=dialog('共享作品到 Mod 大厅');element(d.panel,'p','作者：'+user.username+'。发布当前已保存配置，其他玩家可保存到自己的作品；之后编辑不会自动改变大厅版本。');
  const titleLabel=element(d.panel,'label','作品名称'),title=element(titleLabel,'input');title.value=record.name;title.maxLength=80;
  const descriptionLabel=element(d.panel,'label','玩法简介'),description=element(descriptionLabel,'textarea');description.maxLength=1200;description.value=this.publishedWorks?.get(record.id)?.description||'';description.placeholder='介绍目标、特殊规则和推荐玩法';
  const status=element(d.panel,'p','','sb-dialog-status'),actions=element(d.panel,'div','','sb-card-actions');
  button(actions,'返回',d.close,status);button(actions,'确认共享',async()=>{status.textContent='正在发布作品…';const {mod}=await request('/api/mods',{method:'POST',body:JSON.stringify({workId:record.id,title:title.value,description:description.value,config:structuredClone(record.config)})});record.publication={id:mod.id,version:mod.version,author:mod.author};const library=await sandboxLibrary(),local=library.find(w=>w.id===record.id);if(local)local.publication=record.publication;await localWrite('sandbox-designs',library);this.library=library;this.publishedWorks||=new Map();this.publishedWorks.set(record.id,mod);d.close();this.renderCards();this.status.textContent='共享成功，作品已出现在 Mod 大厅 · 作者 '+mod.author;},status);title.focus();
 },
 async unpublishWork(record,mod){return this.deleteSharedMod(mod);},
 async deleteSharedMod(mod,onDeleted=null){
  const d=dialog('删除共享 Mod');element(d.panel,'p','确定删除大厅中的“'+mod.title+'”？共享记录和点赞会被删除，本地作品及其他玩家已保存的副本会保留。重新共享会作为新的发布。');
  const status=element(d.panel,'p');button(d.panel,'返回',d.close,status);
  const remove=button(d.panel,'确认删除共享',async()=>{status.textContent='正在删除共享…';await request('/api/mods/'+mod.id,{method:'DELETE'});this.publishedWorks?.delete(mod.workId);d.close();onDeleted?.();this.renderCards();this.status.textContent='共享 Mod 已删除，本地作品保留。';},status);remove.classList.add('is-danger');
 },
 async renderHall(){
  const token=this.hallRequest=(this.hallRequest||0)+1,query=this.search,offset=this.hallOffset||0;
  const toolbar=element(this.body,'div','','sb-library-toolbar');element(toolbar,'span','玩家共享战役 · 显示作者 · 支持点赞');
  const sort=element(toolbar,'select');sort.setAttribute('aria-label','大厅排序');for(const [id,label]of [['recent','最新更新'],['popular','最多点赞']]){const o=element(sort,'option',label);o.value=id;}sort.value=this.hallSort||'recent';sort.onchange=()=>{this.hallSort=sort.value;this.hallOffset=0;this.renderCards();};
  const grid=element(this.body,'div','','sb-menu-grid'),loading=element(grid,'p','正在加载 Mod 大厅…');
  try{const data=await request('/api/mods?q='+encodeURIComponent(query)+'&sort='+(this.hallSort||'recent')+'&offset='+offset);if(this.hallRequest!==token||this.tab!=='mods'||!this.root.isConnected)return;loading.remove();
   for(const mod of data.mods){const body=this.card(grid,mod.title,mod.description||'作者未填写玩法简介',mod.coverUrl||'assets/map/original-world-preview.webp');body.parentElement.classList.add('sb-mod-card');element(body,'p','作者：'+mod.author+' · v'+mod.version,'sb-publish-badge');element(body,'p',mod.countryCount+' 国 · '+mod.unitCount+' 支部队 · '+mod.eventCount+' 个事件','sb-work-date');const actions=element(body,'div','','sb-card-actions');this.button(actions,'查看 / 保存作品',()=>this.showMod(mod));if(mod.own){const remove=this.button(actions,'删除共享',()=>this.deleteSharedMod(mod));remove.classList.add('is-danger');}const like=this.button(actions,(mod.liked?'♥ 已赞 ':'♡ 点赞 ')+mod.likes,async()=>{like.disabled=true;try{await requireNetworkLogin();const result=await request('/api/mods/'+mod.id+'/like',{method:'PUT',body:JSON.stringify({liked:!mod.liked})});mod.liked=result.liked;mod.likes=result.likes;like.textContent=(mod.liked?'♥ 已赞 ':'♡ 点赞 ')+mod.likes;}finally{like.disabled=false;}});}
   if(!data.mods.length)element(grid,'p',query?'没有匹配的共享作品。':'大厅还没有作品，可以从“我的作品”发布第一场战役。');
   const pages=element(this.body,'div','','sb-hall-pages');if(offset)this.button(pages,'上一页',()=>{this.hallOffset=Math.max(0,offset-24);this.renderCards();});element(pages,'span','第 '+(Math.floor(offset/24)+1)+' 页');if(data.hasMore)this.button(pages,'下一页',()=>{this.hallOffset=offset+24;this.renderCards();});this.status.textContent='从“我的作品”共享，其他玩家即可在这里看到。';
  }catch(error){if(this.hallRequest!==token||this.tab!=='mods')return;loading.textContent='大厅暂不可用：'+error.message;this.button(grid,'重新加载',()=>this.renderCards());}
 },
 async showMod(mod){
  const d=dialog(mod.title),status=element(d.panel,'p','正在读取作品…');button(d.panel,'返回大厅',d.close,status);
  let data;try{data=await request('/api/mods/'+mod.id);}catch(error){status.textContent='无法读取作品：'+error.message;return;}if(!d.overlay.isConnected)return;status.textContent='作者：'+data.mod.author+' · v'+data.mod.version+' · '+data.mod.likes+' 赞';element(d.panel,'p',data.mod.description||'未填写玩法简介');element(d.panel,'p',data.mod.countryCount+' 国 · '+data.mod.areaCount+' 地块 · '+data.mod.unitCount+' 支部队');
  if(data.mod.own){const remove=button(d.panel,'删除共享',()=>this.deleteSharedMod(data.mod,d.close),status);remove.classList.add('is-danger');}
  button(d.panel,'保存到我的作品',async()=>{await requireNetworkLogin();await World.load();const stage=await E.json('data/stages/'+data.config.stage+'.json');if(stage.mapPatch)World.applyPatch(stage.mapPatch,stage.mirror);validateSandbox(data.config);let library=await sandboxLibrary();const existing=library.find(w=>w.modSource?.id===mod.id&&w.modSource?.version===data.mod.version);if(existing){status.textContent='此版本已经保存在你的作品中。';return;}const record={id:crypto.randomUUID(),name:data.mod.title,updatedAt:Date.now(),config:structuredClone(data.config),modSource:{id:mod.id,author:data.mod.author,version:data.mod.version}};await syncAssetRefs(record.id,record.name,record.config);library.unshift(record);await localWrite('sandbox-designs',library);this.library=library;d.close();this.tab='library';this.search='';this.renderCards();this.status.textContent='已保存为本地作品，可编辑、开始作战或创建联机房间。';},status);
 }
});}
