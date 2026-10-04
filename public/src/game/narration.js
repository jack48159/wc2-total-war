// 看海模式的"战报旁白"：每个回合开始时弹出电影字幕，并用系统语音朗读(译制片式的庄重旁白)。
// 文稿由 agent 在对局结束后写入对战桥(wc2_bridge_narrate)，这里按对局 ID 取回；也可放静态文件 data/narration/<gameId>.json。
// 配音用浏览器自带的 speechSynthesis(iOS/Windows 都有中文语音)，没有语音时按文字长度估算停留时间，字幕照常显示。
// 时间源：默认真实时钟；录制动画时由录制脚本改成引擎的帧时钟，保证字幕停留时间和视频时间一致
export const clock = { now: () => performance.now() };
const KEY_VOICE = 'wc2_narr_voice', KEY_SUB = 'wc2_narr_sub';
const read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };

// 偏好的中文男声(低沉)/女声名称片段；找不到就用任意 zh 语音
const MALE = /yunxi|yunyang|yunjian|kangkang|yaoyao|male|liang|sin-ji|li-mu|reed|ting-ting-male/i;
const FEMALE = /xiaoxiao|huihui|tingting|ting-ting|mei-jia|female|yaoyao|xiaoyi/i;
let voicesReady = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(resolve => {
    const get = () => speechSynthesis.getVoices();
    if (get().length) return resolve(get());
    const done = () => resolve(get());
    speechSynthesis.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}
export function pickVoice(voices, gender = 'male') {
  const zh = voices.filter(v => /^zh/i.test(v.lang) || /chinese|中文|普通话/i.test(v.name));
  if (!zh.length) return null;
  const want = gender === 'female' ? FEMALE : MALE;
  return zh.find(v => want.test(v.name) && /cn|zh-cn|mainland/i.test(v.lang + v.name)) || zh.find(v => want.test(v.name)) || zh.find(v => /zh-cn/i.test(v.lang)) || zh[0];
}

export class Narrator {
  constructor() {
    this.doc = null; this.loading = null;
    this.voiceOn = read(KEY_VOICE, true); this.subOn = read(KEY_SUB, true);
    this.cue = null;          // 当前显示的 { title, text, born, duration, speaking }
    this.shown = new Set();   // 已播过的 key，回放 seek 回去再走过时可重播
    this.token = 0; this.queue = [];
  }
  // 模式：0=配音+字幕 1=仅字幕 2=关闭；切换按钮循环
  get mode() { return this.voiceOn && this.subOn ? 0 : this.subOn ? 1 : 2; }
  cycleMode() { const m = (this.mode + 1) % 3; this.setVoice(m === 0); this.setSub(m !== 2); if (m === 2) this.queue = []; return m; }
  enqueue(key) { if (this.entry(key) && !this.shown.has(String(key)) && !this.queue.includes(key)) this.queue.push(key); }
  // 每帧调用：旁白还在读就返回 true(回放暂停)；读完了就取队列里的下一条
  tick(now = clock.now()) {
    if (this.mode === 2) return false;
    if (this.holding(now)) return true;
    while (this.queue.length) { const k = this.queue.shift(); if (this.play(k)) return true; }
    return false;
  }
  get available() { return !!this.doc && ((this.doc.items?.length || 0) > 0 || !!this.doc.intro || !!this.doc.outro); }
  // 取回战报：先问桥(gameId)，再试静态文件
  load(gameId, bridgeUrl) {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const tries = [];
      if (bridgeUrl && gameId) tries.push(`${String(bridgeUrl).replace(/\/$/, '')}/bridge/narration?gameId=${encodeURIComponent(gameId)}`);
      if (gameId) tries.push(`data/narration/${encodeURIComponent(gameId)}.json`);
      for (const url of tries) {
        try { const r = await fetch(url); if (r.ok) { const d = await r.json(); if (d && (d.items || d.intro || d.outro)) { this.doc = d; break; } } } catch (e) {}
      }
      return this.doc;
    })();
    return this.loading;
  }
  setVoice(on) { this.voiceOn = !!on; write(KEY_VOICE, this.voiceOn); if (!on) this.silence(); }
  setSub(on) { this.subOn = !!on; write(KEY_SUB, this.subOn); }
  entry(key) {
    if (!this.doc) return null;
    if (key === 'intro') return this.doc.intro || null;
    if (key === 'outro') return this.doc.outro || null;
    const n = Number(key);
    return (this.doc.items || []).find(i => i.round === n) || null;
  }
  // 触发某个回合/开场/收尾的旁白；返回 true 表示有内容
  play(key, { force = false } = {}) {
    const e = this.entry(key); if (!e) return false;
    if (!force && this.shown.has(String(key))) return false;
    this.shown.add(String(key));
    const text = e.text, now = clock.now();
    // 估算朗读时长：中文约 4.2 字/秒(旁白较缓)，至少 4 秒
    const est = Math.max(4, text.length / (4.2 * (this.doc.voice?.rate || 0.92)));
    this.cue = { title: e.title || '', text, born: now, duration: est, speaking: false, key };
    this.speak(text);
    return true;
  }
  async speak(text) {
    const my = ++this.token;
    this.silence(false);
    if (!this.voiceOn || !('speechSynthesis' in window)) return;
    const voices = await loadVoices();
    if (my !== this.token || !this.voiceOn) return;
    try {
      const u = new SpeechSynthesisUtterance(text), cfg = this.doc?.voice || {};
      const v = pickVoice(voices, cfg.gender || 'male'); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'zh-CN';
      u.rate = Math.min(1.4, Math.max(0.6, cfg.rate || 0.92)); u.pitch = Math.min(1.6, Math.max(0.3, cfg.pitch || 0.8));
      if (this.cue) this.cue.speaking = true;
      const done = () => { if (my === this.token && this.cue) { this.cue.speaking = false; this.cue.spokeAt = clock.now(); } };
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } catch (e) { if (this.cue) this.cue.speaking = false; }
  }
  silence(clearCue = true) {
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
    if (clearCue) { this.token++; this.cue = null; }
  }
  // 播放是否应当暂停等旁白：配音开启并且正在朗读，或字幕还没显示满最短时间
  holding(now = clock.now()) {
    const c = this.cue; if (!c) return false;
    const t = (now - c.born) / 1000;
    if (this.voiceOn && 'speechSynthesis' in window) return c.speaking || t < 1.2;     // 语音：读完才继续(略留一点起头时间)
    return this.subOn && t < c.duration;                                              // 无语音：字幕停留估算时长
  }
  // 字幕在读完后再停留 1.5 秒然后淡出
  visible(now = clock.now()) {
    const c = this.cue; if (!c || !this.subOn) return null;
    const t = (now - c.born) / 1000;
    if (c.speaking || t < 1.2) return { ...c, alpha: 1, reveal: 1 };
    const end = c.spokeAt ? (now - c.spokeAt) / 1000 : t - c.duration;
    if (end > 1.6) { return null; }
    return { ...c, alpha: end < 0 ? 1 : Math.max(0, 1 - Math.max(0, end - 0.6) / 1.0), reveal: 1 };
  }
  dispose() { this.silence(); this.shown.clear(); this.queue = []; }
}
