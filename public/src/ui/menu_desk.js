// Shared menu styling adapter for the pages that predate theme.js.
// Kept as an adapter so page geometry and input behavior stay intact.
import { E } from '../core/index.js';
import { C, theme, MenuPage as ThemedMenuPage, rule as themeRule, filmTexture } from './theme.js';

export const MENU_KEY_ART='assets/mainbg@2x.webp';
export const INK=C.text, MUTED=C.muted, RED=C.accent;
const INK_WARM='#e6d8bd', INK_SOFT='#b8a98e', ACCENT='#a58a5e';
const colorMap=new Map([['#2a1d12',INK_WARM],['#796449',INK_SOFT],['#8b3025',ACCENT],['#dfbf83',ACCENT],['#c9ac76',ACCENT],['#fff2d4',INK_WARM]]);
export function text(s,x,y,size=28,o={}){
  const c=E.ctx,px=size<=17?15:size<=21?20:size<=30?28:size<=43?44:72;
  c.save();c.font=`${o.bold?800:px>=44?800:500} ${px}px ${px>=44?theme.font.display:theme.font.body}`;c.textAlign=o.align||'left';c.textBaseline='middle';c.fillStyle=colorMap.get(o.color)||o.color||C.text;
  if('letterSpacing'in c)c.letterSpacing=(o.tracking||0)+'px';E.layout.canvas(c, 'ui/menu_desk.js:13').fillText(String(s),x,y);c.restore();
}
export function rule(x,y,x2,color=C.line){themeRule(x,y,x2-x,colorMap.get(color)||color);}
export function stamp(s,x,y,color=RED){
  const c=E.ctx;c.save();c.strokeStyle='rgba(210,190,153,.34)';c.lineWidth=1;E.layout.canvas(c, 'ui/menu_desk.js:17').strokeRect(x-60,y-14,120,28);text(s,x,y,15,{align:'center',bold:true,color:colorMap.get(color)||color});c.restore();
}
// width of s exactly as text() draws it (same size mapping and font), so an underline spans the whole label
export function textWidth(s,size=28,o={}){
  const c=E.ctx,px=size<=17?15:size<=21?20:size<=30?28:size<=43?44:72;
  c.save();c.font=`${o.bold?800:px>=44?800:500} ${px}px ${px>=44?theme.font.display:theme.font.body}`;if('letterSpacing'in c)c.letterSpacing=(o.tracking||0)+'px';const w=c.measureText(String(s)).width;c.restore();return w;
}
export function underline(x,y,w){const c=E.ctx;c.save();c.fillStyle='rgba(210,190,153,.82)';E.layout.canvas(c, 'ui/menu_desk.js:24').fillRect(x,y,Math.max(24,w),1.5);c.restore();}
// Text-only hover and keyboard focus, measured in the same font as the label.
function layoutDraw_menuLabel(b,label,x,y,o={}){
  const hot=!!(b.hover||b.focused),style={...o,color:hot?'#f3e7d0':o.color};
  E.text(label,x,y,style);
  if(!hot)return;
  const c=E.ctx;c.save();c.font=`${o.bold?'bold ':''}${o.size||28}px ${o.font||E.FONT}`;
  const w=c.measureText(String(label)).width,left=o.align==='center'?x-w/2:o.align==='right'?x-w:x;
  c.fillStyle='rgba(232,215,183,.78)';E.layout.canvas(c, 'ui/menu_desk.js:32').fillRect(left,y+(o.size||28)*.62,w,1);c.restore();
}
function layoutDraw_chromeAction(b,label,{primary=false,right=false,mapBackdrop=false}={}){
  if(!b||!b.visible)return;
  const c=E.ctx,hot=!!(b.hover||b.focused),pressed=!!b.pressed;
  const size=primary?34:32,color=pressed?'#9b8a70':hot?'#f3e7d0':'#e6d8bd';
  const caption=right?String(label):'‹ '+label,cx=b.x+b.w/2,cy=b.y+b.h/2;
  c.save();c.font='500 '+size+'px '+theme.font.display;
  const width=c.measureText(caption).width;
  if(mapBackdrop){
    const radius=width*1.5,glow=c.createRadialGradient(cx,cy,0,cx,cy,radius);
    glow.addColorStop(0,'rgba(0,0,0,.55)');glow.addColorStop(.3,'rgba(0,0,0,.48)');glow.addColorStop(1,'rgba(0,0,0,0)');
    c.fillStyle=glow;E.layout.canvas(c, 'ui/menu_desk.js:44').fillRect(cx-radius,cy-radius,radius*2,radius*2);
  }
  c.globalAlpha*=b.enabled===false?.48:1;
  c.textBaseline='middle';c.fillStyle=color;c.textAlign='center';E.layout.canvas(c, 'ui/menu_desk.js:47').fillText(caption,cx,cy);
  if(hot){c.fillStyle=pressed?'rgba(201,185,158,.38)':'rgba(232,215,183,.78)';E.layout.canvas(c, 'ui/menu_desk.js:48').fillRect(cx-width/2,cy+size*.62,width,1);}
  c.restore();
}
function layoutDraw_button(pg,b,label=b.label){
  if(!b.visible)return;const c=E.ctx,hot=b.hover||b.focused;c.save();c.globalAlpha*=b.enabled===false?.5:1;
  text(label,b.x+b.w/2,b.y+b.h/2,22,{align:'center',bold:hot,color:hot?INK_WARM:INK_SOFT});
  if(hot){const w=textWidth(label,22,{bold:true});underline(b.x+b.w/2-w/2,b.y+b.h/2+17,w);}
  if(b.pressed){c.globalAlpha=.65;text(label,b.x+b.w/2,b.y+b.h/2+1,22,{align:'center',bold:true,color:ACCENT});}
  c.restore();
}
export function folder(pg,{x=80,y=76,w=1440,h=738,spine=180}={}){
  const c=E.ctx;c.save();c.fillStyle='rgba(30,23,16,.13)';E.layout.canvas(c, 'ui/menu_desk.js:59').fillRect(x,y,w,h);c.restore();filmTexture(x,y,w,h);
}
export function heading(title,sub,cx=895,y=144,left=340,right=1450){
  text(title,cx,y,44,{bold:true,align:'center'});text(sub,cx,y+49,20,{align:'center',color:INK_SOFT});
}
export function spineLabel(label,sub='作战指挥部'){
  text(sub,170,138,15,{align:'center',color:INK_SOFT});text(label,187,247,28,{align:'center',bold:true});
}
export class MenuPage extends ThemedMenuPage {
  constructor(...args){super(...args);this.keyArt=this.keyArt||false;}
  renderBg(){
    const c=E.ctx;c.save();c.fillStyle=C.bg;E.layout.canvas(c, 'ui/menu_desk.js:70').fillRect(0,0,E.W,E.H);
    const bg=this.keyArt?this.keyImage:(this.bg||this.keyImage);if(bg){const scale=Math.max(E.W/bg.width,E.H/bg.height);c.filter=theme.image.filter;E.layout.canvas(c, 'ui/menu_desk.js:71').drawImage(bg,(E.W-bg.width*scale)/2,(E.H-bg.height*scale)/2,bg.width*scale,bg.height*scale);}
    c.filter='none';const shade=c.createLinearGradient(0,E.H,E.W,0);shade.addColorStop(0,'rgba(26,20,14,.60)');shade.addColorStop(.56,'rgba(26,20,14,.35)');shade.addColorStop(1,'rgba(26,20,14,.12)');c.fillStyle=shade;E.layout.canvas(c, 'ui/menu_desk.js:72').fillRect(0,0,E.W,E.H);
    if(this.darkKeyArt){c.fillStyle='rgba(8,8,8,.34)';E.layout.canvas(c, 'ui/menu_desk.js:73').fillRect(0,0,E.W,E.H);}
    filmTexture();c.restore();
  }
  drawChrome(){
    const c=E.ctx;c.save();c.translate(E.ox,E.oy);text('世界征服者: 总体战',80,48,21,{bold:true,color:INK_WARM});
    if(this.showBack){Object.assign(this.back,{edge:false,x:80,y:812,w:192,h:64});chromeAction(this.back,'返回',{mapBackdrop:this.mapBackdrop});}
    if(this.hasOk){Object.assign(this.ok,{edge:false,x:1256,y:812,w:264,h:64});chromeAction(this.ok,this.okText,{primary:true,right:true});}
    if(this.showMedals)text('勋章  '+E.state.medals,1500,48,20,{align:'right',color:INK_SOFT});
    if(this.footer)text(this.footer,256,840,15,{color:INK_SOFT});c.restore();if(this.dialog)this.dialog.draw();
  }
}

export function menuLabel(b, ...args) { return E.layout.group(b, 'ui/menu_desk.js/menuLabel', () => layoutDraw_menuLabel(b, ...args)); }

export function chromeAction(b, ...args) { return E.layout.group(b, 'ui/menu_desk.js/chromeAction', () => layoutDraw_chromeAction(b, ...args)); }

export function button(pg, b, ...args) { return E.layout.group(b, 'ui/menu_desk.js/button', () => layoutDraw_button(pg, b, ...args)); }
