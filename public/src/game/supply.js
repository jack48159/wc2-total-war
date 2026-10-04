import { areaIncome } from './economy.js';

// Use the tile's displayed money/industry output, including its native tax.
export function supplyCapacity(game, area) {
  if (!game.supplyByInfrastructure) return 200;
  if (!area || area.sea) return 0;
  const income = areaIncome(game, area);
  return Math.min(250, Math.max(0, Math.floor(income.money * 2 + income.industry * 5)));
}
export function supplyRuleHint(game) {
  return game?.supplyByInfrastructure
    ? '仅限有产出的己方陆地与受损部队；恢复额度为金币产出×2＋工业产出×5，整格共享，最多250点。'
    : '在有受损己方部队的己方地块使用，整格共享最多200点恢复。';
}
