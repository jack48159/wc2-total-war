import { authFetch } from '../core/auth.js';
import { E } from '../core/index.js';
import { element } from './sandbox_ui.js';
import { validateFeatures } from '../game/sandbox_validation.js';

async function request(path, options={}) {
  const response=await authFetch(path,options),data=await response.json();
  if(!response.ok)throw Error(data.error||'创作素材请求失败');return data;
}
export async function showContentLibrary(initialKind='unit', editor=null) {
  const {SandboxEditor}=await import('./sandbox_editor.js');
  const screen=element(document.body,'div','','sb-library sb-content-library');
  screen.setAttribute('role','dialog');screen.setAttribute('aria-label','创作素材库');screen.setAttribute('aria-modal','true');
  const header=element(screen,'header','','sb-library-header');element(header,'h2','创作素材库');
  const status=element(screen,'p','正在读取创作素材…','sb-library-status');status.setAttribute('aria-live','polite');
  const run=fn=>async()=>{try{await fn();}catch(e){status.textContent=e.message;}};
  const button=(parent,title,fn)=>{const b=element(parent,'button',title,'mp-header-btn');b.type='button';b.onclick=run(fn);return b;};
  const tabs=element(screen,'nav','','sb-library-bulk');
  const controls=element(screen,'div','','sb-library-controls');const search=element(controls,'input');search.type='search';search.placeholder='搜索兵种或卡牌名称';search.setAttribute('aria-label','搜索创作素材');
  const body=element(screen,'main','','sb-library-body'),grid=element(body,'section','','sb-library-grid'),detail=element(body,'aside','','sb-library-detail');
  detail.style.width='min(460px,45vw)';
  element(screen,'footer','兵种、卡牌各最多 64 项 · 选入作品后保存副本 · 修改素材库不会自动改动旧作品或分享版本');
  let kind=initialKind,records=[],active=null,draft=null,dirty=false,adapter;
  async function confirmDiscard(){if(!dirty)return true;return await confirm('放弃未保存修改？');}
  async function confirm(text){return new Promise(resolve=>{const overlay=element(screen,'div','','sb-library-confirm'),panel=element(overlay,'section');element(panel,'h3',text);button(panel,'取消',()=>{overlay.remove();resolve(false);});button(panel,'确认',()=>{overlay.remove();resolve(true);});});}
  button(header,'返回图片素材',async()=>{if(await confirmDiscard())screen.remove();});
  for(const [id,name]of [['unit','兵种'],['card','卡牌']])button(tabs,name,async()=>{if(!await confirmDiscard())return;kind=id;active=null;draft=null;dirty=false;render();});
  button(tabs,'新建素材',async()=>{if(!await confirmDiscard())return;active={id:crypto.randomUUID(),kind};draft=kind==='unit'?{id:crypto.randomUUID(),recruitCardId:2000,name:'自定义步兵',base:'infantry',price:100,industry:20,stats:{maxHp:100,movement:2,minAttack:1,maxAttack:4,minRange:1,maxRange:1,receivedDamageMultiplier:1,attackMultiplier:1}}:{id:1000,name:'自定义援助',description:'为使用者增加资源',type:'strategy',target:'own',price:100,industry:0,cooldown:1,effects:[{type:'changeMoney',country:'actor',amount:200}],conditions:[]};dirty=true;renderForm();});
  search.oninput=()=>renderGrid();
  if(editor)button(tabs,'导入本作品已有素材',async()=>{const f=editor.features();let n=0;for(const [type,defs]of [['unit',f.units||[]],['card',f.cards||[]]])for(const definition of defs){const existing=records.find(r=>r.kind===type&&(type==='unit'?r.definition.id===definition.id:r.id===definition.libraryId));const id=existing?.id||crypto.randomUUID();await request('/api/library/content',{method:'POST',body:JSON.stringify({id,kind:type,definition})});n++;}await refresh('已导入 '+n+' 项作品素材');});
  const context=editor?structuredClone(editor.config):await E.json('data/stages/sandbox_world.json');
  const names=await E.json('data/countries.json');
  context.scenarioEvents||={definitions:[]};context.player||=context.countries[0].id;
  async function refresh(message){records=(await request('/api/library/content')).content;renderGrid();if(message)status.textContent=message;}
  function renderGrid(){grid.replaceChildren();for(const record of records.filter(r=>r.kind===kind&&r.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))){
    const card=element(grid,'article','','sb-library-card');card.dataset.active=record.id===active?.id;
    const b=button(card,'编辑',async()=>{if(!await confirmDiscard())return;active=record;draft=structuredClone(record.definition);dirty=false;renderForm();renderGrid();});
    if(record.definition.imageUrl){const img=element(card,'img');img.src=record.definition.imageUrl;img.alt=record.name;img.style.cssText='width:100%;height:110px;object-fit:contain';}
    element(card,'h3',record.name);element(card,'p',kind==='unit'?'基础兵种：'+record.definition.base:'卡牌：'+(record.definition.description||record.definition.type));
    if(editor)button(card,'选入当前作品',()=>addToWork(record));
  }if(!grid.children.length){const empty=element(grid,'div','','sb-library-empty');element(empty,'h3','还没有'+(kind==='unit'?'兵种':'卡牌')+'素材');element(empty,'p','点“新建素材”开始创作，保存后可在不同作品中复用。');}}
  function render(){renderGrid();renderForm();}
  function renderForm(){detail.replaceChildren();body.dataset.detail=!!draft;if(!draft){element(detail,'h3','选择素材开始编辑');return;}
    button(detail,'返回列表',async()=>{if(!await confirmDiscard())return;active=null;draft=null;dirty=false;render();});
    element(detail,'h3',kind==='unit'?'兵种创作':'卡牌创作');
    const actions=element(detail,'div','','sb-library-actions');
    button(actions,'保存到素材库',async()=>{
      validateFeatures(adapter.config);await request('/api/library/content',{method:'POST',body:JSON.stringify({id:active.id,kind,definition:draft})});dirty=false;await refresh('创作素材已保存');
    });
    if(editor)button(actions,'保存并选入作品',async()=>{validateFeatures(adapter.config);await request('/api/library/content',{method:'POST',body:JSON.stringify({id:active.id,kind,definition:draft})});dirty=false;await refresh();addToWork({id:active.id,kind,definition:draft});});
    if(records.some(r=>r.id===active.id))button(actions,'删除库中素材',async()=>{if(!await confirm('删除这项创作素材？已有作品中的副本会保留。'))return;await request('/api/library/content/'+active.id,{method:'DELETE'});active=null;draft=null;dirty=false;await refresh('素材已删除');renderForm();});
    const form=element(detail,'section','','sb-screen sb-content-form');
    adapter=Object.create(SandboxEditor.prototype);adapter.config=structuredClone(context);adapter.names=names;adapter.features=()=>adapter.config.features;
    const units=kind==='unit'?[draft]:records.filter(r=>r.kind==='unit').map(r=>structuredClone(r.definition));
    units.forEach((u,i)=>u.recruitCardId=2000+i);
    adapter.config.features={units,cards:kind==='card'?[draft]:[]};adapter.works=editor?.works||[];adapter.selected=null;
    adapter.changed=()=>{dirty=true;renderForm();};adapter.message=text=>status.textContent=text;
    adapter.field=(parent,title,value,change,type='text')=>{const label=element(parent,'label',title),input=element(label,type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value??'';input.oninput=()=>{try{change(type==='number'?Number(input.value):input.value);dirty=true;}catch(e){status.textContent=e.message;}};return input;};
    adapter.select=(parent,title,items,value,change)=>{if(title==='作用位置')items=items.filter(i=>i[0]==='target');const label=element(parent,'label',title),input=element(label,'select');for(const [id,text]of items){const opt=element(input,'option',text);opt.value=id;}input.value=value??'';input.onchange=()=>{try{change(input.value);dirty=true;renderForm();}catch(e){status.textContent=e.message;}};return input;};
    adapter.button=(parent,title,fn)=>{if(title.startsWith('新增')||title.startsWith('移除此兵种')||title.startsWith('移除此卡牌'))return document.createElement('button');return button(parent,title,fn);};
    adapter.areaPicker=(parent,title,obj)=>{element(parent,'p','库中卡牌推荐使用玩家点选的位置，指定地图区域请在对应作品的事件中配置。');button(parent,'改为玩家使用时点选',()=>{obj.area='target';delete obj.areas;adapter.changed();});};
    if(kind==='unit')adapter.renderCustomUnits(form);else adapter.renderCustomCards(form);
  }
  function addToWork(record){
    if(!editor)throw Error('请在战役编辑器打开素材库，选择要加入作品的内容');
    editor.recordUndo();const backup=structuredClone(editor.config);try{const f=editor.features();f.units||=[];f.cards||=[];
    function addUnit(def){const existing=f.units.find(u=>u.id===def.id);let id=existing?.recruitCardId||2000;while(!existing&&f.units.some(u=>u.recruitCardId===id))id++;const copy={...structuredClone(def),recruitCardId:id};if(existing)Object.assign(existing,copy);else{if(f.units.length>=64)throw Error('本作品已达到 64 个兵种上限');f.units.push(copy);}}
    if(record.kind==='unit')addUnit(record.definition);
    else{const dependencies=new Set();const walk=value=>{if(!value||typeof value!=='object')return;if(value.templateId)dependencies.add(value.templateId);for(const item of Object.values(value))if(item&&typeof item==='object')walk(item);};walk(record.definition);
      for(const id of dependencies){const unit=records.find(r=>r.kind==='unit'&&r.definition.id===id);if(unit)addUnit(unit.definition);else if(!f.units.some(u=>u.id===id))throw Error('此卡牌使用的兵种素材已删除，请先修正卡牌');}
      const existing=f.cards.find(c=>c.libraryId===record.id);let id=existing?.id||1000;while(!existing&&f.cards.some(c=>c.id===id))id++;const copy={...structuredClone(record.definition),id,libraryId:record.id};if(existing)Object.assign(existing,copy);else{if(f.cards.length>=64)throw Error('本作品已达到 64 张卡牌上限');f.cards.push(copy);}
    }
    editor.changed();status.textContent='已选入“'+editor.config.name+'”，本次作品保存独立副本。';}catch(e){editor.config=backup;throw e;}
  }
  try{await refresh('在库中创建内容，再选入沙盒作品。');renderForm();}catch(e){status.textContent=e.message;}
}
