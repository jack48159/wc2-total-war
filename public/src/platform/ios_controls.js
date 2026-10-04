import { platform } from './detect.js';

// DOM controls are deliberately above the shared canvas, so every scene keeps its existing drawing code.
export function installIosControls(E) {
  if (!platform.isTouch) return;
  const root = document.createElement('nav'); root.id = 'ios-controls'; root.setAttribute('aria-label', '触屏操作');
  const hint = document.createElement('span'); hint.className = 'ios-hint';
  const actions = document.createElement('div'); actions.className = 'ios-actions';
  root.append(hint, actions); document.body.append(root);
  const context = document.createElement('div'); context.id = 'ios-context'; context.hidden = true;
  document.body.append(context);
  const key = (value, extras = {}) => E.scene?.key?.({ key:value, repeat:false, ctrlKey:false, metaKey:false, altKey:false, shiftKey:false, target:document.body, preventDefault(){}, ...extras });
  const button = (label, title, fn, pressed = false) => {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.title = title;
    if (pressed) el.setAttribute('aria-pressed', 'true');
    el.addEventListener('click', fn); actions.append(el);
  };
  let signature = '';
  let menuSignature = '';
  const update = () => {
    const scene = E.scene, battle = scene?.cam && scene?.cmdUI;
    const menu = scene?.portraitMenu?.menu;
    const nextMenu = menu && !scene?.dialog ? `${menu.level}:${menu.id}:${menu.sub}` : '';
    if (nextMenu !== menuSignature) {
      menuSignature = nextMenu;
      context.replaceChildren();
      context.hidden = !nextMenu;
      if (nextMenu) {
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭菜单';
        close.addEventListener('click', () => { scene.portraitMenu.menu = null; }); context.append(close);
        for (const choice of scene.portraitMenu.menuChoices()) {
          const el = document.createElement('button'); el.type = 'button'; el.textContent = choice.label;
          el.disabled = !choice.enabled; el.title = choice.reason || '';
          el.addEventListener('click', () => choice.action()); context.append(el);
        }
      }
    }
    const drawing = !!scene?.orderDrawing && !scene?.dialog && !scene?.opening;
    if (!drawing && scene?.touchDrawMode) scene.touchDrawMode = false;
        const next = [scene?.constructor?.name,battle,drawing,scene?.touchDrawMode,!!scene?.dialog,!!scene?.opening].join(':');
    if (next === signature) return;
    signature = next; actions.replaceChildren(); root.hidden = !scene || !!scene.root?.isConnected;   // DOM 页面(联机、指挥官名册…)自己带返回按钮，不再叠一个
    // 只保留画面里没有的触屏辅助：画线辅助(画线待命/完成/撤销)。返回、缩放都已有(画面自带返回、双指缩放)，不再重复。菜单/编组/政务/卡牌/回合/各场景按钮画面里本来就有，不再重复。
    hint.textContent = drawing ? (scene.touchDrawMode ? '画线：拖动添加路径点' : '画线待命：先点「画线」') : '';
    hint.hidden = !hint.textContent;
    if (battle && !scene.dialog && !scene.opening) {
      if (drawing) {
        button(scene.touchDrawMode ? '退出画线' : '画线', '切换画线手势', () => { scene.touchDrawMode = !scene.touchDrawMode; signature = ''; }, scene.touchDrawMode);
        button('完成', '完成轴线', () => scene.finishOrderAxis());
        button('撤销', '撤销一点', () => scene.undoOrderOrDrawing());
      }
    }
    if (!actions.childElementCount && !hint.textContent) root.hidden = true;   // 没有按钮就整条不显示
  };
  const frame = () => { update(); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
}
