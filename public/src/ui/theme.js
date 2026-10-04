// Modern military menu system. All geometry uses the 1600 × 900 design canvas.
import { E } from '../core/index.js';
import { Page } from './ui.js';

export const theme = Object.freeze({
  color: Object.freeze({ bg:'#0b0d0f', panel:'rgba(10,12,14,0.78)', border:'rgba(236,226,204,0.16)', text:'#ece2cc', muted:'#a7abae', weak:'#74736e', accent:'#c97836', danger:'#d8433a', line:'rgba(236,226,204,0.14)', brass:'#c9a15a', sepia:'#8c714e' }),
  font: Object.freeze({ body:'"Menu Noto", "Microsoft YaHei", sans-serif', display:'"Menu Serif", "Noto Serif SC", "SimSun", serif', label:'"Menu Noto", monospace' }),
  size: Object.freeze({ hero:72, title:44, heading:28, body:20, caption:15 }),
  space:Object.freeze({ xs:8, sm:16, md:24, lg:32, xl:48, xxl:64 }),
  grid:Object.freeze({ width:1600, height:900, margin:80, columns:12, gutter:24, column:98 }),
  motion:Object.freeze({ enter:250, stagger:40, hover:150 }),
  image:Object.freeze({ filter:'sepia(.34) saturate(.67) contrast(1.08) brightness(.88)', grain:.055, vignette:.12 }),
});
export const C=theme.color;
const colors={text:C.text,muted:C.muted,weak:C.weak,accent:C.accent,brass:C.brass,danger:C.danger};
// Single replacement point for the forthcoming artwork and per-stage thumbnails.
export const menuAssets={ keyArt:'assets/mainbg@2x.webp', portrait:'assets/commander@2x.png', thumbnails:{} };
let fonts;
async function loadFonts(){
  if(!fonts) fonts=Promise.all([
    new FontFace('Menu Noto','url(ui_assets/fonts/NotoSansSC.ttf)',{weight:'100 900'}).load(),
  ]).then(f=>f.forEach(x=>document.fonts.add(x)));
  await fonts;
}
export function text(value,x,y,size='body',o={}){
  const c=E.ctx,px=theme.size[size];
  if(!px) throw new Error('Unknown menu type token: '+size);
  const display=o.display===true||o.display!==false&&['hero','title','heading'].includes(size);
  c.save();c.font=`${o.weight||(size==='hero'||size==='title'||size==='heading'?900:500)} ${px}px ${display?theme.font.display:theme.font.body}`;
  c.textAlign=o.align||'left';c.textBaseline='middle';c.fillStyle=colors[o.color]||o.color||C.text;
  if('letterSpacing' in c)c.letterSpacing=(o.tracking||0)+'px';
  c.translate(x,y);if(o.display===true)c.scale(.82,1);E.layout.canvas(c, 'ui/theme.js:32').fillText(String(value).replace(/[a-z]+/g,s=>s.toUpperCase()),0,0);c.restore();
}
export function wrap(value,width,size='body'){
  const c=E.ctx;c.save();c.font=`500 ${theme.size[size]}px ${theme.font.body}`;
  const lines=[];for(const para of String(value).split('\n')){let line='';for(const ch of para){if(line&&c.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}lines.push(line);}c.restore();return lines;
}
export function paragraph(value,x,y,width,o={}){const lines=wrap(value,width,o.size||'body');lines.forEach((ln,i)=>text(ln,x,y+i*32,o.size||'body',o));return lines.length*32;}
export function rule(x,y,w,color=C.line){const c=E.ctx;c.save();c.fillStyle=color===true?C.accent:color;E.layout.canvas(c, 'ui/theme.js:39').fillRect(x,y,w,1);c.restore();}
function layoutDraw_panel(x,y,w,h){const c=E.ctx;c.save();c.fillStyle=C.panel;E.layout.canvas(c, 'ui/theme.js:40').fillRect(x,y,w,h);c.strokeStyle=C.border;c.lineWidth=1;E.layout.canvas(c, 'ui/theme.js:40').strokeRect(x+.5,y+.5,w-1,h-1);c.restore();}
function hover(b){const now=performance.now(),dt=Math.min(50,now-(b._themeTime||now));b._themeTime=now;const target=b.hover||b.focused?1:0;b._themeHover=E.clamp((b._themeHover||0)+(target?1:-1)*dt/theme.motion.hover,0,1);return b._themeHover;}
export function focus(b,{label=b.label,size=20,weight=900,font=theme.font.body,x=b.x+b.w/2,y=b.y+b.h/2}={}){
  if(!(b.hover||b.focused))return;
  const c=E.ctx;c.save();c.font=`${weight} ${size}px ${font}`;const w=c.measureText(String(label)).width;
  c.fillStyle=C.text;E.layout.canvas(c, 'ui/theme.js:45').fillRect(x-w/2,y+size*.62,w,1);c.restore();
}
function layoutDraw_action(b,o={}){
  const c=E.ctx,t=hover(b);if(!b.visible)return;c.save();c.globalAlpha*=b.enabled?1:.45;
  c.fillStyle=o.primary?C.accent:`rgba(255,255,255,${t*.10})`;E.layout.canvas(c, 'ui/theme.js:49').fillRect(b.x,b.y,b.w,b.h);c.strokeStyle=o.primary?C.accent:t?C.text:C.border;c.lineWidth=1;E.layout.canvas(c, 'ui/theme.js:49').strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);
  if(t&&!o.primary){c.fillStyle=C.accent;E.layout.canvas(c, 'ui/theme.js:50').fillRect(b.x,b.y+b.h-3,32*t,3);}if(b.pressed){c.fillStyle=C.border;E.layout.canvas(c, 'ui/theme.js:50').fillRect(b.x,b.y,b.w,b.h);}
  text(o.label||b.label,b.x+b.w/2,b.y+b.h/2,'body',{align:'center',weight:900,color:t?C.text:o.primary?C.bg:C.text});c.restore();focus(b,{label:o.label||b.label});
}
export const button=action;
function layoutDraw_listItem(b,{selected=false,title=b.label,subtitle='',number='',size='heading'}={}){
  const c=E.ctx,t=hover(b);c.save();if(selected||t){c.fillStyle=selected?C.text:`rgba(255,255,255,${t*.10})`;E.layout.canvas(c, 'ui/theme.js:55').fillRect(b.x,b.y,b.w,b.h);}const color=selected?C.bg:C.text;
  const tx=b.x+(number?64:24);if(number)text(number,b.x+24,b.y+b.h/2,'body',{display:true,color:selected?C.bg:C.muted});
  text(title,tx,b.y+(subtitle?b.h/2-12:b.h/2),size,{color,weight:900});
  if(subtitle)text(subtitle,tx,b.y+b.h/2+20,'caption',{color:selected?C.weak:C.muted,tracking:1});c.restore();focus(b);
}
function layoutDraw_tab(b,selected){const t=hover(b);text(b.label,b.x+b.w/2,b.y+b.h/2,'body',{weight:900,align:'center',color:selected||t?C.text:C.muted});if(selected){E.ctx.fillStyle=C.accent;E.layout.canvas(E.ctx, 'ui/theme.js:60').fillRect(b.x,b.y+b.h-3,b.w,3);}focus(b);}
export function cover(img,r,zoom=1){if(!img)return;const c=E.ctx,s=Math.max(r.w/img.width,r.h/img.height)*zoom;c.save();c.filter=theme.image.filter;E.layout.canvas(c, 'ui/theme.js:61').drawImage(img,r.x+(r.w-img.width*s)/2,r.y+(r.h-img.height*s)/2,img.width*s,img.height*s);c.restore();}
export async function thumbnail(key,frame){const url=menuAssets.thumbnails[key];if(url)return E.image(url);if(!frame)return null;const cv=document.createElement('canvas');cv.width=frame.w;cv.height=frame.h;cv.getContext('2d').drawImage(frame.img,frame.x,frame.y,frame.w,frame.h,0,0,frame.w,frame.h);return cv;}
function layoutDraw_card(b,{image,title='',subtitle='',selected=false}={}){
  const c=E.ctx,t=hover(b);c.save();E.layout.canvas(c, 'ui/theme.js:64').beginPath();E.layout.canvas(c, 'ui/theme.js:64').rect(b.x,b.y,b.w,b.h);E.layout.canvas(c, 'ui/theme.js/clip').clip();c.fillStyle=C.bg;E.layout.canvas(c, 'ui/theme.js:64').fillRect(b.x,b.y,b.w,b.h);cover(image,b,1+.03*(selected?1:t));
  const g=c.createLinearGradient(0,b.y+b.h*.6,0,b.y+b.h);g.addColorStop(0,'transparent');g.addColorStop(1,C.bg);c.fillStyle=g;E.layout.canvas(c, 'ui/theme.js:65').fillRect(b.x,b.y,b.w,b.h);
  if(subtitle)text(subtitle,b.x+24,b.y+b.h-80,'caption',{tracking:1});if(title)text(title,b.x+24,b.y+b.h-40,'heading');c.restore();c.save();c.strokeStyle=selected||t?C.accent:C.border;c.lineWidth=1;E.layout.canvas(c, 'ui/theme.js:66').strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);c.restore();focus(b);
}
let grainTile;
function grainPattern(){
  if(grainTile)return grainTile;
  const cv=document.createElement('canvas');cv.width=128;cv.height=128;const x=cv.getContext('2d'),im=x.createImageData(128,128);
  let seed=193905;for(let i=0;i<im.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=seed>>>24;im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=255;}x.putImageData(im,0,0);grainTile=cv;return cv;
}
export function filmTexture(x=0,y=0,w=E.W,h=E.H){
  const c=E.ctx;c.save();c.globalAlpha=theme.image.grain;c.globalCompositeOperation='soft-light';c.fillStyle=c.createPattern(grainPattern(),'repeat');E.layout.canvas(c, 'ui/theme.js:75').fillRect(x,y,w,h);c.globalCompositeOperation='source-over';
  const g=c.createRadialGradient(E.W*.52,E.H*.45,E.H*.2,E.W*.52,E.H*.45,E.H*.83);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,`rgba(0,0,0,${theme.image.vignette})`);c.globalAlpha=1;c.fillStyle=g;E.layout.canvas(c, 'ui/theme.js:76').fillRect(x,y,w,h);c.restore();
}
export function icon(kind,x,y,size=24,color=C.text){
  const c=E.ctx;c.save();c.translate(x,y);c.scale(size/24,size/24);c.strokeStyle=color;c.lineWidth=1.5;c.lineJoin='miter';E.layout.canvas(c, 'ui/theme.js:79').beginPath();
  if(kind==='medal'){E.layout.canvas(c, 'ui/theme.js:80').arc(12,10,7,0,Math.PI*2);E.layout.canvas(c, 'ui/theme.js:80').moveTo(8,16);E.layout.canvas(c, 'ui/theme.js:80').lineTo(6,23);E.layout.canvas(c, 'ui/theme.js:80').lineTo(12,20);E.layout.canvas(c, 'ui/theme.js:80').lineTo(18,23);E.layout.canvas(c, 'ui/theme.js:80').lineTo(16,16);E.layout.canvas(c, 'ui/theme.js:80').moveTo(12,6);E.layout.canvas(c, 'ui/theme.js:80').lineTo(13,9);E.layout.canvas(c, 'ui/theme.js:80').lineTo(16,9);E.layout.canvas(c, 'ui/theme.js:80').lineTo(14,11);E.layout.canvas(c, 'ui/theme.js:80').lineTo(15,14);E.layout.canvas(c, 'ui/theme.js:80').lineTo(12,12);E.layout.canvas(c, 'ui/theme.js:80').lineTo(9,14);E.layout.canvas(c, 'ui/theme.js:80').lineTo(10,11);E.layout.canvas(c, 'ui/theme.js:80').lineTo(8,9);E.layout.canvas(c, 'ui/theme.js:80').lineTo(11,9);E.layout.canvas(c, 'ui/theme.js:80').closePath();}
  else if(kind==='back'){E.layout.canvas(c, 'ui/theme.js:81').moveTo(16,5);E.layout.canvas(c, 'ui/theme.js:81').lineTo(9,12);E.layout.canvas(c, 'ui/theme.js:81').lineTo(16,19);}
  else if(kind==='lock'){E.layout.canvas(c, 'ui/theme.js:82').rect(5,10,14,11);E.layout.canvas(c, 'ui/theme.js:82').moveTo(8,10);E.layout.canvas(c, 'ui/theme.js:82').lineTo(8,6);E.layout.canvas(c, 'ui/theme.js:82').arc(12,6,4,Math.PI,0);E.layout.canvas(c, 'ui/theme.js:82').lineTo(16,10);}
  else if(kind==='airforce'){E.layout.canvas(c, 'ui/theme.js:83').moveTo(12,2);E.layout.canvas(c, 'ui/theme.js:83').lineTo(14,10);E.layout.canvas(c, 'ui/theme.js:83').lineTo(23,15);E.layout.canvas(c, 'ui/theme.js:83').lineTo(14,14);E.layout.canvas(c, 'ui/theme.js:83').lineTo(14,20);E.layout.canvas(c, 'ui/theme.js:83').lineTo(18,23);E.layout.canvas(c, 'ui/theme.js:83').lineTo(6,23);E.layout.canvas(c, 'ui/theme.js:83').lineTo(10,20);E.layout.canvas(c, 'ui/theme.js:83').lineTo(10,14);E.layout.canvas(c, 'ui/theme.js:83').lineTo(1,15);E.layout.canvas(c, 'ui/theme.js:83').lineTo(10,10);E.layout.canvas(c, 'ui/theme.js:83').closePath();}
  else if(kind==='armour'){E.layout.canvas(c, 'ui/theme.js:84').rect(2,12,20,8);E.layout.canvas(c, 'ui/theme.js:84').rect(7,7,10,5);E.layout.canvas(c, 'ui/theme.js:84').moveTo(12,7);E.layout.canvas(c, 'ui/theme.js:84').lineTo(23,5);}
  else if(kind==='navy'){E.layout.canvas(c, 'ui/theme.js:85').moveTo(12,2);E.layout.canvas(c, 'ui/theme.js:85').lineTo(12,21);E.layout.canvas(c, 'ui/theme.js:85').moveTo(5,9);E.layout.canvas(c, 'ui/theme.js:85').lineTo(19,9);E.layout.canvas(c, 'ui/theme.js:85').moveTo(3,14);E.layout.canvas(c, 'ui/theme.js:85').quadraticCurveTo(3,22,12,22);E.layout.canvas(c, 'ui/theme.js:85').quadraticCurveTo(21,22,21,14);}
  else if(kind==='infantry'){E.layout.canvas(c, 'ui/theme.js:86').moveTo(5,3);E.layout.canvas(c, 'ui/theme.js:86').lineTo(20,21);E.layout.canvas(c, 'ui/theme.js:86').moveTo(19,3);E.layout.canvas(c, 'ui/theme.js:86').lineTo(4,21);E.layout.canvas(c, 'ui/theme.js:86').moveTo(3,15);E.layout.canvas(c, 'ui/theme.js:86').lineTo(9,21);E.layout.canvas(c, 'ui/theme.js:86').moveTo(15,21);E.layout.canvas(c, 'ui/theme.js:86').lineTo(21,15);}
  else if(kind==='artillery'){E.layout.canvas(c, 'ui/theme.js:87').arc(9,17,5,0,Math.PI*2);E.layout.canvas(c, 'ui/theme.js:87').moveTo(10,12);E.layout.canvas(c, 'ui/theme.js:87').lineTo(21,3);E.layout.canvas(c, 'ui/theme.js:87').lineTo(23,6);E.layout.canvas(c, 'ui/theme.js:87').lineTo(13,16);E.layout.canvas(c, 'ui/theme.js:87').moveTo(12,20);E.layout.canvas(c, 'ui/theme.js:87').lineTo(22,22);}
  else {for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?5:11,x=12+Math.cos(a)*r,y=12+Math.sin(a)*r;i?E.layout.canvas(c, 'ui/theme.js:88').lineTo(x,y):E.layout.canvas(c, 'ui/theme.js:88').moveTo(x,y);}E.layout.canvas(c, 'ui/theme.js:88').closePath();}E.layout.canvas(c, 'ui/theme.js:88').stroke();c.restore();
}
export function heading(title,sub){text(sub,80,128,'caption',{tracking:2,color:C.muted,display:true});text(title,80,184,'title');}
export const loadBackground=async()=>E.image(menuAssets.keyArt);
export const header=(title,sub)=>heading(title,sub);
export const enter=(page,index,draw)=>page.enter(index,draw);
export const column=i=>theme.grid.margin+i*(theme.grid.column+theme.grid.gutter);
export const span=n=>n*theme.grid.column+(n-1)*theme.grid.gutter;
export function scrollbar(list){if(!list.max)return;const h=list.h*list.h/(list.count*list.itemH),y=list.y+(list.h-h)*list.scroll/list.max;E.ctx.fillStyle=C.border;E.layout.canvas(E.ctx, 'ui/theme.js:96').fillRect(list.x+list.w-3,list.y,3,list.h);E.ctx.fillStyle=C.text;E.layout.canvas(E.ctx, 'ui/theme.js:96').fillRect(list.x+list.w-3,y,3,h);}

