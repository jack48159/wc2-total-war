import { E } from '../core/index.js';
import { Page } from '../ui/ui.js';
import { SANDBOX_BATTLES } from '../game/sandbox_battles.js';
import { sandboxLibrary } from './sandbox_editor.js';
import { localWrite } from '../core/local_data.js';

export class Sandbox extends Page {
  constructor() { super(); this.route = 'sandbox'; this.mapIndex = 0; this.page = 0; this.selected = new Set(); }
  async init() {
    [this.maps, this.names, this.paper] = await Promise.all([E.json('data/conquests.json'), E.json('data/countries.json'), E.image('assets/board_paper@2x.webp')]);
    this.maps = [...this.maps];
    this.maps.unshift({id:"world",stage:"sandbox_world",name:"原版完整世界 · 跨关卡拼合"});
    await this.loadMap();
  }
  openEditor() {
    if (this.selected.size < 2) { this.notice("至少选择两个参战国"); return; }
    const q = this.maps[this.mapIndex];
    E.go("sandboxEditor", this, q.stage || "conquest_" + q.id, {sandbox:true, player:this.player, participatingCountries:[...this.selected], freeDiplomacy:true, historicalDiplomacy:false, ...(this.preset ? {sandboxBattle:this.preset.id} : {})});
  }
  async onShow() {
    this.libraryPanel?.remove();
    const library = await sandboxLibrary();
    if (!library.length || E.scene !== this) return;
    const panel = this.libraryPanel = document.createElement("div");
    Object.assign(panel.style,{position:"fixed",left:"12px",bottom:"12px",maxHeight:"28vh",overflow:"auto",zIndex:55,background:"#dbc9a4",color:"#302317",padding:"10px",borderRadius:"8px",maxWidth:"min(600px,90vw)"});
    const title=document.createElement("strong");title.textContent="我的沙盒作品";panel.append(title);
    for (const record of library) {
      const row=document.createElement("div");row.style.marginTop="6px";
      const name=document.createElement("span");name.textContent=record.name+" · "+record.config.countries.length+"国 · "+record.config.areas.length+"地块 ";row.append(name);
      const button=(text,run)=>{const b=document.createElement("button");b.textContent=text;b.style.margin="0 4px";b.onclick=run;row.append(b);};
      button("编辑 / 开始",()=>E.go("sandboxEditor",this,record.config.stage,{},record));
      button("复制",async()=>{const all=await sandboxLibrary();const copy=structuredClone(record);copy.id=crypto.randomUUID();copy.name+=" · 副本";copy.config.name=copy.name;all.unshift(copy);await localWrite("sandbox-designs",all);this.onShow();});
      button("删除",async()=>{if (!confirm("删除沙盒作品“"+record.name+"”？"))return;await localWrite("sandbox-designs",(await sandboxLibrary()).filter(r=>r.id!==record.id));this.onShow();});
      panel.append(row);
    }
    document.body.append(panel);
  }
  dispose() { this.libraryPanel?.remove(); }
  onBack() { E.go('home'); }
  nameOf(id) { return this.names[id]?.name || id; }
  async loadMap() {
    this.loading = true;
    const request = this.request = (this.request || 0) + 1, q = this.maps[this.mapIndex];
    try {
      const data = await E.json(`data/stages/${q.stage || 'conquest_' + q.id}.json`);
      if (request !== this.request) return;
      const owners = new Set(data.areas.map(a => a.country));
      this.countries = data.countries.filter(c => owners.has(c.id) && (!this.preset || this.preset.countries.includes(c.id)));
      this.selected = new Set(this.countries.map(c => c.id));
      this.player = this.countries[0]?.id; this.page = 0;
      this.loading = false; this.makeButtons();
    } catch (error) {
      if (request !== this.request) return;
      this.loading = false; this.countries = []; this.widgets = [];
      this.notice('地图加载失败：' + error.message);
    }
  }
  changeMap(delta) { this.preset = null; this.mapIndex = (this.mapIndex + delta + this.maps.length) % this.maps.length; void this.loadMap(); }
  selectBattle(preset) {
    this.preset = preset; this.mapIndex = this.maps.findIndex(q => q.id === 1);
    if (this.mapIndex < 0) this.mapIndex = 0;
    void this.loadMap();
  }
  makeButtons() {
    const button = (label, x, y, w, action) => Object.assign(new E.Button({ label, onClick: action }), { x, y, w, h: 54 });
    this.widgets = [
      button('编辑沙盒', 640, 270, 170, () => this.openEditor()),
      button('上一地图', 220, 190, 190, () => this.changeMap(-1)),
      button('下一地图', 1190, 190, 190, () => this.changeMap(1)),
      button('全部参战', 220, 270, 190, () => { this.selected = new Set(this.countries.map(c => c.id)); this.makeButtons(); }),
      button(this.preset ? '自定义沙盒' : '仅留本国', 430, 270, 190, () => {
        if (this.preset) { this.preset = null; void this.loadMap(); return; }
        this.selected = new Set([this.player]); this.makeButtons();
      }),
      button('玩家：' + this.nameOf(this.player), 830, 270, 550, () => {
        const ids = this.countries.filter(c => this.selected.has(c.id)).map(c => c.id);
        this.player = ids[(ids.indexOf(this.player) + 1) % ids.length]; this.makeButtons();
      }),
      button('上一页', 220, 700, 190, () => { this.page = Math.max(0, this.page - 1); this.makeButtons(); }),
      button('下一页', 430, 700, 190, () => { this.page = Math.min(Math.ceil(this.countries.length / 20) - 1, this.page + 1); this.makeButtons(); }),
      button('对局配置', 1120, 700, 260, () => this.onOk())
    ];
    this.countries.slice(this.page * 20, this.page * 20 + 20).forEach((country, i) => {
      const b = button(this.nameOf(country.id), 220 + i % 4 * 295, 350 + Math.floor(i / 4) * 66, 275, () => {
        if (this.preset) { this.player = country.id; this.makeButtons(); return; }
        if (this.selected.has(country.id)) {
          if (this.selected.size === 1) return;
          this.selected.delete(country.id);
          if (this.player === country.id) this.player = this.countries.find(c => this.selected.has(c.id)).id;
        } else this.selected.add(country.id);
        this.makeButtons();
      });
      b.countryId = country.id; this.widgets.push(b);
    });
    SANDBOX_BATTLES.forEach((preset, i) => this.widgets.push(button(preset.name, 220 + i * 390, 778, 370, () => this.selectBattle(preset))));
  }
  onOk() {
    if (this.loading || !this.countries?.length) return;
    if (this.selected.size < 2) { this.notice('至少选择两个参战国家。'); return; }
    const q = this.maps[this.mapIndex];
    E.go('matchSetup', this, q.stage || 'conquest_' + q.id, {
      sandbox: true, participatingCountries: [...this.selected], player: this.player,
      ...(this.preset ? { sandboxBattle:this.preset.id, commanderLevel:3 } : {}),
      freeDiplomacy: true, historicalDiplomacy: false,
      commanderLevel: this.preset ? 3 : Math.max(0, (E.state.rank || 1) - 1)
    }, '沙盒 · ' + (this.preset ? this.preset.name + ' · ' + this.preset.year : q.name) + ' · ' + this.nameOf(this.player));
  }
  renderBg() { E.ctx.fillStyle = '#302719'; E.ctx.fillRect(0, 0, E.W, E.H); }
  render() {
    E.ctx.drawImage(this.paper, 170, 45, 1260, 780);
    E.text('沙盒模式', 800, 115, { size: 46, bold: true, align: 'center', color: '#2a1608' });
    E.text(this.preset ? this.preset.name + ' · ' + this.preset.year : this.maps[this.mapIndex].name, 800, 217, { size: 32, align: 'center', color: '#2a1608' });
    E.text(this.preset ? this.preset.description : '选择参战国；未选国家的领土变为无主地。开局中立，自由外交。', 800, 160, { size: 23, align: 'center', color: '#5a3d18' });
    if (this.loading) { E.text('正在加载地图…', 800, 470, { size: 30, align: 'center' }); return; }
    for (const b of this.widgets) {
      const selected = b.countryId && this.selected.has(b.countryId);
      E.layout.group(b, 'scenes/sandbox/button', () => {
        const f = E.fx(b, false);
        E.panel(b.x, b.y + f.dy, b.w, b.h, { fill: selected ? '#49613c' : '#68482c', r: 8 });
        E.label((b.countryId ? (selected ? '☑ ' : '☐ ') : '') + b.label, b.x + b.w / 2, b.y + b.h / 2 + f.dy, 24, { align: 'center' });
      });
    }
    E.text(`已选 ${this.selected.size} 国 · 第 ${this.page + 1}/${Math.max(1, Math.ceil(this.countries.length / 20))} 页`, 800, 727, { size: 23, align: 'center', color: '#5a3d18' });
    if (this.preset) this.preset.countries.forEach((id, i) => {
      const e = this.preset.economies[id], f = this.preset.forces[id];
      const strength = Object.values(f).reduce((n, positions) => n + positions.length, 0);
      E.text(`${this.nameOf(id)}：${strength}支部队 · 金币${e[0]} / 工业${e[1]} · 初始回合产出约${e[2]} / ${e[3]}`, 240, 520 + i * 55, {size:23, color:'#5a3d18'});
    });
  }
}
