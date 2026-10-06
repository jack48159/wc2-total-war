// The only place that decides which interaction layer to use.
const hasLocation = typeof location !== 'undefined';
const hasNavigator = typeof navigator !== 'undefined';
const hasDocument = typeof document !== 'undefined';
const hasWindow = typeof window !== 'undefined';

const query = hasLocation ? new URLSearchParams(location.search).get('platform') : null;
const appleMobile = hasNavigator && (
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
);
const androidMobile = hasNavigator && /Android/i.test(navigator.userAgent);
const id = ['ios', 'android', 'windows'].includes(query) ? query : appleMobile ? 'ios' : androidMobile ? 'android' : 'windows';
if (hasDocument && document.documentElement?.dataset) {
  document.documentElement.dataset.platform = id;
}

const inset = name => {
  if (!hasDocument || !document.createElement || !document.documentElement) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;padding-top:env(safe-area-inset-${name},0px)`;
  document.documentElement.append(probe);
  const value = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return value;
};

export const platform = {
  id,
  isTouch: id === 'ios' || id === 'android',
  isStaticWeb: !!(hasWindow && window.WC2_CONFIG?.staticWeb),
  isPackaged: ((hasLocation && location.protocol === 'capacitor:') || !!(hasWindow && window.Capacitor?.isNativePlatform?.())),
  assetIndex(name) { return this.isStaticWeb ? `web_meta/${name}.json` : this.isPackaged ? `ios_meta/${name}.json` : `/api/${name}`; },
  async fetchRemote(url, options = {}) {
    const native = this.isPackaged && hasWindow && window.Capacitor?.Plugins?.CapacitorHttp;
    if (!native) return fetch(url, options);
    const response = await native.request({url,method:options.method || 'GET',headers:options.headers || {},data:options.body,responseType:'json'});
    return new Response(typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      {status:response.status,headers:response.headers});
  },
  // 电脑上预览手机刘海：?safe=62 (左右 62、下 21) 或 ?safe=左,上,右,下
  get safeArea() {
    const q = hasLocation ? new URLSearchParams(location.search).get('safe') : null;
    if (q) { const n = q.split(',').map(Number); return n.length >= 4 ? { left: n[0], top: n[1], right: n[2], bottom: n[3] } : { left: n[0], right: n[0], top: 0, bottom: 21 }; }
    return { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') };
  },
};
