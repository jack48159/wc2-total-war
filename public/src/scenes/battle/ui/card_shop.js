// Card shop, composed from the original WC2 background and texture atlases.
import { E } from '../../../core/index.js';
import '../../../ui/ui.js';
import { ResourceBar } from '../../../ui/resource_bar.js';
import { dockLayout, cornerLayout, drawDock, pt, resourceBarPos } from '../../../ui/corner_plate.js';

const TYPES = [
  ['army', 'label_groundforces'], ['navy', 'label_navy'],
  ['airforce', 'label_airforces'], ['development', 'label_development'],
  ['strategy', 'label_strategy'],
];
const SERIF = E.CJK_SERIF;

export class CardShop {
  // game: Game; ui: { ui1, ui2 } atlases; hooks: { close(), purchased(card), notice(msg) }
  constructor(game, ui, cards, hooks, initial = 'army') {
    this.game = game; this.ui = ui; this.hooks = hooks;
    this.ownTouch = true;   // 自己处理横向拖动；否则触屏一指拖动会被引擎当成竖向滚轮，右边的卡牌永远滑不出来
    this.cards = cards;
    const previous = typeof initial === 'string' ? { tab: initial } : (initial || {});
    this.tab = TYPES.some(([id]) => id === previous.tab) ? previous.tab : 'army';
    this.selected = Math.max(0, this.list.findIndex(card => card.id === previous.cardId));
    this.scroll = E.clamp(Number(previous.scroll) || 0, 0, this.maxScroll());
    this.ensureSelectedVisible();
    this.drag = null;
    this.images = {};this.customImages={};for(const card of cards)if(card.imageUrl)E.image(card.imageUrl).then(img=>this.customImages[card.id]=img).catch(()=>{});
    this.bar = new ResourceBar(ui.ui1);
    Promise.all([
      E.image('assets/buycardbg-568h@2x.webp'),
      E.image('assets/board_paper-568h@2x.webp'),
      E.atlas('cardtex_hd'),
    ]).then(([background, paper, cardsAtlas]) => {
      Object.assign(this.images, { background, paper, cardsAtlas });
    });
  }

