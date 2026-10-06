import { getCountryFlagSrc } from './multiplayer_shared.js';

const styleLoads = new Map();
export function loadSandboxStyles() {
  const updateMobile = () => {
    document.documentElement.dataset.sandboxMobile = String(['android','ios'].includes(document.documentElement.dataset.platform) || matchMedia('(pointer: coarse), (max-width: 760px)').matches);
  };
  updateMobile();
  if (!window.__wc2SandboxResize) { window.__wc2SandboxResize = updateMobile; window.addEventListener('resize', updateMobile); }
  const pending = [];
  for (const name of ['multiplayer','sandbox']) {
    const id = 'wc2-' + name + '-styles';
    const url = new URL(`src/scenes/${name}.css`, document.baseURI);
    url.searchParams.set('v', window.WC2_CONFIG?.release || window.WC2_CONFIG?.version || 'sandbox-mobile-18');
    if (!styleLoads.has(url.href)) {
      let link = document.getElementById(id);
      if (link?.href === url.href && link.sheet) { styleLoads.set(url.href, Promise.resolve()); }
      else {
        link?.remove(); link = document.createElement('link'); link.id=id; link.rel='stylesheet';
        const ready = new Promise((resolve, reject) => { link.onload=resolve; link.onerror=()=>reject(new Error('沙盒界面样式加载失败，请重新打开')); });
        styleLoads.set(url.href, ready.catch(error => { styleLoads.delete(url.href); throw error; }));
        link.href=url.href; document.head.append(link);
      }
    }
    pending.push(styleLoads.get(url.href));
  }
  return Promise.all(pending);
}
export function element(parent, tag, text='', className='') {
  const node=document.createElement(tag);node.textContent=text;node.className=className;parent.append(node);return node;
}
export function flagButton(parent, country, name, selected, action) {
  const button=element(parent,'button','','mp-country-btn'+(selected?' is-mine':''));button.type='button';
  const flag=element(button,'span','','mp-country-flag'),src=getCountryFlagSrc(country.flag||country.id);
  if(src)flag.style.backgroundImage=`url("${src}")`;else flag.textContent=country.id;
  element(button,'span',name,'mp-country-name');button.onclick=action;return button;
}
export function flagBadge(parent, country, name) {
  const badge=element(parent,'span','','sb-country-badge');
  const flag=element(badge,'span','','mp-country-flag'),src=getCountryFlagSrc(country.flag||country.id);
  if(src)flag.style.backgroundImage=`url("${src}")`;
  element(badge,'span',name);return badge;
}
export function moreActions(parent) {
  const menu=element(parent,'details','','sb-header-more');
  element(menu,'summary','更多');
  const actions=element(menu,'div','','sb-header-more-actions');
  actions.addEventListener('click',event=>{if(event.target.closest('button'))menu.open=false;});
  return actions;
}
