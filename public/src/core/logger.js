/**
 * Global Frontend Logger & Diagnostics for WC2 Remake
 * 
 * 作用：
 * 1. 严格仅在通过启动参数指定了 debug 模式时开启 (?debug 或 ?debug=1)
 * 2. 不支持 localStorage 或运行时动态切换，严格受控于启动传参
 * 3. 非 Debug 模式下完全静默，不拦截、不打印、不上报
 */

export function isDebugMode() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('debug') && q.get('debug') !== '0' && q.get('debug') !== 'false';
  } catch (e) {
    return false;
  }
}

const logQueue = [];
let flushTimer = null;

function sendLogs() {
  if (window.WC2_CONFIG?.staticWeb) return;
  if (!isDebugMode() || logQueue.length === 0) return;
  const batch = logQueue.splice(0, logQueue.length);
  fetch('/api/debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch)
  }).catch(() => {});
}

function queueLog(level, tag, message, extra = null) {
  if (!isDebugMode()) return;

  const entry = {
    time: new Date().toISOString(),
    ms: performance.now().toFixed(2),
    level,
    tag,
    message: typeof message === 'object' ? JSON.stringify(message) : String(message),
    extra
  };
  
  // 本地控制台输出
  const prefix = `[${entry.ms}ms][${tag}]`;
  if (level === 'ERROR') {
    console.error(prefix, message, extra || '');
  } else if (level === 'WARN') {
    console.warn(prefix, message, extra || '');
  } else {
    console.log(prefix, message, extra || '');
  }

  logQueue.push(entry);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      sendLogs();
    }, 200);
  }

  // 严重错误仅在 debug 模式下显式提示
  if (level === 'ERROR') {
    showErrorOverlay(tag, entry.message);
  }
}

function showErrorOverlay(tag, msg) {
  if (!isDebugMode()) return;
  let box = document.getElementById('debug-error-overlay');
  if (!box) {
    box = document.createElement('div');
    box.id = 'debug-error-overlay';
    box.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;max-height:200px;overflow-y:auto;background:rgba(180,0,0,0.85);color:#fff;padding:12px;font-family:monospace;font-size:12px;z-index:999999;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);pointer-events:auto;';
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '关闭 [X]';
    closeBtn.style.cssText = 'float:right;background:#333;color:#fff;border:none;padding:2px 6px;cursor:pointer;';
    closeBtn.onclick = () => box.remove();
    box.appendChild(closeBtn);
    document.body.appendChild(box);
  }
  const item = document.createElement('div');
  item.style.marginBottom = '6px';
  item.innerText = `[${tag}] ${msg}`;
  box.appendChild(item);
}

// 全局异常拦截 (严格仅在 debug 启动参数开启时生效)
window.addEventListener('error', event => {
  if (!isDebugMode()) return;
  queueLog('ERROR', 'window.error', event.message, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error ? event.error.stack : null
  });
});

window.addEventListener('unhandledrejection', event => {
  if (!isDebugMode()) return;
  queueLog('ERROR', 'unhandledRejection', event.reason ? (event.reason.message || String(event.reason)) : 'Unknown', {
    stack: event.reason && event.reason.stack
  });
});

export const Logger = {
  isDebug: () => isDebugMode(),
  info: (tag, msg, extra) => queueLog('INFO', tag, msg, extra),
  warn: (tag, msg, extra) => queueLog('WARN', tag, msg, extra),
  error: (tag, msg, extra) => queueLog('ERROR', tag, msg, extra),
  time: (tag, label) => {
    if (!isDebugMode()) return () => {};
    const t0 = performance.now();
    return () => {
      const cost = (performance.now() - t0).toFixed(2);
      queueLog('INFO', tag, `${label} 完成 (耗时: ${cost}ms)`);
    };
  }
};

window.GameLogger = Logger;

if (isDebugMode()) {
  Logger.info('SYSTEM', '全局诊断与日志系统已激活 (Debug Mode)');
}