  get list() { return this.cards.filter(card => card.type === this.tab); }
  get card() { return this.list[this.selected]; }
  price(card) { return this.game.price(card); }
  industry(card) { return this.game.industryCost(card); }
  canBuy(card) { return !!card && !this.game.whyNot(card); }
  layout() {
    // 触屏：内容区按“屏幕高度减去底部横条(21pt)”来缩放，说明纸不压在横条上；桌面不变
    const reserved = this.hooks.armyPanelWidth?.() || 0;
    const width = Math.max(1, E.W - reserved);
    const B = E.platform?.isTouch ? pt(21) : 0, scale = Math.min(width / 1136, (E.H - B) / 640);
    this.geometry = { scale, x: (width - 1136 * scale) / 2, y: (E.H - B - 640 * scale) / 2 };
    // 触屏：卡片纸板和卡片带向两侧延伸到屏幕边(ext = 每侧多出的内容单位)，卡片铺满屏幕宽度；桌面 ext=0 不变
    this.ext = E.platform?.isTouch && !reserved ? Math.max(0, this.geometry.x / scale) : 0;
  }
  get stripW() { return 1136 + 2 * (this.ext || 0); }
  // 第一张卡片离卡片带左端的距离：桌面 38；触屏要避开左侧灵动岛/圆角(62pt)
  get pad0() { return this.ext ? Math.max(38, pt(62) / this.geometry.scale + 8) : 38; }
  local(point) {
    const { scale, x, y } = this.geometry;
    return { x: (point.x - x) / scale, y: (point.y - y) / scale };
  }
  maxScroll() { return Math.max(0, this.pad0 + this.list.length * 228 - this.stripW + (this.ext ? this.pad0 : 20)); }
  ensureSelectedVisible() {
    const left = this.pad0 + this.selected * 228;
    if (left < this.scroll) this.scroll = left - 20;
    if (left + 204 > this.scroll + this.stripW - 20) this.scroll = left + 204 - (this.stripW - 20);
    this.scroll = E.clamp(this.scroll, 0, this.maxScroll());
  }
  cardAt(point) {
    if (point.y < 52 || point.y > 353) return -1;
    const raw = point.x + (this.ext || 0) + this.scroll - this.pad0;
    if (raw < 0 || raw % 228 > 204) return -1;
    const index = Math.floor(raw / 228);
    return index < this.list.length ? index : -1;
  }
  tabAt(point) {
    if (point.y < 375 || point.y > 480) return -1;
    return TYPES.findIndex((_, i) => point.x >= 51 + i * 133 && point.x <= 169 + i * 133);
  }
  down(point) {
    this.layout();
    const local = this.local(point);
    this.drag = { x: local.x, scroll: this.scroll, moved: false, start: local };
  }
  move(point) {
    if (!this.drag) return;
    const local = this.local(point), drag = this.drag;
    if (Math.abs(local.x - drag.x) > 5) drag.moved = true;
    if (drag.moved && drag.start.y >= 52 && drag.start.y <= 353) {
      const raw = drag.scroll - (local.x - drag.x), max = this.maxScroll();
      // rubber band: the strip follows the finger past either end (with resistance) and springs back on release
      this.scroll = raw < 0 ? raw * 0.5 : raw > max ? max + (raw - max) * 0.5 : raw;
    }
  }
  up(point) {
    const drag = this.drag; this.drag = null;
    this.settle = true;
    if (!drag || drag.moved) return;
    const local = this.local(point);
    // 返回/确认按钮贴在屏幕两个下角(屏幕坐标)，不跟商城内容区的留黑边走
    const inRect = r => r && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;
    if (inRect(this.backRect)) { this.hooks.close(); E.playSfx('cancel.wav'); return; }
    if (inRect(this.okRect)) { this.purchase(); return; }
    const tab = this.tabAt(local);
    if (tab >= 0) {
      this.tab = TYPES[tab][0]; this.selected = 0; this.scroll = 0;
      E.playSfx('select.wav'); return;
    }
    const card = this.cardAt(local);
    if (card >= 0) { this.selected = card; E.playSfx('select.wav'); }
  }
  wheel(delta) {
    this.layout();
    this.scroll = E.clamp(this.scroll + delta / this.geometry.scale, 0, this.maxScroll());
  }
  key(event) {
    // Esc, or pressing the same 打开卡片商店 hotkey again, closes the shop (open/close on one key, like the other dialogs).
    if (event.key === 'Escape' || E.hotkeys.match(event) === 'cardShop') { this.hooks.close(); return; }
    if (event.key === 'ArrowRight') this.selected = Math.min(this.list.length - 1, this.selected + 1);
    else if (event.key === 'ArrowLeft') this.selected = Math.max(0, this.selected - 1);
    else if (event.key === 'Enter') { this.purchase(); return; }
    else return;
    event.preventDefault(); this.ensureSelectedVisible();
  }
  purchase() {
    const card = this.card, g = this.game; if (!card) return;
    const whyNot = g.whyNot(card);
    if (whyNot) {
      const detailed = {
        cooldown: `该卡片还需等待 ${g.cardCooldowns[card.id] || 0} 回合。`,
        'max-tech': '科技等级已经达到上限。',
        commander: '当前无法购买指挥官卡。',
      }[whyNot];
      if (detailed) { this.hooks.notice(detailed); return; }
      const msg = { tech: `需要科技等级 ${card.tech}，当前为 ${g.tech}。`, money: '资金不足。', industry: '工业值不足。' }[whyNot];
      if (msg) this.hooks.notice(msg);
      return;
    }
    if (card.id === 21) {
      const r = g.apply({ type: 'buyCard', card });
      if (r.ok) { E.playSfx('buy.wav'); this.hooks.purchased?.(card); return; }
    } else {
      this.hooks.purchased?.(card, { pending: true });
    }
  }
  springBack() {
    const max = this.maxScroll(), now = performance.now(), dt = Math.min(0.05, (now - (this.lastT || now)) / 1000); this.lastT = now;
    if (this.drag && this.drag.moved) return;
    const target = E.clamp(this.scroll, 0, max);
    if (this.scroll !== target) { this.scroll += (target - this.scroll) * Math.min(1, dt * 12); if (Math.abs(this.scroll - target) < 0.5) this.scroll = target; }
  }
  draw() {
    this.layout(); this.springBack();
    const c = E.ctx, g = this.game, atlas = this.images.cardsAtlas;
    const { scale, x, y } = this.geometry;
    c.fillStyle = '#241007'; E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:138').fillRect(0, 0, E.W, E.H);
    const touchBg = false;
    if (E.platform?.isTouch && this.images.background && x > 0) {
      // 触屏：内容区两侧的空白用背景图下半部“地图桌面”那一段等比填满(不拉伸)，皮革面板像放在地图桌上
      const bg = this.images.background, sy = bg.height * 0.64, sh = bg.height - sy, k = E.H / sh, sw = Math.min(bg.width / 2, x / k + 2);
      c.drawImage(bg, 0, sy, sw, sh, x - sw * k, 0, sw * k, E.H);
      c.drawImage(bg, bg.width - sw, sy, sw, sh, x + 1136 * scale, 0, sw * k, E.H);
    }
    c.save(); c.translate(x, y); c.scale(scale, scale);
    const frame = (item, dx, dy, dw, dh, filter) => {
      if (!item) return;
      c.save(); if (filter) c.filter = filter;
      E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:143').drawImage(item.img, item.x, item.y, item.w, item.h, dx, dy, dw, dh);
      c.restore();
    };
    if (this.images.background && !touchBg) E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:146').drawImage(this.images.background, 0, 0, 1136, 640);
    if (this.images.background && this.ext > 0) {
      // 触屏：背景上半部的皮革面板也向两侧延伸(两端原样、中段平铺)，和纸板一起铺满屏幕宽度
      const b = this.images.background, sx = 1136 / b.width, sy = 640 / b.height, hS = Math.round(b.height * 0.64), cap = Math.round(b.width * 0.12), midW = b.width - 2 * cap;
      const L = -this.ext, R = 1136 + this.ext, capD = cap * sx, hD = hS * sy;
      c.drawImage(b, 0, 0, cap, hS, L, 0, capD, hD);
      c.drawImage(b, b.width - cap, 0, cap, hS, R - capD, 0, capD, hD);
      for (let dx = L + capD; dx < R - capD; dx += midW * sx) { const w = Math.min(midW * sx, R - capD - dx); c.drawImage(b, cap, 0, w / sx, hS, dx, 0, w, hD); }
    }
    if (this.images.paper && this.ext > 0) {
      // 触屏：纸板向两侧延伸——左右两端原样画在屏幕边，中间用纸板中段原样平铺(不拉伸)
      const p = this.images.paper, sx = 1136 / p.width, sy = 380 / p.height, cap = Math.round(p.width * 0.18), mid0 = cap, midW = p.width - 2 * cap;
      const L = -this.ext, R = 1136 + this.ext, capD = cap * sx;
      c.drawImage(p, 0, 0, cap, p.height, L, 22, capD, 380);
      c.drawImage(p, p.width - cap, 0, cap, p.height, R - capD, 22, capD, 380);
      for (let dx = L + capD; dx < R - capD; dx += midW * sx) {
        const w = Math.min(midW * sx, R - capD - dx);
        c.drawImage(p, mid0, 0, w / sx, p.height, dx, 22, w, 380);
      }
    } else if (this.images.paper) E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:147').drawImage(this.images.paper, 0, 22, 1136, 380);

    // All ribbons retain their proportions. The card panel hides the upper
    // part of the inactive ones, leaving only their lower ends visible.
    if (atlas) TYPES.forEach(([id, image], index) => {
      E.layout.group({x:51+index*133,y:378,w:118,h:110,label:'卡片分类 '+id,layoutInput:true}, 'battle/card_shop/tab/'+id, () => {
      const selected = id === this.tab;
      c.save();
      if (!selected) { E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:154').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:154').rect(0, 378, 1136, 110); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js/clip').clip(); }
      frame(atlas[image], 51 + index * 133, 0, 118, 466);
      c.restore();
      });
    });

    c.save(); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:159').beginPath(); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:159').rect(-(this.ext || 0), 48, this.stripW, 310); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js/clip').clip();
    this.list.forEach((card, index) => {
      const px = this.pad0 - (this.ext || 0) + index * 228 - this.scroll;
      if (px > 1136 + (this.ext || 0) || px + 204 < -(this.ext || 0)) return;
      // card body and art share ONE uniform scale (body 221x324 source px); the art sits 4.5 / 4 source px inside the body
      // Original GUICard::OnRender (project/.../GUICardRelated.cpp): everything hangs off the card rect origin A.
      //   shadow (only when selected):  RenderEx(A, scale 2) - hotspot 11,11 applied inside
      //   body   card_common:           Render(A)           - hotspot 6,12 applied inside
      //   art:                          Render(A.x, A.y + 7 logical px = 14 atlas px)
      const k = 206 / 221, selected = index === this.selected, body = atlas && atlas.card_common;
      const Ax = px + 6 * k, Ay = 51 + 12 * k;
      E.layout.group({x:px,y:51,w:221*k,h:324*k,label:card.name||String(card.id),layoutInput:true}, 'battle/card_shop/card/'+card.id, () => {
      if (selected && atlas && atlas.card_shadow) { const sh = atlas.card_shadow, q = 2 * k; frame(sh, Ax - sh.rx * q, Ay - sh.ry * q, sh.w * q, sh.h * q); }
      frame(body, px, 51, 221 * k, 324 * k);
      frame(atlas && atlas[card.image], Ax, Ay + 14 * k, 202 * k, 234 * k);
      if(this.customImages[card.id])c.drawImage(this.customImages[card.id],Ax,Ay+14*k,202*k,234*k);
      if(card.custom)E.text(card.name,px+102,165,{size:26,bold:true,align:'center',color:'#f8ecc4',stroke:'#222',strokeW:3});
      if (card.id === 21) {
        E.text(['I', 'II', 'III', 'IV', 'V'][Math.min(4, g.tech)] || 'IV',
          px + 102, 184, { size: 100, bold: true, align: 'center', font: SERIF,
            color: '#d7b974', stroke: '#394b45', strokeW: 3 });
      }
      if (!this.canBuy(card) || card.id === 25) {
        c.fillStyle = 'rgba(0,0,0,.47)'; E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:179').beginPath();
        E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:180').roundRect(px, 51, 221 * k, 324 * k, 14); E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:180').fill();
      }
      const cooldown = g.cardCooldowns[card.id] || 0;
      if (cooldown > 0) E.text(String(cooldown), px + 177 * k, 82, { size: 32, bold: true, align: 'center', font: E.NUM, color: '#f7e7b4', stroke: '#5a160e', strokeW: 5 });
      const price = this.price(card), industry = this.industry(card);
      // numbers centred between the printed "$" and wrench (body-relative: $ at x~30, wrench at x~120, y~283 of 221x324)
      E.text(String(price), px + 76 * k, 51 + 284 * k, { size: 27, bold: true, font: E.NUM, align: 'center',
        color: g.money < price ? '#a61813' : '#282215' });
      E.text(String(industry), px + 172 * k, 51 + 284 * k, { size: 27, bold: true, font: E.NUM, align: 'center',
        color: g.industry < industry ? '#a61813' : '#282215' });
      });
    });
    c.restore();

    const ui = this.ui.ui1;
    frame(ui.technology_board, 486, -10, 162, 58);
    frame(ui['technology_' + Math.max(1, Math.min(5, g.tech))], 552, 3, 28, 36);

    const selected = this.card;
    if (selected) {
      E.text(E.strings[selected.name] || selected.name, 588, 498,
        { size: 29, align: 'center', color: '#30251a', font: SERIF });
      E.wrap(selected.custom?selected.description||selected.name:E.strings[selected.intro] || '', 570, 22).forEach((line, index) => {
        E.text(line, 313, 537 + index * 30, { size: 22, color: '#342719' });
      });
    }

    c.restore();
    // 屏幕坐标：返回/确认按钮贴屏幕左下/右下角，勋章条在返回按钮右侧同一底边(不受 1136x640 内容区留黑边影响)
    if (E.platform?.isTouch) {
      // 触屏：返回/确认用四角坞(原按钮板和图标等比放大、贴死物理角，见 ui/corner_plate.js)，勋章条在返回坞右侧
      const sc = scale, Lb = dockLayout(ui.buttonboard_gray, 'bl'), Lo = dockLayout(ui.buttonboard_green, 'br');
      this.backRect = { x: Lb.x0, y: Lb.y0, w: Lb.w, h: Lb.h }; this.okRect = { x: Lo.x0, y: Lo.y0, w: Lo.w, h: Lo.h };
      const mx = Lb.x0 + Lb.w + pt(8), mh = 44 * sc, my = E.H - mh;
      c.fillStyle = 'rgba(241,220,170,.83)'; c.fillRect(mx, my, 145 * sc, mh);
      if (this.ui.ui2.medal) { const m = this.ui.ui2.medal; c.drawImage(m.img, m.x, m.y, m.w, m.h, mx + 14 * sc, my + 3 * sc, 26 * sc, 38 * sc); }
      E.text(String(E.state.medals), mx + 49 * sc, my + 24 * sc, { size: 29 * sc, bold: true, color: '#fff', stroke: '#21170e', strokeW: 5, font: E.NUM });
      drawDock(ui.buttonboard_gray, 'bl', { layout: Lb, icon: ui.buttontext_back });
      drawDock(ui.buttonboard_green, 'br', { layout: Lo, icon: ui.buttontext_ok });
    } else {
      const sc = scale, Lb = cornerLayout(ui.buttonboard_gray, 'bl', sc), Lo = cornerLayout(ui.buttonboard_green, 'br', sc);
      const bw = Lb.w, bh = Lb.h, by = Lb.y0;
      this.backRect = { x: Lb.x0, y: Lb.y0, w: Lb.w, h: Lb.h };
      this.okRect = { x: Lo.x0, y: Lo.y0, w: Lo.w, h: Lo.h };
      const sframe = (item, dx, dy, dw, dh) => { if (item) E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:corners').drawImage(item.img, item.x, item.y, item.w, item.h, dx, dy, dw, dh); };
      const mx = this.backRect.x + bw + 9 * sc, mh = 44 * sc, my = E.H - mh;
      c.fillStyle = 'rgba(241,220,170,.83)'; E.layout.canvas(c, 'scenes/battle/ui/card_shop.js:medalbox').fillRect(mx, my, 145 * sc, mh);
      sframe(this.ui.ui2.medal, mx + 14 * sc, my + 3 * sc, 26 * sc, 38 * sc);
      E.text(String(E.state.medals), mx + 49 * sc, my + 24 * sc, { size: 29 * sc, bold: true, color: '#fff', stroke: '#21170e', strokeW: 5, font: E.NUM });
      E.layout.button({ x: this.backRect.x, y: by, w: bw, h: bh, label: '返回', layoutInput: true }, 'battle/card_shop/back');
      drawDock(ui.buttonboard_gray, 'bl', { layout: Lb, clip: false, icon: ui.buttontext_back });
      E.layout.button({ x: this.okRect.x, y: by, w: bw, h: bh, label: '确认', layoutInput: true }, 'battle/card_shop/ok');
      drawDock(ui.buttonboard_green, 'br', { layout: Lo, clip: false, icon: ui.buttontext_ok });
    }
    // Screen-space HUD, like BattleHud and Bank.drawChrome: do not inherit
    // the shop's 1136x640 content scale or its vertical letterbox offset.
    const bp = E.platform?.isTouch ? resourceBarPos() : { x: 0, y: 0 };   // 触屏：和战斗 HUD 同一个(可拖动的)位置
    this.bar.draw(bp.x, bp.y, 268, g.money, g.industry, { stability: g.getStability(g.player) });
  }
}
