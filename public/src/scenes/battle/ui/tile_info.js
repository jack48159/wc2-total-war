import { groupForArmy, commanderById, modLines, COMMANDER_ATLAS } from '../../../game/army_groups.js';
import { CountryCard } from './country_card.js';
import { drawCommanderPortrait } from '../../commander.js';
import { E } from '../../../core/index.js';
import { countryGameView, visibilityForCountry } from '../../../game/rules/visibility.js';
import { World } from '../../../game/world.js';

const SCALE = 1.3;
const TOP = 35;
const STAMPS = { fort: 'stamp_fortress', entrenchment: 'stamp_wire', antiaircraft: 'stamp_aagun', radar: 'stamp_radar' };

export class TileInfo {
  constructor(game, ui1, army) { this.game = game; this.ui1 = ui1; this.army = army; this.countryCard = new CountryCard(game, army); E.image(COMMANDER_ATLAS).then(img=>this.portraits=img).catch(()=>{}); }

  details(areaId) {
    if (areaId < 0) return null;
    const view = (this.game.fogOfWar && !this.game.bridgeSpectating) ? countryGameView(this.game, this.game.player) : this.game;
    const area = view.stage.st(areaId), mapArea = World.areas[areaId];
    const hidden = (this.game.fogOfWar && !this.game.bridgeSpectating) && !visibilityForCountry(this.game, this.game.player).has(areaId);
    if (!mapArea) return null;
    const cityBase = { 1: 3, 3: 2, 4: 1 }[mapArea.areaType] || 0;
    const industryBase = { 1: 2, 3: 1 }[mapArea.areaType] || 0;
    const cityLevel = Math.max(cityBase, area?.construction === 'city' ? area.level : 0);
    const industryLevel = Math.max(industryBase, area?.construction === 'industry' ? area.level : 0);
    const commander = area?.armies.some(unit => unit.cards & 8) ? this.game.stage.countries.get(area.country) : null;
    return { money: hidden ? '—' : mapArea.tax + 5 * cityLevel, industry: hidden ? '—' : (mapArea.industry || 0) + 5 * industryLevel,
      installation: area?.installation, commander, country: area?.country };
  }

  prepare(areaId) {
    const details = this.details(areaId);
    this.countryCard.prepare(details ? areaId : -1, details ? { x: 0, y: TOP, w: 248, h: (details.commander ? 217 : 144) * SCALE } : null);
  }

  contains(point, areaId) {
    const details = this.details(areaId);
    if (!details) return false;
    if (this.countryCard.contains(point)) return true;
    const boardH = (details.commander ? 217 : 144) * SCALE;
    return !!details && point.x >= 0 && point.x < 248 && point.y >= TOP && point.y < TOP + boardH;
  }

  orderTarget(point, areaId) {
    return null;
  }
  draw(areaId) {
    const details = this.details(areaId);
    if (!details) return;
    const ui1 = this.ui1, commander = details.commander;
    this.countryCard.draw();
    E.drawFrame(commander ? ui1.income_board2 : ui1.income_board, 0, TOP, { scale: SCALE, noRef: true });
    if (commander) {
      const portraitName = String(commander.commander || '').toLowerCase().replace(/ /g, '');
      const portrait = commander.ai ? ui1[`general_${portraitName}`] || ui1.general_common : ui1.general_player;
      E.drawFrame(portrait, 0, TOP + 108 * SCALE, { scale: SCALE, noRef: true });
      const medal = commander.ai
        ? this.army[`medal_${commander.flag}`] || this.army[`medal_common_${portraitName.slice(-1)}`] || this.army.medal_common_3
        : this.army[`commander_level_${E.clamp(Math.floor(commander.commanderLevel / 3) + 1, 1, 5)}_s`];
      if (medal) E.drawFrameCentered(medal, 191, TOP + 172, { scale: SCALE });
    }
    const stamp = ui1[STAMPS[details.installation]];
    if (stamp) E.drawFrame(stamp, 154, TOP + 20, { scale: SCALE, noRef: true });
    const style = { size: 37, bold: true, font: E.NUM, align: 'right', color: '#26323a' };
    // 数字与左侧图标(↑$ / ↑扳手)垂直居中对齐：图标中心约在 TOP+88 / TOP+133
    E.text(String(details.money), 140, TOP + 88, style);
    E.text(String(details.industry), 140, TOP + 133, style);
  }
}
