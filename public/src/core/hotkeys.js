// User-configurable keyboard shortcuts (Options > 快捷键). Each action has a default key; E.state.hotkeys holds the user's overrides
// (action id -> key name, '' = unbound). A key name is the lower-cased key with optional "ctrl+" / "alt+" (and "shift+" for non-printable
// keys), e.g. "v", "ctrl+s", "Escape", "shift+ArrowUp". The scenes ask E.hotkeys.match(keyboardEvent) which action (if any) the key is bound to.
import { E } from './kernel.js';

// scope: where the action works (only 'battle' for now; the list in Options shows all of them)
export const HOTKEY_ACTIONS = [
  { id: 'pause', name: '暂停菜单 / 取消选择', def: 'Escape', scope: 'battle' },
  { id: 'formGroup', name: '集团军编制', def: 'b', scope: 'battle' },
  { id: 'zhengwu', name: '政务', def: 'g', scope: 'battle' },
  { id: 'toggle3d', name: '切换 2D / 3D 模式', def: 'v', scope: 'battle' },
  { id: 'cardShop', name: '打开卡片商店', def: 'c', scope: 'battle' },
  { id: 'endTurn', name: '结束回合', def: '', scope: 'battle' },
  { id: 'decorate', name: '摆件模式', def: '', scope: 'battle' },
  { id: 'save', name: '存档', def: '', scope: 'battle' },
  { id: 'options', name: '打开设置', def: '', scope: 'battle' },
  { id: 'photo', name: '摄影模式', def: '', scope: 'battle' },
  { id: 'perfPanel', name: '性能面板', def: 'p', scope: 'battle' },
  { id: 'zoomIn', name: '放大地图', def: '=', scope: 'battle' },
  { id: 'zoomOut', name: '缩小地图', def: '-', scope: 'battle' },
];

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
const PRETTY = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', space: '空格', Enter: '回车', Tab: 'Tab', Backspace: '退格', Delete: 'Delete', '=': '= / +' };

export const Hotkeys = {
  actions: HOTKEY_ACTIONS,
  // key name of a keyboard event, or null for a bare modifier key
  name(e) {
    if (MODIFIERS.has(e.key)) return null;
    let k = e.key === ' ' ? 'space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '+') k = '=';                                          // + is shift+= on most keyboards: the same physical key
    return (e.ctrlKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey && k.length > 1 ? 'shift+' : '') + k;
  },
  bindings() { return E.state.hotkeys || (E.state.hotkeys = {}); },
  of(id) { const b = this.bindings()[id], a = HOTKEY_ACTIONS.find(x => x.id === id); return b !== undefined ? b : a ? a.def : ''; },
  // the action id a keyboard event is bound to, or null
  match(e) {
    const k = this.name(e); if (!k) return null;
    const a = HOTKEY_ACTIONS.find(x => this.of(x.id) === k);
    return a ? a.id : null;
  },
  // bind `key` to `id`; another action that had the key loses it. Returns that action (or null).
  set(id, key) {
    let taken = null;
    if (key) for (const a of HOTKEY_ACTIONS) if (a.id !== id && this.of(a.id) === key) { this.bindings()[a.id] = ''; taken = a; }
    this.bindings()[id] = key; E.saveState(); return taken;
  },
  reset() { E.state.hotkeys = {}; E.saveState(); },
  pretty(key) {
    if (!key) return '未设置';
    return key.split('+').map(p => PRETTY[p] || (p.length === 1 ? p.toUpperCase() : p)).join(' + ');
  },
};
E.hotkeys = Hotkeys;
