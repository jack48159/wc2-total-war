import { World } from '../world.js';
import { countryGameView, visibilityForCountry } from '../rules/visibility.js';
import { getAreaName } from './names.js';

// Geometry is public geography; current ownership, buildings and troops are not.
export function getMapView(game, country = game.player) {
  game.stage.useWorld();
  const view = game.fogOfWar ? countryGameView(game, country) : game;
  const visible = game.fogOfWar ? visibilityForCountry(game, country) : new Set(game.stage.enabled);
  const areas = view.stage.areas.filter(a => view.stage.enabled.has(a.id));
  const enabled = new Set(areas.map(a => a.id));
  const nodes = areas.map(area => {
    const seen = visible.has(area.id);
    const owner = area.country && !game.stage.countries.get(area.country)?.eliminated ? area.country : null;
    const friendly = owner && view.stage.areAllied(owner, country);
    const units = seen ? (friendly ? area.armies : area.armies.slice(0, 1)) : [];
    const point = World.areas[area.id]?.pts?.[0];
    return { id: area.id, name: getAreaName(area.id, view.stage),
      x: Number.isFinite(point?.[0]) ? point[0] : null, y: Number.isFinite(point?.[1]) ? point[1] : null,
      sea: !!area.sea, visible: seen, owner, ownershipStatus: seen ? 'current' : owner ? 'last-known' : 'unknown',
      relation: !owner ? 'unknown' : owner === country ? 'self' : friendly ? 'ally' : 'enemy',
      construction: seen ? area.construction : null, constructionLevel: seen ? area.level : null,
      installation: seen ? area.installation : null,
      stackCount: seen ? area.armies.length : null,
      units: units.map(u => ({ id: u.id, type: u.type, templateId:u.templateId,name:game.stage.data.sandboxFeatures?.units?.find(d=>d.id===u.templateId)?.name, hp: u.hp, maxHp: u.maxHp, movement: u.movement })),
      neighbours: (view.stage.adjE.get(area.id) || []).filter(id => enabled.has(id)) };
  });
  const links = nodes.flatMap(n => n.neighbours.filter(id => n.id < id).map(id => [n.id, id]));
  const points = nodes.filter(n => n.x != null && n.y != null);
  const bounds = points.length ? { minX: Math.min(...points.map(n => n.x)), minY: Math.min(...points.map(n => n.y)),
    maxX: Math.max(...points.map(n => n.x)), maxY: Math.max(...points.map(n => n.y)) } : null;
  return { layer: 'map', stage: game.name, round: game.round, country, fogOfWar: !!game.fogOfWar,
    coordinates: '原地图坐标，x向右、y向下；图为地块中心与真实邻接关系示意，非地理方位推断。',
    legend: '蓝=本国，绿=盟友，红=敌方，灰=未知；暗色=过往归属，不能当作当前情报。数字=地块ID；兵力详情见nodes。',
    bounds, nodes, links };
}
