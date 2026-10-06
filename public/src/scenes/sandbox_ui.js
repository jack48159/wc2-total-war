import { getCountryFlagSrc } from './multiplayer_shared.js';

export function loadSandboxStyles() {
  for (const name of ['multiplayer','sandbox']) {
    const id = 'wc2-' + name + '-styles';
    if (document.getElementById(id)) continue;
    const link = document.createElement('link'); link.id=id; link.rel='stylesheet'; link.href=`src/scenes/${name}.css`; document.head.append(link);
  }
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
