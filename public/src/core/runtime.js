// Canvas setup, input dispatch and the main loop.
import { E, DESIGN_W as W, DESIGN_H as H } from './kernel.js';
import { unlockAudio } from './audio.js';
import { Perf } from './perf.js';
import { beginVisibilityFrame, endVisibilityFrame } from '../game/rules/visibility.js';
import { platform } from '../platform/detect.js';

// initial: what E.go() should open first (name / class / instance).
E.start = async (canvasId, initial) => {
  const cv = E.cv = document.getElementById(canvasId), ctx = E.ctx = cv.getContext('2d');
  const resize = () => {
    const rs = E.exp('halfres') ? 0.6 : E.exp('quarterres') ? 0.5 : 1;                 // ?exp=halfres/quarterres: render the canvas at a lower internal resolution (a fill-rate / GPU-bandwidth A/B test)
    const dpr = (window.devicePixelRatio || 1) * rs, rect = cv.getBoundingClientRect(), fullW = rect.width * dpr, fullH = rect.height * dpr;
    // Fill the whole window: wider than 16:9 -> more horizontal space, taller than 16:9 -> more vertical space.
    const vw = fullW, vh = fullH;
    if (vw / vh >= W / H) { E.H = H; E.W = Math.round(H * vw / vh); } else { E.W = W; E.H = Math.round(W * vh / vw); }
    // 触屏：菜单页内容整体上移半个底部安全距离(横条 21pt)，底部提示文字不压在横条上；桌面不变
    E.ox = (E.W - W) / 2; E.oy = (E.H - H) / 2 - (platform.isTouch ? 10.5 * dpr * E.H / fullH : 0);
    cv.width = Math.round(fullW); cv.height = Math.round(fullH);
    E.view = { scale: vw / E.W, ox: 0, oy: 0, dpr, il: 0, ir: 0, it: 0, ib: 0 };
    // 触屏：整个画布就是整屏，贴边元素自然贴着屏幕边缘
    // 只对四个角上的元素(资源条/暂停/商店/结束回合、返回/确认)生效，边上的元素(菜单页签、国家列表)仍然完全贴边。
    // 圆角屏半径约 55pt，角上按钮的图标中心离角约 17pt，不让一点图标会被圆角切掉；往里让 8pt 刚好让图标完整可见。调试可用 ?nudge=N 改成 N 个 CSS 像素。
    const nq = new URLSearchParams(location.search).get('nudge');
    // 灵动岛在哪一侧(触屏横屏)：window.orientation 90 = 机身顶部朝左 → 岛在左；-90 → 岛在右。?island=left|right 可强制(预览用)。
    // 贴右边的竖列(主页菜单、国家列表)在岛位于右侧时让出 62pt；岛在左侧时右边照常贴边。
    const iq = new URLSearchParams(location.search).get('island');
    const ang = typeof window.orientation === 'number' ? window.orientation : (screen.orientation?.angle ?? 90);
    E.islandSide = !platform.isTouch ? null : (iq === 'left' || iq === 'right') ? iq : (ang === -90 || ang === 270) ? 'right' : 'left';
    E.reserveR = E.islandSide === 'right' ? 62 * dpr / E.view.scale : 0;
    E.reserveL = E.islandSide === 'left' ? 62 * dpr / E.view.scale : 0;
    E.nudge = platform.isTouch ? (nq != null ? Number(nq) || 0 : 0) * dpr / E.view.scale : 0;   // 触屏的角落按钮改用 ui/corner_plate.js 贴合圆角，这里默认不再往里让
  };
  // 逻辑布局区域(安全区内)在页面上的矩形，给需要把 DOM 元素对齐到画布坐标的代码用
  E.logicalRect = () => { const r = cv.getBoundingClientRect(), v = E.view; return { left: r.left + v.ox / v.dpr, top: r.top + v.oy / v.dpr, width: E.W * v.scale / v.dpr, height: E.H * v.scale / v.dpr }; };
  // 贴着逻辑区域边缘的 HUD 页签(资源条、暂停、结束回合…)：把它们最靠边的一列/一行像素向安全区外延伸到屏幕边缘，
  // 页签的底色一直铺到屏幕边(像贴边的标签)，图标和文字仍在安全区内。rect 是逻辑坐标，sides 指它贴着哪些边。
  E.bleed = (r, sides) => {
    const v = E.view; if (!v || !(v.il > 0.5 || v.ir > 0.5 || v.it > 0.5 || v.ib > 0.5)) return;
    const k = v.scale, x0 = Math.round(v.ox + r.x * k), y0 = Math.round(v.oy + r.y * k), w = Math.max(1, Math.round(r.w * k)), h = Math.max(1, Math.round(r.h * k));
    const L = Math.round(v.il), R = Math.round(v.ir), T = Math.round(v.it), B = Math.round(v.ib), c = E.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false;
    let ex0 = x0, ew = w;                                   // 水平延伸后的实际宽度范围(竖向延伸要把它一起带上)
    if (sides.left && L > 0) { c.drawImage(cv, x0, y0, 1, h, x0 - L, y0, L, h); ex0 = x0 - L; ew += L; }
    if (sides.right && R > 0) { c.drawImage(cv, x0 + w - 1, y0, 1, h, x0 + w, y0, R, h); ew += R; }
    if (sides.top && T > 0) c.drawImage(cv, ex0, y0, ew, 1, ex0, y0 - T, ew, T);
    if (sides.bottom && B > 0) c.drawImage(cv, ex0, y0 + h - 1, ew, 1, ex0, y0 + h, ew, B);
    c.restore();
  };
  addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 50)); resize();
  const toV = e => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) * E.view.dpr - E.view.ox) / E.view.scale, y: ((e.clientY - r.top) * E.view.dpr - E.view.oy) / E.view.scale }; };
  const setP = (p, extra) => { Object.assign(E.pointer, p, extra); E.pointerC.x = p.x - E.ox; E.pointerC.y = p.y - E.oy; };
  const live = () => E.scene && !E.busy;
  // While the layout editor is active it owns the LEFT button (and the wheel when something is selected);
  // the RIGHT button then plays the game exactly like a left click would (press, drag, release all go to the scene).
  const tap = () => E.layout.tap;
  let toScene = false;                 // the press in progress belongs to the game (right button in editor mode)
  // Borderless full screen on the first user gesture (a page cannot go full screen by itself). Skipped when it already fills the screen (the app
  // window is started with --start-fullscreen), when the player turned it off, inside the Studio's iframe, or with ?nofs. Tried once per page load,
  // so leaving full screen by hand is respected.
  let fsTried = false;
  const tryFullscreen = () => {
    if (fsTried) return; fsTried = true;
    if (platform.isTouch) return;
    const full = document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches || (innerWidth >= screen.width - 2 && innerHeight >= screen.height - 2);
    if (E.state.autoFullscreen === false || full || window.top !== window || /[?&]nofs\b/.test(location.search)) return;
    try { document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) {}
  };
  // ---- touch: pinch to zoom / two-finger pan, and drag-to-scroll for lists that only knew the mouse wheel ----
  const coarse = platform.isTouch || matchMedia('(pointer: coarse)').matches || /[?&]touch\b/.test(location.search);   // ?touch: legacy touch preview
  E.touchUI = () => coarse || E.pointer.touch;                         // show the on-screen touch controls
  const touches = new Map(); let pinch = null, ts = null, hold = null; // active fingers; the last two-finger state; the one-finger scroll in progress
  const clearHold = () => { if (hold?.timer) clearTimeout(hold.timer); hold = null; };
  const scrollable = () => { const t = live() ? (E.scene.dialog && E.scene.dialog.wheel ? E.scene.dialog : E.scene) : null; return t && t.wheel && !t.ownTouch ? t : null; };
  const twoFingers = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    unlockAudio(); tryFullscreen(); const p = toV(e); setP(p, { down: true, touch: e.pointerType === 'touch' }); E.keyboard = false; try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    toScene = !tap() || e.button === 2;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, p);
      if (touches.size >= 2) {                                          // a second finger: pinch; whatever the first finger had started is cancelled
        clearHold();
        if (!E.pinching) {
          E.pinching = true; ts = null; pinch = twoFingers(); E.pointer.down = false; toScene = false;
          if (live()) { E.scene.pointerCancel && E.scene.pointerCancel(); const dl = E.scene.dialog; if (dl && dl.cancelGesture) dl.cancelGesture(); }
        }
        return;
      }
      if (E.pinching) return;
      ts = { y: p.y, sx: p.x, sy: p.y, acc: 0, moved: false };
      if (platform.isTouch) {
        const id = e.pointerId;
        hold = { id, x: p.x, y: p.y, fired: false, timer: setTimeout(() => {
          if (!hold || hold.id !== id || E.pinching || !toScene || !live() || !E.scene.pointerCancel || E.scene.cmdUI?.box) return;
          hold.fired = true;
          E.scene.pointerCancel();
          const right = Object.assign(E.layout.inputPoint({ x: hold.x, y: hold.y }), { button: 2, pointerType: 'touch' });
          E.scene.pointerDown?.(right); E.scene.pointerUp?.(right);
        }, 450) };
      }
    }
    if (!toScene) return tap().pointerDown(p);
    live() && E.scene.pointerDown && Perf.time('pointerDown', () => E.scene.pointerDown(Object.assign(E.layout.inputPoint(p), { shiftKey:e.shiftKey, ctrlKey:e.ctrlKey, button:e.button, pointerType:e.pointerType })));
  });
  cv.addEventListener('pointermove', e => {
    const p = toV(e); setP(p, { touch: e.pointerType === 'touch' });
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, p);
      if (hold && Math.hypot(p.x - hold.x, p.y - hold.y) > 12) clearHold();
      if (E.pinching) {                                                 // two fingers: zoom by the change of their distance, pan by the change of their centre
        if (touches.size >= 2 && pinch) {
          const n = twoFingers(), t = live() ? (E.scene.dialog && E.scene.dialog.pinch ? E.scene.dialog : E.scene) : null;
          if (t && t.pinch) t.pinch(n.d / pinch.d, n.cx, n.cy, n.cx - pinch.cx, n.cy - pinch.cy);
          pinch = n;
        }
        return;
      }
      if (ts && E.pointer.down) {                                       // one finger dragging a list that has only a wheel handler: scroll it
        const t = scrollable();
        if (!ts.moved && Math.hypot(p.x - ts.sx, p.y - ts.sy) > 12) ts.moved = true;
        if (t && ts.moved) {
          ts.acc += p.y - ts.y; ts.y = p.y;
          while (Math.abs(ts.acc) >= 40) { const s = ts.acc < 0 ? 1 : -1; t.wheel(100 * s); ts.acc += 40 * s; }
          return;
        }
        ts.y = p.y;
      }
    }
    if (tap() && !(toScene && E.pointer.down)) return tap().pointerMove(p);
    live() && E.scene.pointerMove && Perf.time('pointerMove', () => E.scene.pointerMove(E.layout.inputPoint(p)));
  });
  const cancelPointer = () => {
    E.pointer.down = false;
    toScene = false;
    live() && E.scene.pointerCancel && E.scene.pointerCancel();
  };
  cv.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') {
      const held = hold?.id === e.pointerId && hold.fired; clearHold();
      touches.delete(e.pointerId);
      if (E.pinching) { if (touches.size === 0) { E.pinching = false; pinch = null; } E.pointer.down = false; return; }   // the fingers of a pinch never click
      if (held) { E.pointer.down = false; toScene = false; return; }
    }
    // If pointer was released outside browser window, treat as cancel rather than a click
    const bounds = cv.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) {
      cancelPointer();
      return;
    }
    const p = toV(e); setP(p, { down: false });
    if (ts && ts.moved && scrollable()) {                                // a scroll drag ends: no click. (An up far away just resets any pressed button.)
      ts = null; toScene = false; live() && E.scene.pointerUp && E.scene.pointerUp({ x: -9999, y: -9999 }); return;
    }
    ts = null;
    const game = toScene; toScene = false;
    if (tap() && !game) return tap().pointerUp(p);
    live() && E.scene.pointerUp && Perf.time('pointerUp', () => E.scene.pointerUp(Object.assign(E.layout.inputPoint(p), { button:e.button, pointerType:e.pointerType })));
  });
  const dropTouch = e => { clearHold(); touches.delete(e.pointerId); if (!touches.size) { E.pinching = false; pinch = null; ts = null; } };
  cv.addEventListener('pointercancel', e => { dropTouch(e); cancelPointer(); });
  cv.addEventListener('lostpointercapture', e => { if (E.pointer.down) { dropTouch(e); cancelPointer(); } });
  window.addEventListener('blur', cancelPointer);
  // iOS 偶尔吞掉 pointerup/pointercancel(系统手势、边缘滑动、来电/通知、手指在 DOM 浮层上抬起)：touches 里残留“幽灵手指”，
  // E.pinching 一直为 true，之后所有点击/拖动都被当成缩放而失灵。用原生 touch 事件(其 e.touches 是真实手指数)兜底：全部抬起就清空状态(只在 0 根手指时处理，避免和正常 pointerup 抢顺序)。
  const resetTouches = () => { clearHold(); touches.clear(); pinch = null; ts = null; E.pinching = false; cancelPointer(); };
  const syncTouches = e => {
    if (e.touches.length === 0) setTimeout(() => { if (touches.size || E.pinching || E.pointer.down) resetTouches(); }, 0);
  };
  for (const ev of ['touchend', 'touchcancel']) window.addEventListener(ev, syncTouches, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetTouches(); });
  window.addEventListener('pagehide', resetTouches);
  cv.addEventListener('wheel', e => { if (tap() && tap().wheel(e.deltaY)) { e.preventDefault(); return; } live() && E.scene.wheel && Perf.time('wheel', () => E.scene.wheel(e.deltaY)); e.preventDefault(); }, { passive: false });
  addEventListener('keydown', e => {
    unlockAudio(); tryFullscreen();
    if (e.key === 'F2') { e.preventDefault(); if (E.layout.active || E.layout.embedded) E.layout.toggle(); else E.openStudio(); return; }   // F2: studio (or, inside the studio's debug page, start / end a recording)
    if (tap()) { tap().key(e); return; }
    if (live() && E.scene.key) Perf.time('key', () => E.scene.key(e));
  });
  addEventListener('keyup', e => { if (tap() && tap().keyUp) tap().keyUp(e); });

  E.playPlaylist();
  await E.go(initial);
  let last = performance.now();
  const frame = t => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t; E.time += dt;
    const f = E.fade; f.a += Math.sign(f.target - f.a) * Math.min(Math.abs(f.target - f.a), dt / 0.2);
    const v = E.view, insets = v.il > 0.5 || v.ir > 0.5 || v.it > 0.5 || v.ib > 0.5;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (insets) {
      // 触屏有安全区：先整屏透明，只把逻辑区域涂成深色底；场景不裁剪，地图等背景自然画到屏幕边缘，
      // 没画到的边缘稍后用 destination-over 补柔和的底色
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#080503'; ctx.fillRect(v.ox, v.oy, E.W * v.scale, E.H * v.scale);
    } else { ctx.fillStyle = '#080503'; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    ctx.save(); if (!insets) { ctx.beginPath(); ctx.rect(0, 0, E.W, E.H); ctx.clip(); }
    E.layout.refresh();
    if (E.layout.on) E.layout.beginFrame();
    if (E.scene) {
      const a = performance.now(); E.scene.update && E.scene.update(dt);
      const b = performance.now();
      const fogDraw = !!E.scene.game?.fogOfWar;
      if (fogDraw) beginVisibilityFrame();
      try { E.scene.draw(); } finally { if (fogDraw) endVisibilityFrame(); }
      Perf.frame(t, b - a, performance.now() - b);
    }
    if (E.layout.on) E.layout.drawAdded();
    if (E.layout.drawOverlay) E.layout.drawOverlay(ctx);
    if (!E.noFade && f.a > 0.001) { ctx.fillStyle = `rgba(0,0,0,${f.a})`; ctx.fillRect(0, 0, E.W, E.H); }
    ctx.restore();
    // 安全区之外的边缘(刘海/圆角区)：取紧贴安全区边界的一段画面，缩成很小的图再拉伸铺开，得到和背景颜色衔接的柔和过渡
    // (直接拉伸最外一列会出现条纹，镜像会把贴边的按钮翻过来出现重影)
    if (insets) {
      const cw = cv.width, ch = cv.height, L = Math.round(v.il), R = Math.round(v.ir), T = Math.round(v.it), B = Math.round(v.ib);
      const band = Math.round(48 * v.dpr);
      const tmp = E._edgeTmp || (E._edgeTmp = document.createElement('canvas')), t = tmp.getContext('2d');
      const soft = (sx, sy, sw, sh, dx, dy, dw, dh) => {
        tmp.width = 4; tmp.height = 4; t.imageSmoothingEnabled = true; t.imageSmoothingQuality = 'high';
        // 分两级缩小，平均得更均匀
        tmp.width = Math.max(2, Math.round(dw > dh ? 24 : 2)); tmp.height = Math.max(2, Math.round(dw > dh ? 2 : 24));
        t.drawImage(cv, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.globalCompositeOperation = 'destination-over';   // 只补还没被画到的(透明)像素
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, dx, dy, dw, dh);
        ctx.globalCompositeOperation = 'source-over';
      };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (L > 0) soft(L, T, band, ch - T - B, 0, 0, L, ch);
      if (R > 0) soft(cw - R - band, T, band, ch - T - B, cw - R, 0, R, ch);
      if (T > 0) soft(0, T, cw, band, 0, 0, cw, T);
      if (B > 0) soft(0, ch - B - band, cw, band, 0, ch - B, cw, B);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};