export class MenuDialog {
  constructor(page,msg,o={},lock=false){this.page=page;this.msg=msg;this.title=o.title||(lock?'尚未解锁':'作战通知');this.lock=lock;this.btn=new E.Button({label:'确认',edge:true,onClick:()=>{o.onOk?.();page.closeDialog();}});}
  down(p){if(this.lock)this.armed=true;else this.btn.down(p);}
  up(p){if(this.lock){if(this.armed)this.page.closeDialog();}else this.btn.up(p);}
  key(e){if(['Enter',' ','Escape','Backspace'].includes(e.key)){e.preventDefault();this.lock?this.page.closeDialog():this.btn.click();}}
  draw(){const c=E.ctx,w=880,lines=wrap(this.msg,w-96),h=208+lines.length*32,x=(E.W-w)/2,y=(E.H-h)/2;c.save();c.fillStyle='rgba(0,0,0,.72)';E.layout.canvas(c, 'ui/theme.js:103').fillRect(0,0,E.W,E.H);panel(x,y,w,h);text(this.title,x+48,y+56,'heading');rule(x+48,y+96,w-96);lines.forEach((s,i)=>text(s,x+48,y+136+i*32));Object.assign(this.btn,{x:x+w-224,y:y+h-80,w:176,h:48});action(this.btn,{primary:true,label:this.lock?'返回':'确认'});c.restore();}
}
export class MenuPage extends Page {
  constructor(){super();this.showMedals=true;this.okText='开始作战';}
  async load(){if(this._loaded)return;await loadFonts();await super.load();this.keyImage=await E.image(menuAssets.keyArt);this.enterAt=performance.now();}
  notice(msg,o={}){this.dialog=new MenuDialog(this,msg,o);E.playSfx('pop.wav');}
  lockHint(msg){this.dialog=new MenuDialog(this,msg,{},true);E.playSfx('pop.wav');}
  renderBg(){const c=E.ctx;c.save();c.fillStyle=C.bg;E.layout.canvas(c, 'ui/theme.js:110').fillRect(0,0,E.W,E.H);cover(this.keyImage,{x:0,y:0,w:E.W,h:E.H});const g=c.createLinearGradient(0,E.H,E.W,0);g.addColorStop(0,'rgba(11,13,15,.97)');g.addColorStop(.45,'rgba(11,13,15,.80)');g.addColorStop(1,'rgba(11,13,15,.18)');c.fillStyle=g;E.layout.canvas(c, 'ui/theme.js:110').fillRect(0,0,E.W,E.H);filmTexture();c.restore();}
  enter(index,draw){const t=E.clamp((performance.now()-this.enterAt-index*theme.motion.stagger)/theme.motion.enter,0,1),ease=1-Math.pow(1-t,3);E.ctx.save();E.ctx.globalAlpha*=ease;E.ctx.translate(0,12*(1-ease));draw();E.ctx.restore();}
  draw(){this.renderBg();const c=E.ctx;c.save();c.translate(E.ox,E.oy);this.enter(0,()=>this.render());c.restore();this.drawChrome();}
  drawChrome(){const c=E.ctx;c.save();c.translate(E.ox,E.oy);rule(80,80,1440);text('世界征服者: 总体战',80,48,'body',{display:true,tracking:2});if(this.showMedals){icon('medal',1344,36,24,C.accent);text(E.state.medals,1518,48,'heading',{display:true,align:'right'});text('勋章',1416,48,'caption',{color:C.muted});}rule(80,792,1440);if(this.showBack){Object.assign(this.back,{edge:false,x:80,y:812,w:192,h:64});action(this.back,{label:'返回  /  Esc'});}if(this.hasOk){Object.assign(this.ok,{edge:false,x:1256,y:816,w:264,h:48});action(this.ok,{label:this.okText,primary:true});}if(this.footer)text(this.footer,this.showBack?256:80,840,'caption',{color:C.muted});c.restore();if(this.dialog)this.dialog.draw();}
  pointerCancel(){this.focusables().forEach(b=>b.disarm());if(this.list)this.list.drag=null;}
}


export function action(b, ...args) { return E.layout.group(b, 'ui/theme.js/action', () => layoutDraw_action(b, ...args)); }

export function listItem(b, ...args) { return E.layout.group(b, 'ui/theme.js/listItem', () => layoutDraw_listItem(b, ...args)); }

export function tab(b, ...args) { return E.layout.group(b, 'ui/theme.js/tab', () => layoutDraw_tab(b, ...args)); }

export function card(b, ...args) { return E.layout.group(b, 'ui/theme.js/card', () => layoutDraw_card(b, ...args)); }

export function panel(x,y,w,h) { return E.layout.region('ui/theme.js/panel',{x,y,w,h},()=>layoutDraw_panel(x,y,w,h)); }
