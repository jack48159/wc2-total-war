// 直播式弹幕：消息在屏幕左侧约 2/3 高度处出现，新消息把旧消息逐条往上顶；用来展示 LLM 对手每个操作的意图。
// 列表可滚动查看历史(保留最近 MAX_ITEMS 条，一屏约显示 8 条)；新消息到来时，如果正停在底部就自动跟到最新。
// 整个弹幕列表都可以拖动(鼠标按住列表任意处拖；触屏用顶部把手，因为列表内上下滑动是滚动)，位置记在本机，双击恢复默认位置。
// 滚轮/滚动条滚动历史。每个回合前有一条 ①——— 分隔线。
let wrap = null, list = null, queue = [], timer = null, turnNo = 0, gameId = null, history = [];
// 隐藏状态(点标题栏的 ▾ 按钮收起列表，只留一条标题栏；收起期间来的新弹幕在标题上显示条数)
let hidden = false, unseen = 0, titleEl = null, hideBtnEl = null;
try { hidden = localStorage.getItem('wc2_danmaku_hidden') === '1'; } catch (e) {}
const TITLE = '⋮⋮ 弹幕（拖动 · 双击复位）';
function applyHidden() {
  if (!wrap || !list) return;
  list.style.display = hidden ? 'none' : ''; wrap.classList.toggle('collapsed', hidden);
  if (hidden) { const pop = wrap.querySelector('.wc2-danmaku-pop'); if (pop) pop.hidden = true; } else unseen = 0;
  if (titleEl) titleEl.textContent = hidden ? `⋮⋮ 弹幕${unseen ? `（${unseen} 条新）` : ''}` : TITLE;
  if (hideBtnEl) { hideBtnEl.textContent = hidden ? '▸' : '▾'; hideBtnEl.title = hidden ? '展开弹幕列表' : '隐藏弹幕列表'; hideBtnEl.classList.toggle('on', hidden); }
  if (!hidden) list.scrollTop = list.scrollHeight;
}
const STYLE_ID = 'wc2-danmaku-style', POS_KEY = 'wc2.danmaku.pos', HIST_KEY = 'wc2.danmaku.history', MAX_ITEMS = 60, HIST_MAX_AGE = 3 * 24 * 3600 * 1000;
// 弹幕历史按对局保存(内存 + localStorage)：离开对局画面再回来、刷新页面恢复对局后，弹幕和回合编号都还在
const readHist = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY) || 'null'); } catch (e) { return null; } };
const writeHist = () => { try { if (gameId) localStorage.setItem(HIST_KEY, JSON.stringify({ gameId, turnNo, items: history, at: Date.now() })); } catch (e) {} };
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const circled = n => n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`;

const loadPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch (e) { return null; } };
const savePos = p => { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); else localStorage.removeItem(POS_KEY); } catch (e) {} };

function place(p) {                       // p = { x, y } 左上角像素位置；null = 默认位置(左侧、底边在屏幕高度约 2/3 处)
  if (!wrap) return;
  if (!p) { wrap.style.left = ''; wrap.style.top = ''; wrap.style.bottom = ''; return; }
  const r = wrap.getBoundingClientRect(), w = r.width || 300, h = r.height || 60;
  const x = Math.min(Math.max(0, p.x), Math.max(0, innerWidth - w)), y = Math.min(Math.max(0, p.y), Math.max(0, innerHeight - h));
  wrap.style.left = x + 'px'; wrap.style.top = y + 'px'; wrap.style.bottom = 'auto';
}

function ensure() {
  if (wrap && wrap.isConnected) return list;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = `
      .wc2-danmaku-wrap{position:fixed;left:max(14px,env(safe-area-inset-left));bottom:34vh;width:min(470px,42vw);z-index:30;display:flex;flex-direction:column;pointer-events:none}
      .wc2-danmaku-grip{align-self:stretch;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;text-align:center;
        background:rgba(22,15,6,.78);color:#d8b66c;border-radius:6px 6px 0 0;padding:3px 12px;font:700 12px/18px sans-serif;letter-spacing:2px;opacity:.9}
      .wc2-danmaku-grip:active{cursor:grabbing}
      .wc2-danmaku{user-select:none;-webkit-user-select:none;max-height:min(46vh,440px);display:flex;flex-direction:column;gap:4px;overflow-y:auto;overflow-x:hidden;pointer-events:none;overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(216,182,108,.6) transparent}
      .wc2-danmaku-wrap.scrolling .wc2-danmaku{pointer-events:auto;cursor:move}
      .wc2-danmaku-grip{display:flex;align-items:center;gap:6px;padding:2px 6px 2px 12px}
      .wc2-danmaku-title{flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wc2-danmaku-btn{pointer-events:auto;cursor:pointer;border:1px solid rgba(216,182,108,.55);background:rgba(60,42,16,.9);color:#f0d99a;border-radius:4px;min-width:26px;height:20px;padding:0 5px;font:700 12px/18px sans-serif}
      .wc2-danmaku-btn.on{background:#8a6a24;color:#fff6d8}
      .wc2-danmaku-pop{position:absolute;right:0;top:100%;margin-top:4px;z-index:2;pointer-events:auto;background:rgba(22,15,6,.94);border:1px solid rgba(216,182,108,.6);border-radius:6px;padding:8px 12px;display:flex;align-items:center;gap:8px;color:#f0d99a;font:600 12px/1 sans-serif}
      .wc2-danmaku-pop[hidden]{display:none}
      .wc2-danmaku-pop input{width:140px;accent-color:#d8b66c}
      .wc2-danmaku>:first-child{margin-top:auto}
      .wc2-danmaku::-webkit-scrollbar{width:6px}
      .wc2-danmaku::-webkit-scrollbar-thumb{background:rgba(216,182,108,.55);border-radius:3px}
      .wc2-danmaku-item{flex:0 0 auto;overflow-wrap:anywhere;background:rgba(22,15,6,.74);color:#f6e7bd;border-left:4px solid var(--c,#d8b66c);border-radius:6px;padding:4px 9px;
        font:600 13px/1.4 "Songti SC","Noto Serif CJK SC","SimSun",serif;text-shadow:0 1px 2px #000;animation:wc2-dm-in .35s ease-out both}
      .wc2-danmaku-item b{color:var(--c,#d8b66c);margin-right:6px}
      .wc2-danmaku-sep{flex:0 0 auto;min-height:17px;box-sizing:content-box;color:#d8b66c;font:700 13px/1.3 "Songti SC","Noto Serif CJK SC","SimSun",serif;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        padding:3px 8px;margin-top:4px;background:rgba(22,15,6,.62);border-radius:5px;letter-spacing:.5px;animation:wc2-dm-in .35s ease-out both}
      @keyframes wc2-dm-in{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}`;
    document.head.appendChild(st);
  }
  wrap = document.createElement('div'); wrap.className = 'wc2-danmaku-wrap';
  const grip = document.createElement('div'); grip.className = 'wc2-danmaku-grip'; grip.title = '拖动移动位置，双击恢复默认；在这里滚轮可翻看历史';
  list = document.createElement('div'); list.className = 'wc2-danmaku';
  // 标题栏：标题 + 翻看开关 + 透明度。内容区默认点击穿透到游戏，不挡住正常操作
  const title = document.createElement('span'); title.className = 'wc2-danmaku-title'; title.textContent = TITLE; titleEl = title;
  const mkBtn = (text, tip, fn) => {
    const b = document.createElement('button'); b.className = 'wc2-danmaku-btn'; b.type = 'button'; b.textContent = text; b.title = tip;
    for (const ev of ['pointerdown', 'dblclick', 'wheel']) b.addEventListener(ev, e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); fn(b); }); return b;
  };
  const pop = document.createElement('div'); pop.className = 'wc2-danmaku-pop'; pop.hidden = true;
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '10'; slider.max = '100'; slider.step = '5';
  const pct = document.createElement('span');
  let opacity = 100; try { const v = Number(localStorage.getItem('wc2_danmaku_opacity')); if (v >= 10 && v <= 100) opacity = v; } catch (err) {}
  const applyOpacity = v => { opacity = v; list.style.opacity = String(v / 100); slider.value = String(v); pct.textContent = `透明度 ${v}%`; try { localStorage.setItem('wc2_danmaku_opacity', String(v)); } catch (err) {} };
  slider.addEventListener('input', () => applyOpacity(Number(slider.value)));
  for (const ev of ['pointerdown', 'dblclick', 'wheel']) pop.addEventListener(ev, e => e.stopPropagation());
  pop.append(pct, slider);
  const opBtn = mkBtn('◐', '调节弹幕透明度', () => { pop.hidden = !pop.hidden; });
  const scrollBtn = mkBtn('↕', '翻看模式：开启后可在内容区滚动/拖动弹幕；关闭时点击会穿透到游戏', b => { const on = wrap.classList.toggle('scrolling'); b.classList.toggle('on', on); });
  const hideBtn = mkBtn('▾', '隐藏弹幕列表', () => { hidden = !hidden; try { localStorage.setItem('wc2_danmaku_hidden', hidden ? '1' : '0'); } catch (err) {} applyHidden(); });
  hideBtnEl = hideBtn;
  grip.append(title, scrollBtn, opBtn, hideBtn);
  grip.addEventListener('wheel', e => { list.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
  wrap.append(grip, pop, list); document.body.appendChild(wrap); applyOpacity(opacity);
  applyHidden();
  document.addEventListener('pointerdown', e => { if (wrap && !wrap.contains(e.target)) pop.hidden = true; });
  // 拖动(鼠标/触屏通用)
  let drag = null;
  const begin = (el, e) => {
    const r = wrap.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, el };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault(); e.stopPropagation();
  };
  grip.addEventListener('pointerdown', e => begin(grip, e));
  // 列表本体：鼠标/笔按住拖动；触屏不拦截(上下滑是滚动)；点在滚动条上也不拦截
  list.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    if (e.offsetX > list.clientWidth && e.target === list) return;
    begin(list, e);
  });
  const move = e => { if (drag) place({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }); };
  const end = e => { if (!drag) return; drag = null; const r = wrap.getBoundingClientRect(); savePos({ x: r.left, y: r.top }); };
  for (const el of [grip, list]) { el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('dblclick', () => { savePos(null); place(null); }); }
  const p = loadPos(); if (p) place(p);
  addEventListener('resize', () => { const q = loadPos(); if (q && wrap && wrap.isConnected) place(q); });
  return list;
}

function append(host, item) {
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 48;   // 用户正在翻看历史时不强拉到底
  host.appendChild(item);
  while (host.children.length > MAX_ITEMS) host.firstChild.remove();             // 常驻：不自动消失，只有超过上限才挤掉最旧的
  if (atBottom) host.scrollTop = host.scrollHeight;
}

function show(entry, restoring = false) {
  const { who, text, color, sep } = entry;
  const host = ensure(), item = document.createElement('div');
  if (restoring) item.style.animation = 'none';
  else { history.push({ who, text, color, sep }); if (history.length > MAX_ITEMS) history.shift(); writeHist(); }
  if (sep) { item.className = 'wc2-danmaku-sep'; item.textContent = text; append(host, item); if (hidden) { unseen++; applyHidden(); } return; }
  item.className = 'wc2-danmaku-item'; if (color) item.style.setProperty('--c', color);
  if (who) { const b = document.createElement('b'); b.textContent = who; item.appendChild(b); }
  item.appendChild(document.createTextNode(text));
  append(host, item);
  if (hidden) { unseen++; applyHidden(); }
}

// items: [{ who, text, color }]，按 gap 毫秒逐条放出
export const Danmaku = {
  audienceLabel(message, nameOf = c => c) {
    if (message.visibility === 'broadcast') return '广播';
    if (message.visibility === 'direct') return `定向→${(message.recipients || []).map(nameOf).join('、')}`;
    return '仅用户';
  },
  push(items, gap = 1100) {
    queue.push(...items.filter(i => i && i.text));
    if (timer) return;
    const tick = () => { const next = queue.shift(); if (!next) { timer = null; return; } show(next); timer = setTimeout(tick, gap); };
    tick();
  },
  // 每个回合的弹幕之前插一条分隔线，如 “①———— 第 3 回合 · 德国 ————”
  // 进入对局时调用：切换到该对局的弹幕历史(同一对局则恢复显示)
  attach(id) {
    if (gameId === id) { if (history.length && !(wrap && wrap.isConnected)) this.restore(); return; }
    gameId = id; history = []; turnNo = 0; queue = [];
    const h = readHist();
    if (h && h.gameId === id && Date.now() - (h.at || 0) < HIST_MAX_AGE) { history = Array.isArray(h.items) ? h.items : []; turnNo = h.turnNo || 0; }
    this.restore();
  },
  restore() { if (!history.length) return; ensure(); list.textContent = ''; for (const e of history) show(e, true); list.scrollTop = list.scrollHeight; },
  // 回到对局画面(同一个对局对象被重新显示时不会重新初始化)：有历史但界面不在，就恢复出来
  keepAlive() { if (gameId && history.length && !(wrap && wrap.isConnected)) this.restore(); },
  // 离开对局画面：只拿掉界面，历史保留
  detach() { queue = []; clearTimeout(timer); timer = null; if (wrap) { wrap.remove(); wrap = null; list = null; } },
  sepText(n, label) { return `${circled(n)}${'—'.repeat(4)} ${label} ${'—'.repeat(30)}`; },
  // 用桥上保存的历史重建(本地没有历史时)：items 已按顺序含分隔线
  hydrate(items, turns) { if (history.length || !items.length) return; history = items.slice(-MAX_ITEMS); turnNo = turns; writeHist(); this.restore(); },
  turn(label) { turnNo++; writeHist(); this.push([{ sep: true, text: this.sepText(turnNo, label) }], 1); },
  // 彻底清空(新开局)
  clear() { this.detach(); turnNo = 0; history = []; try { localStorage.removeItem(HIST_KEY); } catch (e) {} }
};
