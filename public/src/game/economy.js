import { World } from './world.js';

export function areaIncome(game, area) {
  const a = typeof area === 'number' ? game.stage?.st?.(area) : area;
  if (!a || a.sea) return { money: 0, industry: 0 };
  const me = game.stage?.countries?.get(a.country);
  const baseCity = a.areaType === 1 ? 3 : a.areaType === 3 ? 2 : a.areaType === 4 ? 1 : 0;
  const baseIndustry = a.areaType === 1 ? 2 : a.areaType === 3 ? 1 : 0;
  const city = Math.max(baseCity, a.construction === 'city' ? a.level || 0 : 0);
  const industry = Math.max(baseIndustry, a.construction === 'industry' ? a.level || 0 : 0);
  const tax = Math.trunc((5 * city + (World.areas[a.id]?.tax || 0)) * (me?.taxfactor ?? 1));
  const ind = Math.trunc((5 * industry + (World.areas[a.id]?.industry || 0)) * (me?.industryfactor ?? 1));
  return { money: tax, industry: ind };
}
