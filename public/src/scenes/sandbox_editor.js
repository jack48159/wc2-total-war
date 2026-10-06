import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { World, MAP_W, MAP_H } from '../game/world.js';
import { Stage } from '../game/stage.js';
import { localRead, localWrite } from '../core/local_data.js';
import { SANDBOX_UNITS, validateSandbox } from '../game/sandbox_config.js';

const labels = {infantry:'步兵',panzer:'装甲步兵',tank:'坦克',heavytank:'重型坦克',artillery:'火炮',rocket:'火箭炮',destroyer:'驱逐舰',cruiser:'巡洋舰',battleship:'战列舰',aircraftcarrier:'航空母舰'};
const clone = value => structuredClone(value);
export async function sandboxLibrary() { return await localRead('sandbox-designs') || []; }

export class SandboxEditor extends Page {
  constructor(source, stage='sandbox_world', options={}, saved=null) {
    super(); this.source=source; this.stageName=stage; this.options=options; this.saved=saved; this.route='sandbox'; this.zoom=1; this.offset={x:0,y:0}; this.selected=null; this.writeQueue=Promise.resolve();
  }
  async init() {
    await World.load(); this.names=await E.json('data/countries.json');
    if (this.saved) this.config=clone(this.saved.config);
    else {
      const st=await Stage.load(this.stageName,null,this.options);
      this.config={version:1,name:'我的沙盒',stage:this.stageName,player:st.player,areas:clone(st.areas),countries:clone(st.data.countries),diplomacy:clone(st.data.diplomacy||{enabled:true,relations:{},pacts:{}}),scenarioEvents:{definitions:[]}};
    }
    this.id=this.saved?.id || crypto.randomUUID();
    this.eventDraft=clone(this.saved?.eventDraft || null);
    this.allCountries=clone((await E.json('data/stages/sandbox_world.json')).countries);
    this.root=document.createElement('div'); this.root.className='wc2-sandbox-editor';
    const style=document.createElement('style');style.textContent=`.wc2-sandbox-editor{position:fixed;inset:0;z-index:70;background:#332a20;color:#302317;font:16px 'Microsoft YaHei',sans-serif;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}.wc2-sandbox-editor header{display:flex;gap:8px;padding:8px;flex-wrap:wrap;background:#d8c59c}.wc2-sandbox-editor .workspace{display:flex;flex:1;min-height:0}.wc2-sandbox-editor canvas{width:100%;height:100%;touch-action:none}.wc2-sandbox-editor .map{flex:1;min-width:0;position:relative}.wc2-sandbox-editor aside{width:340px;max-width:46vw;overflow:auto;background:#dfd0ae;padding:12px}.wc2-sandbox-editor input,.wc2-sandbox-editor select,.wc2-sandbox-editor textarea,.wc2-sandbox-editor button{font:inherit;padding:7px;border:1px solid #96784e;border-radius:5px;max-width:100%;box-sizing:border-box}.wc2-sandbox-editor button{background:#efe0ba;cursor:pointer}.wc2-sandbox-editor label{display:block;margin:9px 0}.wc2-sandbox-editor input:not([type=checkbox]),.wc2-sandbox-editor select,.wc2-sandbox-editor textarea{width:100%}.wc2-sandbox-editor textarea{min-height:80px}.wc2-sandbox-editor .row{display:flex;gap:6px;margin:7px 0}.wc2-sandbox-editor .status{color:#563a21;flex:1}.wc2-sandbox-editor h3{margin:16px 0 8px}.wc2-sandbox-editor p{line-height:1.5}.wc2-sandbox-editor .unit{display:flex;gap:5px;align-items:center;margin:6px 0}.wc2-sandbox-editor .unit span{flex:1}@media(max-width:650px){.wc2-sandbox-editor aside{width:44vw;padding:7px;font-size:14px}.wc2-sandbox-editor header{font-size:14px}}`;
    this.root.append(style);this.header=document.createElement('header');this.root.append(this.header);
    this.button(this.header,'返回沙盒',()=>this.onBack());this.button(this.header,'保存作品',()=>this.save(true));this.button(this.header,'开始对局',()=>this.start());this.button(this.header,'导出',()=>this.export());
    this.button(this.header,'导入',()=>this.import());this.status=document.createElement('span');this.status.className='status';this.status.textContent='滚轮缩放 · 拖动地图 · 点击地块编辑';this.header.append(this.status);
    this.button(this.header,'＋',()=>this.zoomBy(1.4));this.button(this.header,'－',()=>this.zoomBy(1/1.4));this.button(this.header,'全图',()=>{this.zoom=1;this.offset={x:0,y:0};this.drawMap();});
    const work=document.createElement('div');work.className='workspace';this.root.append(work);
    const map=document.createElement('div');map.className='map';work.append(map);this.canvas=document.createElement('canvas');map.append(this.canvas);this.aside=document.createElement('aside');work.append(this.aside);
    document.body.append(this.root);this.ctx=this.canvas.getContext('2d');this.observer=new ResizeObserver(()=>this.drawMap());this.observer.observe(map);
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();const p=this.point(e),before=this.toWorld(p);this.zoom=Math.max(0.6,Math.min(24,this.zoom*(e.deltaY<0?1.2:1/1.2)));this.offset.x=p.x-before.x*this.scale();this.offset.y=p.y-before.y*this.scale();this.drawMap();},{passive:false});
    this.canvas.addEventListener('pointerdown',e=>{this.canvas.setPointerCapture(e.pointerId);this.drag={p:this.point(e),offset:{...this.offset},moved:false};});
    this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const p=this.point(e),dx=p.x-this.drag.p.x,dy=p.y-this.drag.p.y;if(Math.hypot(dx,dy)>5)this.drag.moved=true;if(this.drag.moved){this.offset={x:this.drag.offset.x+dx,y:this.drag.offset.y+dy};this.drawMap();}});
    this.canvas.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.moved){const p=this.toWorld(this.point(e)),id=World.areaAt(p.x,p.y);if(id>=0){this.selected=id;this.renderPanel();this.drawMap();}}this.drag=null;});
    this.canvas.addEventListener('pointercancel',()=>this.drag=null);
    E.image('assets/map/original-world-preview.webp').then(img=>{if(!this.root.isConnected)return;this.image=img;this.drawMap();}).catch(()=>{});
    this.renderPanel();this.drawMap();
  }
  button(parent,text,action){const b=document.createElement('button');b.textContent=text;b.onclick=()=>Promise.resolve().then(action).catch(e=>this.message(e.message));parent.append(b);return b;}
  text(parent,text,tag='p'){const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
  field(parent,title,value,change,type='text'){const l=document.createElement('label');l.append(document.createTextNode(title));const i=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value??'';i.oninput=()=>{try{change(type==='number'?Number(i.value):i.value);clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save().catch(e=>this.message('保存失败：'+e.message)),350);}catch(e){this.message(e.message);}};i.onchange=()=>{try{change(type==='number'?Number(i.value):i.value);this.changed();}catch(e){this.message(e.message);}};l.append(i);parent.append(l);return i;}
  select(parent,title,items,value,change){const l=document.createElement('label');l.append(document.createTextNode(title));const s=document.createElement('select');for(const [id,name] of items){const o=document.createElement('option');o.value=id;o.textContent=name;s.append(o);}s.value=value??'';s.onchange=()=>{change(s.value);this.changed();};l.append(s);parent.append(l);return s;}
  countryItems(neutral=false){return [...(neutral?[['','无主']]:[]),...this.config.countries.map(c=>[c.id,this.names[c.id]?.name||c.id])];}
  message(text){this.status.textContent=text;}
  changed(){this.renderPanel();this.drawMap();clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save().catch(e=>this.message('保存失败：'+e.message)),350);}
  save(explicit=false){clearTimeout(this.saveTimer);const record={id:this.id,name:this.config.name||'未命名沙盒',updatedAt:Date.now(),config:clone(this.config),eventDraft:clone(this.eventDraft || null)};this.writeQueue=this.writeQueue.catch(()=>{}).then(async()=>{const library=await sandboxLibrary(),index=library.findIndex(r=>r.id===record.id);if(index<0)library.unshift(record);else library[index]=record;await localWrite('sandbox-designs',library);this.message(explicit?'作品已保存':'修改已自动保存');});return this.writeQueue;}
  async onBack(){await this.save();E.go('sandbox');}
  onShow(){if(this.root && !this.root.isConnected){document.body.append(this.root);this.observer.observe(this.canvas.parentElement);this.drawMap();}}
  dispose(){clearTimeout(this.saveTimer);this.observer?.disconnect();this.root?.remove();}
  async start(){validateSandbox(this.config);await this.save();E.go('matchSetup',this,this.config.stage,{sandbox:true,sandboxCustom:true,sandboxConfig:clone(this.config),participatingCountries:this.config.countries.map(c=>c.id),player:this.config.player,freeDiplomacy:true,historicalDiplomacy:false},this.config.name);}
  export(){const blob=new Blob([JSON.stringify({format:'wc2-sandbox',version:1,config:this.config},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(this.config.name||'sandbox')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  import(){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text());if(data.format!=='wc2-sandbox'||data.version!==1)throw Error('不是支持的沙盒作品');validateSandbox(data.config);this.config=clone(data.config);this.id=crypto.randomUUID();this.selected=null;this.changed();}catch(e){this.message(e.message);}};input.click();}
  point(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  scale(){return Math.min(this.canvas.clientWidth/MAP_W,this.canvas.clientHeight/MAP_H)*this.zoom;}
  zoomBy(factor){const p={x:this.canvas.clientWidth/2,y:this.canvas.clientHeight/2},before=this.toWorld(p);this.zoom=Math.max(.6,Math.min(24,this.zoom*factor));this.offset={x:p.x-before.x*this.scale(),y:p.y-before.y*this.scale()};this.drawMap();}
  toWorld(p){const s=this.scale();return{x:(p.x-this.offset.x)/s,y:(p.y-this.offset.y)/s};}
  drawMap(){if(!this.canvas)return;const w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=devicePixelRatio||1;this.canvas.width=w*dpr;this.canvas.height=h*dpr;const c=this.ctx;c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#294353';c.fillRect(0,0,w,h);c.translate(this.offset.x,this.offset.y);const s=this.scale();c.scale(s,s);if(this.image)c.drawImage(this.image,0,0,MAP_W,MAP_H);const byArea=new Map(this.config.areas.map(a=>[a.id,a])),colors=new Map(this.config.countries.map(c=>[c.id,c.color||[110,140,90]]));for(const a of World.areas){if((a.x+a.w)*s+this.offset.x<0||a.x*s+this.offset.x>w||(a.y+a.h)*s+this.offset.y<0||a.y*s+this.offset.y>h)continue;const state=byArea.get(a.id),polygons=World.geo[a.id];if(!polygons)continue;c.beginPath();for(const p of polygons){for(let i=0;i<p.length;i+=2){const x=p[i],y=p[i+1];if(i===0)c.moveTo(x,y);else c.lineTo(x,y);}c.closePath();}const color=colors.get(state?.country);c.fillStyle=color?`rgba(${color.slice(0,3).join(',')},.42)`:'rgba(80,80,80,.12)';c.fill();c.strokeStyle=a.id===this.selected?'#ffed4d':'rgba(45,35,22,.35)';c.lineWidth=(a.id===this.selected?3:.5)/s;c.stroke();if(state?.armies?.length){const p=a.pts?.[0]||[a.x+a.w/2,a.y+a.h/2];c.fillStyle='#24160c';c.font=`${Math.max(12/s,18)}px sans-serif`;c.textAlign='center';c.fillText(String(state.armies.length),p[0],p[1]);}}}
  renderPanel(){const panel=this.aside,scroll=panel.scrollTop;panel.replaceChildren();this.field(panel,'作品名称',this.config.name,v=>this.config.name=v);this.select(panel,'玩家国家',this.countryItems(),this.config.player,v=>this.config.player=v);
    this.text(panel,'参战国与财政','h3');this.select(panel,'编辑国家',this.countryItems(),this.country||this.config.player,v=>this.country=v);const country=this.config.countries.find(c=>c.id===(this.country||this.config.player))||this.config.countries[0];this.field(panel,'初始金币',country.money,v=>country.money=Math.max(0,v),'number');this.field(panel,'初始工业',country.industry,v=>country.industry=Math.max(0,v),'number');
    this.button(panel,'移除此国（领土改为无主）',()=>{if(this.config.countries.length<=2)throw Error('至少保留两个参战国');this.config.countries=this.config.countries.filter(c=>c.id!==country.id);for(const a of this.config.areas)if(a.country===country.id){a.country=null;a.armies=[];}for(const key of Object.keys(this.config.diplomacy.relations||{}))if(key.split('_').includes(country.id))delete this.config.diplomacy.relations[key];if(this.config.player===country.id)this.config.player=this.config.countries[0].id;this.country=this.config.player;this.changed();});
    const extras=this.allCountries.filter(c=>!this.config.countries.some(x=>x.id===c.id));if(extras.length){this.select(panel,'可添加国家',extras.map(c=>[c.id,this.names[c.id]?.name||c.id]),this.addCountry||extras[0].id,v=>this.addCountry=v);this.button(panel,'添加参战国',()=>{const c=extras.find(c=>c.id===(this.addCountry||extras[0].id));this.config.countries.push(clone(c));this.country=c.id;this.changed();});}
    this.text(panel,'领土与兵力','h3');this.text(panel,'点击地图地块。可将战区外的原版地块加入战区，或转给任意参战国。');
    this.field(panel,'跳转地块编号',this.selected??'',v=>{if(!World.areas[v])throw Error('地块不存在');this.selected=v;const a=World.areas[v];this.zoom=Math.max(this.zoom,4);const s=this.scale();this.offset={x:this.canvas.clientWidth/2-(a.x+a.w/2)*s,y:this.canvas.clientHeight/2-(a.y+a.h/2)*s};},'number');
    if(this.selected!=null)this.renderArea(panel);
    this.text(panel,'外交关系','h3');this.select(panel,'国家一',this.countryItems(),this.first||this.config.player,v=>this.first=v);this.select(panel,'国家二',this.countryItems(),this.second||this.config.countries.find(c=>c.id!==this.config.player)?.id,v=>this.second=v);const first=this.first||this.config.player,second=this.second||this.config.countries.find(c=>c.id!==this.config.player)?.id,key=[first,second].sort().join('_');this.select(panel,'开局关系',[['peace','中立 / 和平'],['war','战争'],['alliance','同盟']],this.config.diplomacy.relations?.[key]||'peace',v=>{if(first===second){this.message('请选择两个不同国家');return;}this.config.diplomacy.relations||={};this.config.diplomacy.relations[key]=v;});
    for(const [pair,state]of Object.entries(this.config.diplomacy.relations||{}))this.text(panel,pair.split('_').map(id=>this.names[id]?.name||id).join(' ↔ ')+'：'+({war:'战争',peace:'和平',alliance:'同盟'}[state]));
    this.renderEvents(panel);panel.scrollTop=scroll;
  }
  renderArea(panel){let area=this.config.areas.find(a=>a.id===this.selected);this.text(panel,`地块 ${this.selected}${World.areas[this.selected].f===1?' · 海域':' · 陆地'}`,'h3');if(!area){this.button(panel,'加入战区',()=>{this.config.areas.push({id:this.selected,country:null,construction:'none',level:0,installation:'none',armies:[]});this.changed();});return;}
    this.select(panel,'所属国家',this.countryItems(true),area.country,v=>{area.country=v||null;if(!v)area.armies=[];});this.button(panel,'移出战区',()=>{this.config.areas=this.config.areas.filter(a=>a.id!==this.selected);this.changed();});
    for(const [i,a]of area.armies.entries()){const row=document.createElement('div');row.className='unit';panel.append(row);this.text(row,`${i+1}. ${labels[a.type]} · ${a.level}级`,'span');this.button(row,'移除',()=>{area.armies.splice(i,1);this.changed();});this.button(row,'移动',()=>{this.moving={area:area.id,index:i};this.message('点击目标地块，再按“移入此地块”');});}
    if(this.moving)this.button(panel,'将选中军队移入此地块',()=>{const from=this.config.areas.find(a=>a.id===this.moving.area),army=from?.armies[this.moving.index];if(!army)throw Error('待移动部队已不存在');if(from===area)throw Error('请选择另一个地块');if(area.country!==from.country)throw Error('部队只能摆放在本国地块');const next=clone(this.config),src=next.areas.find(a=>a.id===from.id),dst=next.areas.find(a=>a.id===area.id);dst.armies.push(src.armies.splice(this.moving.index,1)[0]);validateSandbox(next);this.config=next;this.moving=null;this.changed();});
    const sea=World.areas[area.id].f===1,types=SANDBOX_UNITS.filter(t=>['destroyer','cruiser','battleship','aircraftcarrier'].includes(t)===sea);this.select(panel,'添加兵种',types.map(t=>[t,labels[t]]),types.includes(this.unit)?this.unit:types[0],v=>this.unit=v);this.field(panel,'部队等级（1—5）',this.level||1,v=>this.level=Math.min(5,Math.max(1,Math.round(v))),'number');this.button(panel,'添加一支部队',()=>{if(!area.country)throw Error('请先设置地块所属国家');if(area.armies.length>=(World.areas[area.id].unitCapacity||4))throw Error('地块驻军已满');area.armies.push({type:types.includes(this.unit)?this.unit:types[0],level:this.level||1,cards:0});this.changed();});
  }
  renderEvents(panel){this.text(panel,'剧情与决策','h3');const defs=this.config.scenarioEvents.definitions;for(const e of defs){const row=document.createElement('div');row.className='row';panel.append(row);this.text(row,`${e.conditions[0].value}回合 · ${e.title}`,'span');this.button(row,'编辑',()=>{this.eventDraft=clone(e);this.changed();});this.button(row,'删除',()=>{defs.splice(defs.indexOf(e),1);this.changed();});}
    this.button(panel,'新增剧情 / 决策',()=>{this.eventDraft={id:crypto.randomUUID(),type:'notice',title:'新剧情',text:'',targetCountry:this.config.player,trigger:'roundBegin',conditions:[{type:'round',op:'gte',value:1}],actions:[],choices:[{id:'accept',text:'接受',actions:[]},{id:'reject',text:'拒绝',actions:[]}]};this.changed();});
    const e=this.eventDraft;if(!e)return;this.field(panel,'剧情标题',e.title,v=>e.title=v);this.field(panel,'剧情内容',e.text,v=>e.text=v,'textarea');this.field(panel,'触发回合',e.conditions[0].value,v=>e.conditions[0].value=Math.max(1,Math.round(v)),'number');this.select(panel,'接收国家',this.countryItems(),e.targetCountry,v=>e.targetCountry=v);this.select(panel,'类型',[['notice','剧情通知'],['decision','分支决策']],e.type,v=>e.type=v);
    this.text(panel,'效果可使用金币、工业、稳定度、外交、增援和领土转移。');const actions=(parent,title,array,set)=>{
      this.text(parent,title,'h4');
      const effects=[['changeMoney','金币'],['changeIndustry','工业'],['changeStability','稳定度'],['setDiplomacy','外交关系'],['spawnArmy','增援部队'],['captureArea','领土转移']];
      for(const [index,action] of array.entries()){
        this.select(parent,'效果类型',effects,action.type,v=>{Object.keys(action).forEach(k=>delete action[k]);Object.assign(action,{type:v,country:e.targetCountry,amount:100,area:this.selected??this.config.areas[0].id,armyType:'infantry',first:e.targetCountry,second:this.config.countries.find(c=>c.id!==e.targetCountry)?.id,state:'peace'});});
        if(action.type==='setDiplomacy'){
          this.select(parent,'国家一',this.countryItems(),action.first,v=>action.first=v);
          this.select(parent,'国家二',this.countryItems(),action.second,v=>action.second=v);
          this.select(parent,'新关系',[['war','战争'],['peace','和平'],['alliance','同盟']],action.state,v=>action.state=v);
        }else{
          this.select(parent,'目标国家',this.countryItems(),action.country||e.targetCountry,v=>action.country=v);
          if(['spawnArmy','captureArea'].includes(action.type))this.field(parent,'目标地块编号',action.area,v=>action.area=Math.round(v),'number');
          else this.field(parent,'变化数值',action.amount,v=>action.amount=v,'number');
          if(action.type==='spawnArmy'){
            this.select(parent,'增援兵种',SANDBOX_UNITS.map(t=>[t,labels[t]]),action.armyType,v=>action.armyType=v);
            this.field(parent,'增援等级',action.level||1,v=>action.level=Math.min(5,Math.max(1,Math.round(v))),'number');
          }
        }
        this.button(parent,'移除此效果',()=>{array.splice(index,1);this.changed();});
      }
      this.button(parent,'添加效果',()=>{array.push({type:'changeMoney',country:e.targetCountry,amount:100});this.changed();});
    };
    if(e.type==='notice')actions(panel,'通知效果',e.actions,a=>e.actions=a);
    else {for(const choice of e.choices){this.field(panel,'选项文字',choice.text,v=>choice.text=v);actions(panel,'选项效果',choice.actions,a=>choice.actions=a);}this.button(panel,'添加决策选项',()=>{e.choices.push({id:crypto.randomUUID(),text:'新选项',actions:[]});this.changed();});}
    this.select(panel,'快捷效果',[['changeMoney','金币'],['changeIndustry','工业'],['changeStability','稳定度']],this.effectType||'changeMoney',v=>this.effectType=v);this.field(panel,'效果数值（可为负数）',this.effectAmount??100,v=>this.effectAmount=v,'number');this.button(panel,e.type==='notice'?'加入通知效果':'加入第一个选项效果',()=>{const target=e.type==='notice'?e.actions:e.choices[0].actions;target.push({type:this.effectType||'changeMoney',country:e.targetCountry,amount:this.effectAmount??100});this.changed();});
    this.button(panel,'保存这条剧情',()=>{const next=clone(this.config),index=next.scenarioEvents.definitions.findIndex(x=>x.id===e.id);if(index<0)next.scenarioEvents.definitions.push(clone(e));else next.scenarioEvents.definitions[index]=clone(e);validateSandbox(next);this.config=next;this.eventDraft=null;this.changed();});
  }
}
