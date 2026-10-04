// Device-local IndexedDB: 30 manual slots plus an independent automatic slot.
import { authFetch } from '../core/auth.js';
let cached = null;
export const SLOT_COUNT = 30;

export const SaveStore = {
  async writeAutosave(game) {
    const previous = this.load();
    const autosave = { name: '自动存档', snap: game.snapshot(), time: Date.now(), stage: game.name,
      flag: game.playerInfo.flag, title: game.info?.name || '' };
    const data = { ...previous, autosave };
    if (!await this.save(data)) throw new Error('自动存档写入失败');
  },
  async preload() {
    const response = await authFetch('/api/saves');
    if (!response.ok) throw new Error('无法读取当前用户的游戏存档');
    const data = await response.json();
    cached = data && Array.isArray(data.order) && data.order.length === SLOT_COUNT ? data : { order:Array.from({length:SLOT_COUNT},(_,i)=>i),slots:{} };
  },
  load() {
    return cached || { order: Array.from({ length: SLOT_COUNT }, (_, i) => i), slots: {} };
  },
  async save(o) {
    const previous = cached; cached = o;
    try {
      const response = await authFetch('/api/saves', { method: 'POST', body: JSON.stringify(o) });
      if (!response.ok) throw new Error('本地存储写入失败');
      return true;
    } catch (error) {
      if (cached === o) cached = previous;
      console.error('游戏存档写入失败', error); return false;
    }
  },
};
