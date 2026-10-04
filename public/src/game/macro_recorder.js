// 阵势录制/重放：把玩家亲手下的命令(移动、攻击、出牌、编组、指令…)按回合录下来，可命名，存在本地；
// 同一关卡可以有多条录制。下次开这个关卡、同一个国家，点“重放”从列表里选一条，就按顺序自动重做该条录制里“当前回合”的操作，
// 失败的步骤(单位不在、钱不够…)会跳过并汇总。
// 不录：结束回合、AI 发出的命令、常驻指令自动执行产生的命令、重放自己产生的命令。
const STORE = 'wc2_macros_v2', OLD_STORE = 'wc2_macros_v1';
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const load = () => {
  const data = read(STORE) || {};
  // 旧版本(每个关卡+国家只存一条)：迁移成列表
  const old = read(OLD_STORE);
  if (old && typeof old === 'object' && !data.__migrated) {
    for (const [k, v] of Object.entries(old)) {
      const [stage, player] = k.split('|');
      if (v?.cmds?.length) (data[stage] ||= []).push({ id: 'old' + (v.at || 0), name: '旧录制', player, at: v.at || 0, cmds: v.cmds });
    }
    data.__migrated = true; save(data);
  }
  return data;
};
const save = data => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) {} };
const summarize = rec => { const r = rec.cmds.map(c => c.round); return { count: rec.cmds.length, from: Math.min(...r), to: Math.max(...r) }; };

export class MacroRecorder {
  constructor(game) {
    this.game = game; this.recording = false; this.playing = false; this.cmds = []; this.autoDepth = 0; this.timer = 0;
    const apply = game.apply.bind(game), auto = game.executeAutoOrders?.bind(game);
    game.apply = cmd => {
      const result = apply(cmd);
      if (result?.ok && this.recording && this.human(cmd)) this.cmds.push({ round: game.round, cmd: JSON.parse(JSON.stringify(cmd)) });
      return result;
    };
    if (auto) game.executeAutoOrders = (...args) => { this.autoDepth++; try { return auto(...args); } finally { this.autoDepth--; } };
  }
  human(cmd) {
    const g = this.game;
    return !this.playing && !this.autoDepth && cmd.type !== 'endTurn' && !cmd.aiIssued && g.activeCountry === g.player && (!cmd.country || cmd.country === g.player);
  }
  // 本关卡、当前国家的所有录制，新的在前
  list() { return (load()[this.game.name] || []).filter(r => r.player === this.game.player).sort((a, b) => b.at - a.at); }
  get(id) { return this.list().find(r => r.id === id) || null; }
  stepsThisRound(rec) { return rec.cmds.filter(c => c.round === this.game.round).length; }
  summary(rec) { return summarize(rec); }
  count() { return this.recording ? this.cmds.length : this.list().length; }
  defaultName() { return `阵势 ${this.list().length + 1}`; }
  start() { this.cmds = []; this.recording = true; }
  // 结束录制并按 name 保存；没录到任何操作时不保存
  stop(name) {
    this.recording = false;
    if (!this.cmds.length) return { saved: false, count: 0 };
    const data = load(), key = this.game.name;
    const rec = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: (name || '').trim().slice(0, 24) || this.defaultName(), player: this.game.player, at: Date.now(), cmds: this.cmds };
    (data[key] ||= []).push(rec); save(data);
    this.cmds = []; return { saved: true, name: rec.name, ...summarize(rec) };
  }
  remove(id) { const data = load(), key = this.game.name; data[key] = (data[key] || []).filter(r => r.id !== id); save(data); }
  rename(id, name) { const data = load(), r = (data[this.game.name] || []).find(x => x.id === id); if (r && name?.trim()) { r.name = name.trim().slice(0, 24); save(data); } }
  // 重放某条录制里当前回合的操作：每步间隔 stepMs，onStep(i, total, ok) 刷新界面，onDone(summary) 汇总
  play(id, { stepMs = 380, onStep, onDone } = {}) {
    const rec = this.get(id); if (!rec) return { started: false, reason: '找不到这条录制' };
    const round = this.game.round, list = rec.cmds.filter(c => c.round === round);
    if (!list.length) return { started: false, reason: `「${rec.name}」里没有第 ${round} 回合的操作` };
    this.playing = true;
    const summary = { name: rec.name, total: list.length, ok: 0, failed: [] };
    let i = 0;
    const step = () => {
      if (!this.playing) return;
      if (i >= list.length) { this.playing = false; onDone?.(summary); return; }
      const cmd = JSON.parse(JSON.stringify(list[i].cmd)), r = this.game.apply(cmd);
      if (r?.ok) summary.ok++; else summary.failed.push({ type: cmd.type, reason: r?.reason || '失败' });
      i++;
      onStep?.(i, list.length, !!r?.ok);
      this.timer = setTimeout(step, stepMs);
    };
    step();
    return { started: true, total: list.length, name: rec.name };
  }
  cancel() { this.playing = false; clearTimeout(this.timer); }
}
