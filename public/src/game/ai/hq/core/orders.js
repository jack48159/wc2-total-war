/** @typedef {{id:string,opId?:string,verb:string,from?:number|number[],to:number|number[],risk:number,priority:number,expires:number,ao?:number[],mustHold?:number[]}} Order */
/** @typedef {{feasible:boolean,pSuccess:number,expGain:number,expLoss:number,turns:number,shortfall:number,notes:string[]}} Bid */
/** @typedef {{orderId:string,status:string,progress:number,strength:number,lossesSoFar:number,threats:object[],requests:object[]}} Report */
const verbs = new Set(['attack', 'breakthrough', 'envelop', 'counterattack', 'amphibious', 'defend', 'delay', 'concentrate', 'screen', 'withdraw', 'support', 'allout']);
const missions = new Set(['fix', 'feint', 'cut', 'flank', 'suppress', 'lure']);
const effects = new Set(['pin_reserves', 'divert_attention', 'sever_reinforcement', 'cover_flank', 'soften_target', 'attrition']);
const area = x => Number.isInteger(x) && x >= 0;
const areas = x => Array.isArray(x) ? x.length > 0 && x.every(area) : area(x);
export const clamp01 = value => Math.max(0, Math.min(1, value));
const probability = value => Number.isFinite(value) && value >= -1e-9 && value <= 1 + 1e-9;
export function validateOrder(order) {
  if (!order || typeof order.id !== 'string' || !order.id) return 'invalid id';
  if (!verbs.has(order.verb)) return 'invalid verb';
  if ((order.to == null ? !['support', 'allout'].includes(order.verb) : !areas(order.to)) || (order.from != null && !areas(order.from))) return 'invalid area';
  if (order.opId != null && typeof order.opId !== 'string') return 'invalid opId';
  if (order.verb === 'support' && (!(typeof order.with === 'string' && order.with || Array.isArray(order.with) && areas(order.with)) || !missions.has(order.mission) || !effects.has(order.effect))) return 'invalid support';
  if (order.verb === 'envelop' && (!Array.isArray(order.axes) || order.axes.length < 2 || !order.axes.every(ax => area(ax) || (Array.isArray(ax) && ax.length > 0 && ax.every(area))) || (order.sync != null && typeof order.sync !== 'boolean'))) return 'invalid envelop';
  if (order.verb === 'breakthrough' && (!Number.isInteger(order.depth) || order.depth < 1)) return 'invalid depth';
  if (order.verb === 'counterattack' && order.trigger != null && typeof order.trigger !== 'string') return 'invalid trigger';
  if (!Number.isFinite(order.risk) || order.risk < 0 || order.risk > 1) return 'invalid risk';
  if (!Number.isInteger(order.priority) || order.priority < 1 || order.priority > 9) return 'invalid priority';
  if (order.expires != null && (!Number.isInteger(order.expires) || order.expires < 1)) return 'invalid expires';
  if ((order.ao && (!Array.isArray(order.ao) || !order.ao.every(area))) ||
      (order.mustHold && (!Array.isArray(order.mustHold) || !order.mustHold.every(area)))) return 'invalid constraints';
  return null;
}
export function makeOrder(input) {
  const order = { risk: .5, priority: 5, expires: 1, ...input };
  const error = validateOrder(order);
  if (error) throw new TypeError(error);
  return order;
}
export function makeBid(input = {}) {
  const bid = { feasible: false, pSuccess: 0, expGain: 0, expLoss: 0, turns: 1, shortfall: 0, notes: [], reason: null, ...input };
  if (typeof bid.feasible !== 'boolean' || !probability(bid.pSuccess) ||
      ![bid.expGain, bid.expLoss, bid.turns, bid.shortfall].every(x => Number.isFinite(x) && x >= 0) ||
      !Array.isArray(bid.notes) || bid.reason != null && typeof bid.reason !== 'string') throw new TypeError('invalid bid');
  bid.pSuccess = clamp01(bid.pSuccess);
  return bid;
}
export function makeReport(input = {}) {
  const report = { orderId: '', status: 'pending', progress: 0, strength: 0, lossesSoFar: 0, threats: [], requests: [], deviated: false, warnings: [], effectAchieved: null, ...input };
  if (!new Set(['pending', 'progressing', 'achieved', 'stalled', 'failed']).has(report.status) ||
      !probability(report.progress) ||
      !Number.isFinite(report.strength) || report.strength < 0 ||
      !Number.isFinite(report.lossesSoFar) || report.lossesSoFar < 0 ||
      !Array.isArray(report.threats) || !Array.isArray(report.requests) ||
      report.requests.some(r => !['reinforce', 'withdraw', 'release'].includes(r?.type)) ||
      typeof report.deviated !== 'boolean' || !Array.isArray(report.warnings) ||
      report.effectAchieved != null && typeof report.effectAchieved !== 'boolean') throw new TypeError('invalid report');
  report.progress = clamp01(report.progress);
  return report;
}
