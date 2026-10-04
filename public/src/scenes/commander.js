import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { COUNTRY_NAMES } from '../game/situation.js';
import { countryCommanders, ownsCommander, nationKey, readyCommanders, modLines } from '../game/army_groups.js';

const HOI4_PORTRAIT_CACHE = new Map();
const COUNTRY_ENGLISH = { am:'United States', ru:'Soviet Union', fl:'Finland', tw:'Republic of China', cn:'China', ja:'Japan', gb:'United Kingdom', rk:'South Korea', nk:'North Korea', yu:'Yugoslavia' };
const englishCountryName = id => COUNTRY_ENGLISH[id] || new Intl.DisplayNames(['en'], { type:'region' }).of(id.toUpperCase());
const portraitId = spec => String(spec?.id || '').replace(/^[a-z]{2}_/i, '').toLowerCase();
const portraitPath = spec => spec?.id ? `assets/hoi4/portraits/${encodeURIComponent(portraitId(spec))}.png` : '';

function getHoi4PortraitImage(id) {
  if (!id) return null;
  const key = String(id).replace(/^[a-z]{2}_/i, '').toLowerCase();
  if (!HOI4_PORTRAIT_CACHE.has(key)) {
    HOI4_PORTRAIT_CACHE.set(key, null);
    E.image(`assets/hoi4/portraits/${encodeURIComponent(key)}.png`)
      .then(img => HOI4_PORTRAIT_CACHE.set(key, img)).catch(() => {});
  }
  return HOI4_PORTRAIT_CACHE.get(key);
}

export function drawCommanderPortrait(img, spec, x, y, w, h) {
  const hoiImg = spec?.id ? getHoi4PortraitImage(spec.id) : null;
  if (hoiImg?.complete && hoiImg.naturalWidth > 0) {
    const c = E.ctx;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    const scale = Math.max(w / hoiImg.naturalWidth, h / hoiImg.naturalHeight);
    const sw = w / scale, sh = h / scale;
    c.drawImage(hoiImg, Math.max(0, (hoiImg.naturalWidth - sw) / 2), Math.max(0, (hoiImg.naturalHeight - sh) * .15), sw, sh, x, y, w, h);
    c.restore(); return true;
  }
  if (img && spec.art != null) {
    const sw = img.width / 4, sh = img.height / 2;
    E.ctx.drawImage(img, spec.art % 4 * sw, Math.floor(spec.art / 4) * sh, sw, sh, x, y, w, h);
  } else {
    E.panel(x, y, w, h, { fill:'#665b42', stroke:'#a98a55', r:4 });
  }
  return false;
}

const TINT = {gold:['#5a4a22','#2a2415'],silver:['#4b5256','#23282a'],bronze:['#5a3d26','#2a1d13'],owned:['#3e5530','#1c2a15']};
let silhouetteSerial = 0;
function silhouette(tier) {
  const [a,b] = TINT[tier], id = `commander-silhouette-${++silhouetteSerial}`;
  const badge = {gold:'#e8c45a',silver:'#cfd6d8',bronze:'#c98c58',owned:'#9fd47a'}[tier];
  return `<svg viewBox="0 0 90 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="90" height="120" fill="url(#${id})"/><path d="M8 120 C10 96 24 88 45 86 C66 88 80 96 82 120Z" fill="#141612"/><path d="M36 86 L45 100 L54 86Z" fill="#2b2e27"/><rect x="37" y="68" width="16" height="20" rx="4" fill="#1a1c17"/><ellipse cx="45" cy="56" rx="15" ry="18" fill="#1d1f1a"/><path d="M24 42 C26 28 64 28 66 42 L62 44 L28 44Z" fill="#101210"/><path d="M26 44 L64 44 C62 48 28 48 26 44Z" fill="#0a0b09"/><circle cx="45" cy="37" r="2.6" fill="${badge}" opacity=".85"/><path d="M16 104 L30 100 M74 104 L60 100" stroke="${tier === 'gold' ? '#a9863a' : '#5b5f55'}" stroke-width="3" stroke-linecap="round"/></svg>`;
}
function setPortrait(container, spec, tier) {
  container.innerHTML = silhouette(tier);
  const path = portraitPath(spec);
  if (!path) return;
  const img = document.createElement('img'); img.alt = '';
  img.onload = () => { if (img.isConnected) container.querySelector('svg')?.remove(); };
  img.onerror = () => img.remove();
  img.src = path;
  container.appendChild(img);
}

