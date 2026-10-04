import { buildModel } from '../core/model.js';
export function commanderView(staffModel, ao = [], intelPackets = []) {
  if (!staffModel.game?.fogOfWar) return staffModel;
  const stage = staffModel.game.stage;
  const visible = new Set(ao);
  for (const id of ao) for (const neighbor of stage.adjE.get(id) || []) visible.add(neighbor);
  const packets = new Map(intelPackets.filter(p => Number.isInteger(p.area) && p.age >= 0).map(p => [p.area, p]));
  const stageView = new Proxy(stage, { get(target, property) {
    if (property === 'st') return id => {
      const raw = target.st(id);
      if (!raw || visible.has(id) || raw.country === staffModel.me) return raw;
      const packet = packets.get(id);
      return { ...raw, armies: (packet?.enemyUnits || []).map(u => ({ ...u, confidence: 1 / (1 + packet.age) })) };
    };
    if (property === 'areas') return target.areas.map(a => stageView.st(a.id));
    return target[property];
  } });
  const gameView = new Proxy(staffModel.game, { get(target, property) { return property === 'stage' ? stageView : target[property]; } });
  // Build the derived helpers on the filtered stage as well. Proxying only
  // area() leaked enemy stacks through reach(), threatMap() and pLose().
  return buildModel(gameView, staffModel.me, { skipFog: true, wI: staffModel.wI });
}
