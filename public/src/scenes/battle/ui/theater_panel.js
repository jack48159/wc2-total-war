import { E } from '../../../core/index.js';
import { drawCommanderPortrait } from '../../commander.js';
import { armyRows, commanderById, countryCommanders, commanderYearAvailable, ownsCommander, liveGroupUnits, COMMANDER_ATLAS } from '../../../game/army_groups.js';
import { orderMenuItems, ORDER_VERBS, orderSummary, ORDER_STATUS } from './order_menu.js';

const label = {
  title: '\u6218 \u533a \u6307 \u6325', create: '+ \u65b0\u5efa\u6218\u533a',
  unassigned: '\u603b\u53c2\u76f4\u5c5e', marshal: '\u672a\u4efb\u547d\u5143\u5e05',
  appoint: '\u4efb\u547d\u5143\u5e05', add: '+ \u7f16\u5165\u96c6\u56e2\u519b',
  remove: '\u79fb\u51fa', edit: '\u7f16\u5236', rename: '\u6539\u540d',
  dissolve: '\u89e3\u6563', order: '\u4e0b\u4ee4', now: '\u7acb\u5373\u6267\u884c',
  auto: '\u56de\u5408\u7ed3\u675f\u81ea\u52a8\u6267\u884c', report: '\u67e5\u770b\u62a5\u544a',
  cancel: '\u53d6\u6d88\u5f53\u524d\u547d\u4ee4', ai: '\u6258\u7ba1',
  select: '\u8bf7\u9009\u62e9', back: '\u8fd4\u56de'
};
const hit = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export class TheaterPanel {
  constructor(dialog) { this.dialog = dialog; this.game = dialog.game; this.battle = dialog.battle; this.country = this.game.player; this.hits = []; this.collapsed = new Set(); this.hover = null; this.selected = null; this.menu = null; this.picker = null; this.pickPage = 0; this.message = ''; this.scroll=0; this.viewport=null; this.reportEntry=null; E.image(COMMANDER_ATLAS).then(img=>this.portraits=img).catch(()=>{}); }
  command(type, extra = {}) {
    const r = this.game.apply({ type, country: this.country, ...extra });
    this.message = r.ok ? '' : r.reason;
    return r.ok;
  }
  add(text, x, y, w, h, action, opt = {}) {
    this.hits.push({ x, y, w, h, action, right: opt.right, disabled: opt.disabled });
    E.layout.button({x,y,w,h,label:text,layoutInput:true}, 'battle/theater/action/'+this.hits.length);
    E.text(text, x + 3, y + h / 2, { size: Math.max(16, Math.min(20, h * .52)), color: opt.disabled ? '#998b77' : opt.color || '#49321d', font: 'SimSun,serif', base: 'middle' });
    if (!opt.disabled) { const c = E.ctx; c.save(); c.strokeStyle = '#957454'; c.beginPath(); c.moveTo(x + 2, y + h - 2); c.lineTo(x + w - 2, y + h - 2); c.stroke(); c.restore(); }
  }
  orderFor(level, id) { return this.game.orders.findLast(o => o.level === level && o.targetId === id && !['cancelled','failed','achieved'].includes(o.status)); }
  issue(level, id, verb) {
    this.menu = null;
    if(verb==='support'){this.picker={kind:'support',level,targetId:id};this.pickPage=0;return;}
    this.dialog.close();
    this.battle.startOrderDrawing({ level, id, verb });
  }
  draw(c, g, x, y, w, h) {
    this.hits = []; this.viewport={x,y,w,h};
    const s = g.scale, row = Math.max(70 * s, 58), groupRow = Math.max(47 * s, 38), active = this.game.activeCountry === this.country && this.game.phase === 'playing';
    E.text(label.title, x + 8*s, y + 18*s, { size: Math.max(22, 24*s), color: '#35221a', bold: true });
    this.add(label.create, x + w - 145*s, y, 140*s, Math.max(32, 30*s), () => this.command('createTheater'), { disabled: !active });
    let yy = y + Math.max(40*s, 36) - this.scroll;
    const theatres = this.game.theatres.filter(t => t.country === this.country);
    for (const t of theatres) {
      if (yy > y + h - 55*s) break;
      const marshal = commanderById(t.country, t.marshalId), groups = t.armyIds.map(id => this.game.armyGroups.find(a => a.id === id)).filter(Boolean);
      const units = groups.flatMap(group => liveGroupUnits(this.game, group));
      const strength = units.length ? units.reduce((n, r) => n + r.army.hp / (r.army.maxHp || 1), 0) / units.length : 0;
      const fill = strength >= .7 ? '#5c9b54' : strength >= .4 ? '#bd9842' : '#a4473e';
      E.panel(x+4*s, yy, w-8*s, row-4*s, { fill: this.selected?.id === t.id ? '#66543e' : '#443b32', stroke: '#b59a6e', r: 7*s });
      const px = x + 28*s, py = yy + 5*s;
      this.add('\u2699',x+4*s,yy+8*s,19*s,30*s,()=>this.openMenu('theater',t.id,x+25*s,yy+12*s),{color:'#f1dcae'});
      E.panel(px, py, 38*s, 38*s, { fill: '#806c4d', stroke: '#c3ad7c', r: 3*s });
      if(marshal)drawCommanderPortrait(this.portraits,marshal,px,py,38*s,38*s);
      else {E.text('\u65d7',px+19*s,py+16*s,{size:14*s,align:'center',base:'middle',color:'#f4dfac'});E.text('\u265f',px+19*s,py+28*s,{size:12*s,align:'center',base:'middle',color:'#d9c18c'});}
      this.hits.push({x:px,y:py,w:38*s,h:38*s,right:()=>this.openMenu('theater',t.id,px+40*s,py),action:()=>this.select('theater',t.id)});
      E.text(t.name, x+74*s, yy+15*s, { size:Math.max(17,19*s), color:'#f1dbad', bold:true });
      E.text(marshal?.name || label.marshal, x+74*s, yy+34*s, { size:Math.max(14,14*s), color:'#d2c2a6' });
      const entry = this.orderFor('theater',t.id);
      E.text(entry ? orderSummary(entry.order)+' '+(ORDER_STATUS[entry.status]||entry.status) : '\u65e0\u547d\u4ee4', x+w-275*s, yy+17*s, {size:Math.max(14,14*s),color:'#ead8aa'});
      this.add('\u279c',x+w-158*s,yy+3*s,Math.max(32,22*s),Math.max(32,30*s),()=>this.issue('theater',t.id,'attack'),{disabled:!active,color:'#e9d6ae'});
      this.add('\u22a3',x+w-131*s,yy+3*s,Math.max(32,22*s),Math.max(32,30*s),()=>this.issue('theater',t.id,'defend'),{disabled:!active,color:'#e9d6ae'});
      this.add(label.order, x+w-105*s, yy+4*s, 45*s, 23*s, ()=>this.openMenu('theater',t.id,x+w-160*s,yy+24*s), {color:'#e9d6ae'});
      this.add(t.ai ? label.ai+' \u2713' : label.ai, x+w-58*s, yy+4*s, 52*s, 23*s, ()=>this.command('setTheaterAI',{theaterId:t.id,on:!t.ai}), {disabled:!active,color:'#e9d6ae'});
      if(entry) E.panel(x+74*s,yy+row-17*s,(w-155*s)*(entry.progress||0),3*s,{fill:'#8ebd70'});
      E.panel(x+74*s,yy+row-11*s,(w-155*s)*strength,4*s,{fill});
      E.text(String(units.length), x+9*s,yy+row-8*s,{size:Math.max(14,12*s),color:'#f6dfb4'});
      E.text(String(groups.length),x+w-80*s,yy+row-8*s,{size:Math.max(14,12*s),color:'#f6dfb4'});
      this.hits.push({x:x+56*s,y:yy,w:w-165*s,h:row-4*s,action:()=>{if(this.collapsed.has(t.id))this.collapsed.delete(t.id);else this.collapsed.add(t.id);this.select('theater',t.id);}});
      yy += row;
      if (!this.collapsed.has(t.id)) {
        for (const group of groups) {
          if (yy > y+h-70*s) break;
          const spec=commanderById(group.country,group.commanderId), order=this.orderFor('army',group.id);
          if(spec)drawCommanderPortrait(this.portraits,spec,x+30*s,yy+3*s,32*s,32*s);
          this.add((spec?.name||'\u6307\u6325\u5b98')+'  '+group.name+'  '+liveGroupUnits(this.game,group).length+'/16  '+(order?'\u603b\u53c2\u76f4\u63a5\u6307\u6325 '+orderSummary(order.order)+' '+(ORDER_STATUS[order.status]||order.status):'\u65e0\u547d\u4ee4'), x+67*s,yy,w-255*s,Math.max(34,34*s),()=>this.select('army',group.id),{right:()=>this.openMenu('army',group.id,x+95*s,yy)});
          const members=liveGroupUnits(this.game,group);const health=members.length?members.reduce((n,r)=>n+r.army.hp/(r.army.maxHp||1),0)/members.length:0;E.panel(x+67*s,yy+groupRow-7*s,(w-260*s)*health,4*s,{fill:health>=.7?'#5c9b54':health>=.4?'#bd9842':'#a4473e'});
          this.hits.push({x:x+30*s,y:yy,w:32*s,h:32*s,right:()=>this.openMenu('army',group.id,x+58*s,yy),action:()=>this.select('army',group.id)});
          this.add(label.order,x+w-150*s,yy,45*s,Math.max(34,34*s),()=>this.openMenu('army',group.id,x+w-150*s,yy));
          this.add(label.remove,x+w-100*s,yy,48*s,Math.max(34,34*s),()=>this.command('assignArmyToTheater',{groupId:group.id,theaterId:null}),{disabled:!active});
          this.add(label.edit,x+w-48*s,yy,45*s,Math.max(34,34*s),()=>this.battle.openArmyGroups());
          yy += groupRow;
        }
        this.add(label.add,x+30*s,yy,w-40*s,Math.max(34,34*s),()=>{this.picker={kind:'group',theaterId:t.id};this.pickPage=0;},{disabled:!active});
        yy += groupRow;
      }
    }
    const grouped = new Set(theatres.flatMap(t=>t.armyIds)), direct = this.game.armyGroups.filter(a=>a.country===this.country&&!grouped.has(a.id));
    E.text(label.unassigned+'  '+direct.map(a=>a.name).join(' / ')+'  '+armyRows(this.game,this.country).filter(r=>!this.game.armyGroups.some(a=>a.unitIds.includes(r.army.id))).length, x+8*s,y+h-36*s,{size:Math.max(16,14*s),color:'#5a3b26'});
    if (this.message) E.text(this.message,x+8*s,y+h-16*s,{size:Math.max(16,14*s),color:'#a13c2e'});
    if (this.menu) this.drawMenu(this.menu,g);
    if (this.picker) this.drawPicker(g);
    if (this.reportEntry) this.drawReport(g);
  }
  select(level,id) { this.selected = this.selected?.level===level&&this.selected.id===id?null:{level,id}; this.battle.selectedOrderTarget=this.selected; }
  openMenu(level,id,x,y) { this.menu={level,id,x,y,sub:false}; }
  menuChoices() {
    const m=this.menu;
    if(!m) return [];
    return m.sub
      ? Object.entries(ORDER_VERBS).map(([verb,text])=>({label:text,enabled:true,action:()=>this.issue(m.level,m.id,verb)}))
      : orderMenuItems(this.game,m.level,m.id).map(item=>({...item,action:()=>this.menuAction(m,item)}));
  }
  drawMenu(m,g) {
    const choices=this.menuChoices();
    const s=g.scale, row=Math.max(34,34*s), width=Math.max(260,250*s), height=choices.length*row;
    const x=Math.max(8,Math.min(m.x+35,E.W-width-8));
    const below=m.y+48, y=below+height<E.H-8?below:Math.max(8,m.y-height-8);
    E.drawParchment(x-5,y-5,width+10,height+10,{fill:'#e7d4aa'});
    choices.forEach((item,i)=>{const hovered=this.hover===i;this.add(item.label+(item.enabled?'':('  ['+item.reason+']')),x,y+i*row,width,row,item.action,{disabled:!item.enabled,color:item.enabled?(hovered?'#8e4a1f':'#3c2b1c'):'#9b8a76'});if(hovered&&item.enabled)E.panel(x,y+i*row,width,row,{fill:'rgba(194,155,87,.16)'});});
    this.menuRect={x,y,w:width,h:height,row};
  }
  menuAction(m,item) {
    this.menu=null; const level=m.level,id=m.id;
    if(item.id==='order'){this.menu={...m,sub:true};return;}
    if(item.id==='now'){this.command('executeOrder',{level,targetId:id});return;}
    if(item.id==='cancel'){this.command(level==='army'?'setArmyOrder':'setTheaterOrder',{groupId:id,theaterId:id,order:null});return;}
    if(item.id==='report'){this.reportEntry=this.orderFor(level,id);return;}
    if(item.id==='auto'){const o=this.orderFor(level,id);if(o)this.command('setOrderAuto',{level,targetId:id,on:!o.auto});return;}
    if(item.id==='ai'){const t=this.game.theatres.find(t=>t.id===id);if(t)this.command('setTheaterAI',{theaterId:id,on:!t.ai});return;}
    if(item.id==='appoint'){this.picker={kind:'marshal',theaterId:id};this.pickPage=0;return;}
    if(item.id==='commander'){this.battle.openArmyGroups(id);return;}
    if(item.id==='rename'){const name=prompt('\u6218\u533a\u540d\u79f0');if(name)this.command(level==='army'?'renameArmyGroup':'renameTheater',{groupId:id,theaterId:id,name});return;}
    if(item.id==='dissolve')this.command(level==='army'?'dissolveArmyGroup':'dissolveTheater',level==='army'?{groupId:id}:{theaterId:id});
  }
  drawReport(g) {
    const s=g.scale,x=g.px+g.sw+30*s,y=g.py+95*s,w=g.pw-g.sw-60*s,h=g.ph-175*s;
    E.panel(x,y,w,h,{fill:'#e8d7b4',stroke:'#6d4d2e',r:3*s});
    const entry=this.reportEntry,report=entry?.report||{};
    E.text(label.report,x+12*s,y+23*s,{size:Math.max(22,23*s),color:'#392519',bold:true});
    const rows=[
      '\u5175\u529b: '+(report.manpower??'--'),
      '\u7d2f\u8ba1\u635f\u5931: '+(report.losses??'--'),
      '\u5a01\u80c1: '+(report.threat??'--'),
      '\u8bf7\u6c42: '+(Array.isArray(report.requests)?report.requests.join(', '):report.requests||'--'),
      ...(report.warnings||[]).map(w=>'\u8b66\u544a: '+w),
      ...(report.rejected||[]).map(r=>'\u9a73\u56de: '+r.reason)
    ];
    rows.slice(0,10).forEach((text,i)=>E.text(text,x+12*s,y+(58+i*26)*s,{size:Math.max(16,14*s),color:i>=4?'#a37a25':'#473221'}));
    this.add(label.back,x+w-82*s,y+5*s,75*s,26*s,()=>this.reportEntry=null);
    const request=report.requests;
    if(request&&entry){
      this.add('\u6279\u51c6',x+20*s,y+h-34*s,65*s,27*s,()=>{
        const level=entry.level,id=entry.targetId;this.command(level==='army'?'setArmyOrder':'setTheaterOrder',{groupId:id,theaterId:id,order:null});this.reportEntry=null;
      });
      this.add('\u9a73\u56de',x+100*s,y+h-34*s,65*s,27*s,()=>this.reportEntry=null);
    }
  }
  drawPicker(g) {
    const s=g.scale, x=g.px+g.sw+25*s, y=g.py+90*s, w=g.pw-g.sw-55*s, h=g.ph-150*s;
    E.panel(x,y,w,h,{fill:'#e7d5ad',stroke:'#6b4c2d',r:3*s});
    const p=this.picker;
    this.add(label.back,x+8*s,y+5*s,80*s,26*s,()=>this.picker=null);
    const list=p.kind==='support'?this.game.orders.filter(o=>o.order&&['pending','progressing','stalled'].includes(o.status)&&!(o.level===p.level&&o.targetId===p.targetId))
      :p.kind==='marshal'?countryCommanders(this.country).filter(c=>c.marshal):this.game.armyGroups.filter(a=>a.country===this.country&&!this.game.theatres.some(t=>t.armyIds.includes(a.id)));
    list.slice(this.pickPage*9,this.pickPage*9+9).forEach((entry,i)=>{
      const owned=ownsCommander(this.game,entry),year=commanderYearAvailable(this.game,entry);
      const used=this.game.armyGroups.some(a=>a.commanderId===entry.id)||this.game.theatres.some(t=>t.id!==p.theaterId&&t.marshalId===entry.id);
      const allowed=p.kind==='support'||p.kind==='group'||(year&&owned&&!used);
      const status=!year?' [\u5e74\u4ee3\u4e0d\u7b26]':!owned?' [\u672a\u8d2d\u4e70]':used?' [\u5df2\u4efb\u804c]':' [\u53ef\u4efb\u547d]';
      const text=p.kind==='support'?orderSummary(entry.order):p.kind==='group'?entry.name:entry.name+'  +'+Math.round((entry.coordination?.attack||0)*100)+'% / +'+Math.round((entry.coordination?.defence||0)*100)+'% '+(entry.years?entry.years.join('-'):'')+status;
      if(p.kind==='marshal')drawCommanderPortrait(this.portraits,entry,x+12*s,y+42*s+i*31*s,22*s,25*s);
      this.add(text,x+(p.kind==='marshal'?39:10)*s,y+40*s+i*31*s,w-(p.kind==='marshal'?49:20)*s,29*s,()=>{
        if(p.kind==='support'){
          const target=entry.order,order={verb:'support',from:target.from,to:target.to,risk:.5,priority:5,supportOrderId:entry.id,path:target.path||undefined,draw:target.draw||undefined};
          if(this.command(p.level==='army'?'setArmyOrder':'setTheaterOrder',{groupId:p.targetId,theaterId:p.targetId,order}))this.picker=null;
        }else if(this.command(p.kind==='group'?'assignArmyToTheater':'appointMarshal',{groupId:entry.id,theaterId:p.theaterId,marshalId:entry.id}))this.picker=null;
      },{disabled:!allowed});
    });
    this.add('<',x+w-90*s,y+4*s,30*s,26*s,()=>this.pickPage=Math.max(0,this.pickPage-1),{disabled:this.pickPage===0});
    this.add('>',x+w-47*s,y+4*s,30*s,26*s,()=>this.pickPage=Math.min(Math.max(0,Math.ceil(list.length/9)-1),this.pickPage+1),{disabled:this.pickPage>=Math.ceil(list.length/9)-1});
  }
  wheel(delta) {
    const count=this.game.theatres.filter(t=>t.country===this.country).length;
    const scale=this.dialog.geom().scale, groupRow=Math.max(47*scale,38), row=Math.max(70*scale,58);
    const groups=this.game.theatres.filter(t=>t.country===this.country&&!this.collapsed.has(t.id)).reduce((n,t)=>n+t.armyIds.length+1,0);
    const max=Math.max(0,count*row+groups*groupRow+75-(this.viewport?.h||400));
    this.scroll=Math.max(0,Math.min(max,this.scroll+delta));
  }
  down(p) {
    if(this.touchHold){clearTimeout(this.touchHold.timer);this.touchHold=null;}
    if(this.viewport&&!hit(p,this.viewport)&&!(this.menuRect&&hit(p,this.menuRect)))return false;
    const target=[...this.hits].reverse().find(r=>hit(p,r));
    if(p.button===2){if(target?.right)target.right();else this.menu=null;return true;}
    if(p.pointerType==='touch'&&target?.right){
      const hold={x:p.x,y:p.y,target,long:false};
      hold.timer=setTimeout(()=>{hold.long=true;target.right();},520);
      this.touchHold=hold;return true;
    }
    if(target&&!target.disabled){target.action?.();return true;}
    if(this.menu||this.picker){this.menu=null;this.picker=null;return true;}
    return false;
  }
  move(p) {
    this.hover=this.menuRect&&hit(p,this.menuRect)?Math.floor((p.y-this.menuRect.y)/this.menuRect.row):null;
    const hold=this.touchHold;
    if(hold&&Math.hypot(p.x-hold.x,p.y-hold.y)>12){clearTimeout(hold.timer);this.touchHold=null;}
  }
  up(p) {
    const hold=this.touchHold;if(!hold)return;
    clearTimeout(hold.timer);this.touchHold=null;
    if(!hold.long&&hit(p,hold.target)&&!hold.target.disabled)hold.target.action?.();
  }
}