class Commander extends Page {
  constructor() { super(); this.route = 'commander'; this.country = 'de'; this.selected = null; }
  async init() {
    await readyCommanders();
    this.countries = [...new Set(['de', ...Object.keys(COUNTRY_NAMES).map(nationKey)])]
      .filter(id => countryCommanders(id).length > 2)
      .sort((a,b) => englishCountryName(a).localeCompare(englishCountryName(b), 'en'));
    this.country = nationKey(E.state.lastPlayedCountry || 'de');
    if (!this.countries.includes(this.country)) this.country = this.countries[0];
    this.roster = this.rosterFor(this.country);
    this.mount();
  }
  rosterFor(country) {
    const priority = spec => spec.startingRole === 'staff' ? 0 : spec.startingRole === 'defence' ? 1 : 2;
    return countryCommanders(country).sort((a,b) => priority(a) - priority(b) || Number(a.cost === 0) - Number(b.cost === 0));
  }
  tier(spec) {
    if (ownsCommander(E.state, spec)) return 'owned';
    const costs = this.roster.filter(s => s.cost > 0).map(s => s.cost).sort((a,b) => a-b);
    const rank = costs.indexOf(spec.cost) / Math.max(1, costs.length - 1);
    return rank >= 2/3 ? 'gold' : rank >= 1/3 ? 'silver' : 'bronze';
  }
  mount() {
    if (!document.getElementById('commander-style')) {
      const sheet = document.createElement('link'); sheet.id = 'commander-style'; sheet.rel = 'stylesheet'; sheet.href = 'src/scenes/commander.css'; document.head.appendChild(sheet);
    }
    // iOS 用单独的一套布局文件(commander.ios.css)，Windows 版不受影响
    if (E.platform?.isTouch && !document.getElementById('commander-style-ios')) {
      const sheet = document.createElement('link'); sheet.id = 'commander-style-ios'; sheet.rel = 'stylesheet'; sheet.href = 'src/scenes/commander.ios.css'; document.head.appendChild(sheet);
    }
    const root = this.root = document.createElement('section'); root.className = 'commander-screen';
    root.innerHTML = `<div class="commander-wrap"><header class="commander-top"><button class="commander-back" type="button">‹ 返回</button><div class="commander-heading"><small>HIGH COMMAND · PERSONNEL</small><h1>指挥官名册</h1></div><div class="commander-medals">勋章<strong></strong></div></header><div class="commander-split"><aside class="commander-dossier" aria-live="polite"><div class="commander-dossier-scroll"><div class="commander-photo-col"><div class="commander-clip"></div><div class="commander-id-photo"></div><div class="commander-stamp"></div></div><small class="commander-eyebrow"></small><h2></h2><p class="commander-role"></p><hr class="commander-rule"><p class="commander-bio"></p><p class="commander-years"></p><div class="commander-mods"></div></div><div class="commander-foot"><button class="commander-action" type="button"></button></div></aside><section class="commander-roster"><div class="commander-toolbar"><label>国籍 <select class="commander-country"></select></label><span class="commander-count"></span></div><div class="commander-grid" aria-label="指挥官名册"></div></section></div></div>`;
    document.body.appendChild(root);
    root.querySelector('.commander-back').onclick = () => E.go('home');
    const select = root.querySelector('.commander-country');
    for (const id of this.countries) { const option = document.createElement('option'); option.value = id; option.textContent = `${englishCountryName(id)} · ${COUNTRY_NAMES[id] || id}`; select.appendChild(option); }
    select.value = this.country;
    select.onchange = () => { this.country = select.value; this.roster = this.rosterFor(this.country); this.selected = null; this.renderRoster(); };
    this.renderRoster();
  }
  renderRoster() {
    if (!this.root) return;
    this.root.querySelector('.commander-medals strong').textContent = String(E.state.medals || 0);
    this.root.querySelector('.commander-count').textContent = `${this.roster.length} 位指挥官 · ${this.roster.filter(s => ownsCommander(E.state,s)).length} 位已招募`;
    const grid = this.root.querySelector('.commander-grid'); grid.replaceChildren();
    for (const spec of this.roster) {
      const tier = this.tier(spec), card = document.createElement('button');
      card.type = 'button'; card.className = 'commander-card'; card.dataset.id = spec.id;
      const photo = document.createElement('div'); photo.className = 'commander-portrait'; setPortrait(photo,spec,tier);
      const ribbon = document.createElement('span'); ribbon.className = `commander-card-tag ${tier}`; ribbon.textContent = tier === 'owned' ? '已招募' : `${spec.cost} 勋章`; photo.appendChild(ribbon);
      const plate = document.createElement('div'); plate.className = 'commander-card-info';
      const name = document.createElement('strong'); name.textContent = spec.roleName || spec.name;
      const tactic = document.createElement('span'); tactic.textContent = spec.roleName ? `${spec.name} · ${spec.tactic || ''}` : spec.tactic || '';
      plate.append(name,tactic); card.append(photo,plate);
      card.onclick = () => {
        this.select(spec);
        if (matchMedia('(max-width:760px)').matches) this.root.scrollTop = 0;
      };
      grid.appendChild(card);
    }
    this.select(this.roster.find(s => s.id === this.selected) || this.roster[0]);
  }
  select(spec) {
    if (!spec || !this.root) return;
    this.selected = spec.id;
    for (const card of this.root.querySelectorAll('.commander-card')) card.classList.toggle('selected', card.dataset.id === spec.id);
    const panel = this.root.querySelector('.commander-dossier');
    setPortrait(panel.querySelector('.commander-id-photo'),spec,this.tier(spec));
    panel.querySelector('.commander-stamp').textContent = spec.tactic || '指挥官';
    panel.querySelector('.commander-eyebrow').textContent = `${COUNTRY_NAMES[this.country] || this.country} · 指挥官档案`;
    panel.querySelector('h2').textContent = spec.name;
    const role = panel.querySelector('.commander-role'); role.textContent = [spec.roleName, spec.tactic].filter(Boolean).join(' · ');
    if (spec.marshal) { const em = document.createElement('em'); em.textContent = '· 可任元帅'; role.appendChild(em); }
    panel.querySelector('.commander-bio').textContent = spec.bio || '';
    panel.querySelector('.commander-years').textContent = spec.years ? `服役年份 ${spec.years[0]} – ${spec.years[1]}` : '';
    const mods = panel.querySelector('.commander-mods'); mods.replaceChildren();
    for (const line of modLines(spec.mods)) { const tag = document.createElement('span'); tag.className = line.positive ? 'positive' : 'negative'; tag.textContent = line.text; mods.appendChild(tag); }
    const action = panel.querySelector('.commander-action');
    const owned = ownsCommander(E.state,spec), affordable = (E.state.medals || 0) >= spec.cost;
    action.classList.toggle('owned',owned); action.disabled = owned || !affordable;
    action.textContent = owned ? '已招募 · 出战中' : affordable ? `招募 · 花费 ${spec.cost} 勋章` : `勋章不足 · 需要 ${spec.cost}`;
    action.onclick = () => {
      if (ownsCommander(E.state,spec) || (E.state.medals || 0) < spec.cost) return;
      E.state.medals -= spec.cost;
      E.state.ownedCommanders = [...new Set([...(E.state.ownedCommanders || []),spec.id])];
      E.saveState(); E.playSfx('lvup.wav'); this.renderRoster();
    };
  }
  key(e) { if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); E.go('home'); } }
  draw() { E.ctx.fillStyle = '#10151a'; E.ctx.fillRect(0,0,E.W,E.H); }
  dispose() { this.root?.remove(); this.root = null; }
}
export { Commander };
