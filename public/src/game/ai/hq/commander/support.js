import { loadOverrides } from '../core/params.js';
const P = loadOverrides();
const strength = (model, area) => (model.area(area)?.armies || []).reduce((sum, unit) => sum + (model.unitValue?.(unit) ?? unit.hp ?? 1), 0);
export function supportEffect(order, model, primaryBid = null) {
  const targets = Array.isArray(order.to) ? order.to : order.to == null ? [] : [order.to];
  const target = targets[0];
  if (target == null) return { delta: 0, achieved: false };
  const neighbors = model.game.stage.adjE.get(target) || [];
  const reserves = neighbors.reduce((sum, id) => sum + strength(model, id), 0);
  const enemy = strength(model, target);
  const base = primaryBid ? primaryBid.pSuccess * primaryBid.expGain - primaryBid.expLoss : model.areaValue?.(target) ?? 0;
  let delta = 0;
  switch (order.effect) {
    case 'pin_reserves': delta = Math.min(reserves, enemy) * P.supportPinWeight; break;
    case 'sever_reinforcement': delta = reserves * P.supportCutWeight; break;
    case 'cover_flank': delta = (model.pLose?.(target) ?? 0) * Math.max(0, base) * P.supportFlankWeight; break;
    case 'soften_target': delta = enemy * P.supportSoftenWeight; break;
    case 'divert_attention': delta = reserves * P.supportDivertWeight; break;
    case 'attrition': delta = enemy * P.supportAttritionWeight; break;
  }
  return { delta: Math.max(0, delta), achieved: delta > 0 };
}
