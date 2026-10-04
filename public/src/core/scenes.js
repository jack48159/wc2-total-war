// Scene manager. Scenes never import each other: they navigate by registered name, E.go('campaign'),
// which keeps the import graph acyclic and lets new scenes be added by one line in scenes/index.js.
import { E } from './kernel.js';

let token = 0;

// table: { name: SceneClass }. Later registrations replace earlier ones (handy for mods / experiments).
E.registerScenes = table => Object.assign(E.scenes, table);

// target: a registered name, a Scene class, or a ready-made scene instance.
E.go = async (target, ...args) => {
  E.loading++; try { return await go(target, ...args); } finally { E.loading--; }
};

const instantiate = (target, args) => {
  if (typeof target === 'string') {
    const S = E.scenes[target]; if (!S) throw new Error('unknown scene: ' + target);
    return new S(...args);
  }
  return typeof target === 'function' ? new target(...args) : target;
};

const go = async (target, ...args) => {
  const mine = ++token;
  if (E.scene && !E.noFade) { E.fade.target = 1; E.busy = true; await E.sleep(210); }
  if (mine !== token) return;
  if (E.scene && E.scene.dispose) E.scene.dispose();
  const next = instantiate(target, args);
  E.focus = null; E.pointer.down = false;
  if (next.load) await next.load();
  if (mine !== token) return;
  E.scene = next; E.fade.target = 0; E.busy = false;
  try { next.onShow?.(); } catch (e) { console.error('onShow', e); }   // 场景实例被(重新)显示时的钩子：复用的实例不会重新 init
  try { history.replaceState(null, '', '#' + (next.route || '')); } catch (e) {}
};
