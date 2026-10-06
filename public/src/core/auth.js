import { platform } from '../platform/detect.js';
import { localDataRequest, localRead, localWrite } from './local_data.js';
const TOKEN_KEY = 'wc2.auth.token';
export const GAME_ACCESS_KEY = 'DUA5DN8AG4A';
// Local UI can use the authoritative public game server. Override this key for a
// different deployment without changing the source tree.
export const apiOrigin = () => window.WC2_CONFIG?.apiOrigin || localStorage.getItem('wc2.api.origin') ||
  'http://208.87.207.49:8643';
// 页面是 https、公网服务器是 http 时，浏览器会拦截混合内容：改走本机服务的同源转发 /remote/(见 server.js)
const viaLocalProxy = () => { try { return location.protocol === 'https:' && /^http:/.test(apiOrigin()) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname); } catch { return false; } };
export const apiUrl = path => viaLocalProxy() ? new URL('/remote' + path, location.origin).href : new URL(path, apiOrigin()).href;
export const authToken = () => localStorage.getItem(TOKEN_KEY);
export const authHeaders = () => ({ Authorization:`Bearer ${authToken() || ''}`, 'Content-Type':'application/json', 'X-Game-Access': GAME_ACCESS_KEY, 'X-WC2-Version': window.WC2_CONFIG?.version||'' });
export const authFetch = (url, options = {}) => ['/api/profile', '/api/saves'].includes(url)
  ? localDataRequest(url, options)
  : platform.fetchRemote(apiUrl(url), {...options,headers:{...authHeaders(),...(options.headers || {})}});
export async function logout() {
  try { await authFetch('/api/auth/logout',{method:'POST'}); } catch {}
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}

export async function requireLogin() {
  let user = await localRead('account');
  if (!user) {
    user = { id: 'local-' + crypto.randomUUID(), username: '指挥官', local: true };
    await localWrite('account', user);
  }
  return user;
}

// Online rooms authenticate independently; local profile/saves never use this token.
export async function requireNetworkLogin() {
  const token = authToken();
  if (token) {
    try { const r = await authFetch('/api/auth/me'); if (r.ok) { const {user} = await r.json(); return user; } } catch {}
    localStorage.removeItem(TOKEN_KEY);
  }
  return new Promise(resolve => {
    const screen = document.createElement('div'); screen.className = 'wc2-auth-screen';
    screen.innerHTML = `<div class="wc2-auth-art wc2-auth-art-left" aria-hidden="true"></div><div class="wc2-auth-art wc2-auth-art-right" aria-hidden="true"></div><main class="wc2-auth-panel"><div class="wc2-auth-kicker">HIGH COMMAND · PERSONNEL FILE</div><div class="wc2-auth-emblem" aria-hidden="true">★</div><h1>世界征服者</h1><div class="wc2-auth-subtitle">指挥部 · 身份登记</div><div class="wc2-auth-rule"></div><form class="wc2-login"><label>用户名<input name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="输入用户名"></label><label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="输入密码"></label><p class="wc2-login-error" role="alert"></p><button class="wc2-auth-primary" type="submit" data-mode="login">登录指挥系统</button><button class="wc2-auth-secondary" type="submit" data-mode="register">注册报到</button></form></main>`;
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = 'src/core/auth.css';
    document.head.appendChild(style); document.body.appendChild(screen);
    const form = screen.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const mode = event.submitter?.dataset.mode || 'login';
      const username = form.elements.username.value.trim(), password = form.elements.password.value;
      const error = screen.querySelector('.wc2-login-error'); error.textContent = '';
      try {
        const r = await platform.fetchRemote(apiUrl(`/api/auth/${mode}`),{method:'POST',headers:{'Content-Type':'application/json','X-Game-Access':GAME_ACCESS_KEY},body:JSON.stringify({username,password})});
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '登录失败');
        localStorage.setItem(TOKEN_KEY,data.token); screen.remove(); style.remove(); resolve(data.user);
      } catch (e) { error.textContent = e.message; }
    });
  });
}
