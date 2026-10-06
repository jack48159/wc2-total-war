import { E } from './kernel.js';
import { platform } from '../platform/detect.js';
const URL = 'https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com/updates/stable.json';
const SPKI = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtwfLjT9ZSRBF0haS4Kl6H8VsYtecwjFp6xC1WkpHYxBRiPCWWOBATugSDK6Y/nIMb+6wdt60i2xkYbN8E6I7MOBGzvTquoqMLwQ7vTgTRktMU3MaDq4zeSWfXGqkJiVuvBMJjQ0R5x/6SknPsIwW/HolFAkiRgRyLx4LF5e9JpRlQg9pTw3pfLOMtnAFq6X4zfN4b9Ut+crd+wCz72VZwZ4kDEa+SVbkY/mj05hPJR5WxVzQKY9Py/vUvIKIwxLQGpHBkwqOWp/7ON2r4GM2HUspULeTw/ItQqCalKFt8MSAu2Lww/wVhL2zKbQZNKZq3DOVx0hgJ7cRRU+MgddTWQIDAQAB';
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const home = () => (E.scene?.route === 'home' || E.scene?.constructor?.name === 'Home') && !E.busy;
let banner, checkAt = 0, checking = false;
function adapter() {
  if (!window.WC2_CONFIG?.updateSupport || (platform.id === 'ios' && platform.isPackaged && !window.WC2_CONFIG?.iosUpdateSupport)) return null;
  if (platform.isPackaged) {
    const cap = window.Capacitor;
    // iOS injects plugin methods directly; prefer these over an optional JS proxy.
    const injected = cap?.Plugins?.Wc2Updater;
    if (injected?.check) return injected;
    if (cap?.nativePromise && cap.PluginHeaders?.some(p => p.name === 'Wc2Updater')) {
      return Object.fromEntries(['check','ready','status','prepare','activate'].map(name => [name, () => cap.nativePromise('Wc2Updater', name, {})]));
    }
    return cap?.registerPlugin?.('Wc2Updater') || injected || null;
  }
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return null;
  const call = async (name, method = 'POST') => {
    const response = await fetch('/api/update/' + name, { method, headers: { 'X-WC2-Update': '1' } });
    if (!response.ok) throw Error('当前安装版不支持热更新，请下载安装新版');
    const data = await response.json(); if (data.error) throw Error(data.error); return data;
  };
  return { ready: () => call('ready'), status: () => call('status', 'GET'), prepare: () => call('prepare'), activate: () => call('activate') };
}
export const Updates = {
  hide() { banner?.remove(); banner = null; },
  async ready() { try { await adapter()?.ready(); } catch {} },
  notify(message) {
    this.hide();
    banner = document.createElement('aside');
    Object.assign(banner.style, {position:'fixed',left:'16px',bottom:'20px',zIndex:10000,maxWidth:'85vw',padding:'16px',background:'#eee7d6',color:'#302518',font:'14px/1.5 sans-serif'});
    const text = document.createElement('span'); text.textContent = message;
    const close = document.createElement('button'); close.textContent = '\u5173\u95ed'; close.style.marginLeft = '12px'; close.onclick = () => this.hide();
    banner.append(text, close); document.body.append(banner);
  },
  async check({force = false} = {}) {
    if (!window.WC2_CONFIG?.updateSupport || (platform.id === 'ios' && platform.isPackaged && !window.WC2_CONFIG?.iosUpdateSupport)) {
      if (force) this.notify(`当前页面 ${window.WC2_CONFIG?.version || '未知版本'} 未启用热更新。可能加载了旧缓存，请使用修复后的 iOS 启动入口。`);
      return;
    }
    if (!force && Date.now() - checkAt < 60000) return;
    if (checking) {
      if (force) this.notify('\u6b63\u5728\u68c0\u67e5\u66f4\u65b0\uff0c\u8bf7\u7a0d\u5019...');
      return;
    }
    checking = true; checkAt = Date.now();
    try {
      if (force) this.notify('\u6b63\u5728\u68c0\u67e5\u66f4\u65b0...');
      let m;
      if (platform.id === 'ios' && platform.isPackaged) {
        const native = adapter();
        if (!native?.check) throw Error('\u9700\u8981\u5b89\u88c5\u4fee\u590d\u66f4\u65b0\u5165\u53e3\u7684 IPA');
        let timeout;
        try {
          m = await Promise.race([native.check(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error('\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5')), 20000);
          })]);
        } finally { clearTimeout(timeout); }
        if (!m.verified) throw Error('Invalid update signature');
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let envelope;
        try {
          const response = await fetch(URL, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw Error('Update server: ' + response.status);
          envelope = await response.json();
        } finally { clearTimeout(timeout); }
        const payload = bytes(envelope.payload);
        const key = await crypto.subtle.importKey('spki', bytes(SPKI), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(envelope.signature), payload)) throw Error('Invalid update signature');
        m = JSON.parse(new TextDecoder().decode(payload));
      }
      if (!/^\d{14}$/.test(m.release)) throw Error('Invalid update release');
      if (m.release <= (window.WC2_CONFIG.release || '')) {
        if (force) this.notify('\u5df2\u662f\u6700\u65b0\u7248\u672c ' + (window.WC2_CONFIG.version || ''));
        return;
      }
      if (!home()) return;
      this.hide();
      banner = document.createElement('aside');
      Object.assign(banner.style, { position: 'fixed', left: '16px', bottom: '20px', zIndex: 50, maxWidth: 'min(410px,85vw)', padding: '16px', background: '#eee7d6', color: '#302518', border: '1px solid #987c45', borderRadius: '8px', font: '14px/1.5 sans-serif', boxShadow: '0 4px 20px #0008' });
      const title = document.createElement('strong'); title.textContent = `发现更新 ${m.version || m.release}`;
      const detail = document.createElement('p'); detail.textContent = m.notes || '有新的游戏更新。';
      const action = document.createElement('button'); action.textContent = m.shell > 1 ? '下载新版安装包' : adapter() ? '下载更新' : '刷新更新';
      const later = document.createElement('button'); later.textContent = '稍后'; later.style.marginLeft = '12px'; later.onclick = () => this.hide();
      banner.append(title, detail, action, later); document.body.append(banner);
      action.onclick = async () => {
        if (!home()) return;
        if (m.shell > 1) { window.open('https://github.com/jack48159/wc2-total-war/releases', '_blank'); return; }
        const native = adapter();
        if (!native) { location.reload(); return; }
        action.disabled = true;
        try {
          let status = await native.status();
          if (status.ready !== m.release) await native.prepare();
          do {
            await new Promise(resolve => setTimeout(resolve, 700)); status = await native.status();
            detail.textContent = `正在准备更新 ${status.done || 0}/${status.total || 0}，新下载 ${((status.downloaded || 0) / 1048576).toFixed(1)} MB。可继续游戏，回到首页后再切换。`;
          } while (status.running);
          if (status.error) throw Error(status.error);
          if (!status.ready) throw Error('更新尚未准备完成');
          action.disabled = false; action.textContent = '重启界面并应用'; detail.textContent = '更新已校验完成。应用后会重新打开游戏界面，存档保持不变。';
          action.onclick = async () => { if (!home()) return; action.disabled = true; try { await native.activate(); if (!platform.isPackaged) location.reload(); } catch (e) { detail.textContent = e.message; action.disabled = false; } };
        } catch (e) { detail.textContent = e.message + '，当前版本仍可使用。'; action.disabled = false; }
      };
    } catch (error) { console.warn("Update check failed", error); if (force || home()) this.notify(error.message || "Update check failed"); } finally { checking = false; }
  }
};
