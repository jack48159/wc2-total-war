import { Controller } from '../../controller_base.js';
import { countryGameView } from '../../rules/visibility.js';
import { handlerFor } from '../../commands.js';
import { buildModel } from './core/model.js';
import { GeneralStaff } from './staff/staff.js';
import { commanderView } from './commander/intel.js';
import { planStackFrontCommands } from './commander/stack_front.js';
import { nextExpeditionCommand } from './commander/expedition.js';

export const HQ_MAX_ACTIONS_LIMIT = 40;
export const HQ_PLAN_TIMEOUT_MS = 250;

function isCommandBlocked(c, blocked) {
  if (!blocked || blocked.size === 0 || !c) return false;
  if (c.armyId != null && blocked.has(c.armyId)) return true;
  if (c.type === 'useCard') {
    if (blocked.has(`recruit:${c.target}:${c.card}`) || blocked.has(`card:${c.target}:${c.card}`)) return true;
  }
  if (c.type === 'buyCard' && blocked.has(`buy:${c.card}`)) return true;
  if (c.type === 'move' && blocked.has(`move:${c.from}:${c.to}:${c.armyId}`)) return true;
  if (c.type === 'attack' && blocked.has(`attack:${c.from}:${c.to}:${c.armyId}`)) return true;
  if ((c.type === 'setDiplomacy' || c.type === 'proposeDiplomacy') &&
      blocked.has(`consent:${c.type}:${c.first}:${c.second}:${c.state || c.action}`)) return true;
  return false;
}

/**
 * HqAi (O17 指挥官AI)
 * 采用总参谋部 (GeneralStaff) 战略规划与指挥官 (Commander) 增量单步执行 (next(model)) 架构。
 */
export class HqAi extends Controller {
  constructor(options = {}) {
    super();
    this.options = options;
    this.maxActions = options.maxActions || HQ_MAX_ACTIONS_LIMIT;
    this.staff = new GeneralStaff(options);
    this.preTurnQueue = [];
    this.assignedCommanders = [];
    this.intelPackets = [];
    this._lastTurnKey = null;
    this._actionCount = 0;
    this.model = null;
  }

  async takeTurn(game, country) {
    return this.commandsForTurn(game, country);
  }

  commandsForTurn(game, country, blocked = new Set()) {
    game.stage.useWorld();
    let viewGame = game;
    if (game.fogOfWar) {
      viewGame = countryGameView(game, country);
    }

    const turnKey = `${game.round}:${country}`;

    // 1. 每回合首次调用：总参战略规划、生产与编组入队
    if (this._lastTurnKey !== turnKey) {
      this._lastTurnKey = turnKey;
      this._actionCount = 0;
      this._expeditionActions = 0;
      this.preTurnQueue = [];
      this.frontArmyQueue = [];
      this.assignedCommanders = [];
      this.intelPackets = [];

      let plannedSuccessfully = false;

      try {
        // 收集上回合各指挥官战果战报
        const priorReports = [];
        for (const cmdr of this.staff.commanders.values()) {
          const rep = cmdr.report?.();
          if (rep) priorReports.push(rep);
        }
        if (this.staff.directCommander) {
          const rep = this.staff.directCommander.report?.();
          if (rep) priorReports.push(rep);
        }

        // 建立战场模型并执行总参规划
        this.model = buildModel(viewGame, country);
        const planResult = this.staff.plan(this.model, priorReports);

        // 生成战区情报通报（迷雾下按地块汇集敌情）
        if (game.fogOfWar) {
          const areaPackets = new Map();
          for (const e of (this.model.units.enemy || [])) {
            const list = areaPackets.get(e.area) || [];
            list.push(e);
            areaPackets.set(e.area, list);
          }
          for (const [aId, units] of areaPackets) {
            this.intelPackets.push({ area: aId, enemyUnits: units, age: 0 });
          }
        }

        // 编组与生产命令在回合开始优先出队
        this.preTurnQueue = [
          ...(planResult.organizeCommands || []),
          ...(planResult.produceCommands || []),
          ...(planResult.diplomacyCommands || [])
        ];

        this.assignedCommanders = planResult.assignedCommanders || [];

        // 清空指挥官旧缓存
        for (const cmdr of this.assignedCommanders) {
          cmdr._cachedCommands = null;
        }

        plannedSuccessfully = true;
      } catch (err) {
        // 规则 2: 不许整回合崩溃，记录 exception 到日志
        console.warn?.(`[HqAi] staff plan exception: ${err?.message}`);
        plannedSuccessfully = false;
      }

      if (!plannedSuccessfully) {
        // 即使总参全局阶段遇到异常，也尽力分配直属指挥部行动，不丢给 ScriptedAi
        if (this.staff?.directCommander && this.model) {
          this.assignedCommanders = [this.staff.directCommander];
        } else {
          this.assignedCommanders = [];
        }
      }
    }

    if (this._actionCount >= this.maxActions) {
      return [];
    }

    // 2. 优先执行编组、生产与外交命令
    // Reserve an early action budget for overseas operations before production
    // spends the transport budget. Rebuild the visible model after each action.
    if (this._expeditionActions < 12) {
      try {
        const expeditionModel = buildModel(viewGame, country);
        const expedition = nextExpeditionCommand(expeditionModel, c => isCommandBlocked(c, blocked));
        if (expedition) {
          this._expeditionActions++;
          this._actionCount++;
          return [expedition];
        }
      } catch (err) {
        this._expeditionActions = 12;
        console.warn?.(`[HqAi] expedition planning exception: ${err?.message}`);
      }
    }
    while (this.preTurnQueue.length > 0) {
      const nextCmd = this.preTurnQueue.shift();
      if (isCommandBlocked(nextCmd, blocked)) continue;

      const handler = handlerFor(nextCmd.type);
      if (handler?.validate && handler.validate(game, nextCmd) != null) {
        continue;
      }

      this._actionCount += 1;
      return [nextCmd];
    }

    // 3. 增量指挥官执行循环 (next(model))
    if (this.model) {
      try {
        this.model.sync();
      } catch {
        // Model sync error protection
      }
    }

    for (let i = 0; i < this.assignedCommanders.length; i++) {
      const cmdr = this.assignedCommanders[i];
      // 迷雾视图注入
      const cmdrModel = game.fogOfWar
        ? commanderView(this.model, cmdr.ao, this.intelPackets)
        : this.model;

      let nextCmd = null;

      try {
        // 如果指挥官实现了 next(model)，按单步增量获取
        if (typeof cmdr.next === 'function') {
          nextCmd = cmdr.next(cmdrModel);
        } else {
          // 兼容过渡：若 next 尚未就绪，从 execute 队列中逐条输出
          if (!cmdr._cachedCommands || cmdr._cachedCommands.length === 0) {
            cmdr._cachedCommands = cmdr.execute(cmdrModel) || [];
          }
          while (cmdr._cachedCommands.length > 0) {
            const c = cmdr._cachedCommands.shift();
            if (isCommandBlocked(c, blocked)) continue;
            if (handlerFor(c.type)?.validate(game, c) != null) continue;
            nextCmd = c;
            break;
          }
        }
      } catch (cmdrErr) {
        // 规则 2: 任何一个指挥官抛异常，只降级该指挥官，记录到日志，不得影响其他指挥官
        console.warn?.(`[HqAi] Commander ${cmdr.id} exception: ${cmdrErr?.message}, demoting commander.`);
        this.assignedCommanders.splice(i, 1);
        i--;
        continue;
      }

      if (nextCmd) {
        if (isCommandBlocked(nextCmd, blocked)) continue;
        const handler = handlerFor(nextCmd.type);
        if (handler?.validate && handler.validate(game, nextCmd) != null) {
          continue;
        }
        this._actionCount += 1;
        return [nextCmd];
      }
    }

    // 4. 所有单位行动与进攻完成后，统一执行防御性堆叠前排调整
    if (!this.frontArmyQueue) this.frontArmyQueue = [];
    if (this.frontArmyQueue.length === 0 && !this._frontAdjustedTurns?.has(turnKey)) {
      if (!this._frontAdjustedTurns) this._frontAdjustedTurns = new Set();
      this._frontAdjustedTurns.add(turnKey);
      if (this.model) {
        try {
          const frontParams = this.options?.params || (this.options?.stackFrontEnabled === false ? { stackFrontEnabled: false } : undefined);
          const frontCmds = planStackFrontCommands(this.model, country, { params: frontParams });
          if (frontCmds && frontCmds.length > 0) {
            this.frontArmyQueue.push(...frontCmds);
          }
        } catch (e) {
          console.warn?.(`[HqAi] planStackFrontCommands error: ${e?.message}`);
        }
      }
    }

    while (this.frontArmyQueue.length > 0) {
      const nextCmd = this.frontArmyQueue.shift();
      if (isCommandBlocked(nextCmd, blocked)) continue;
      const handler = handlerFor(nextCmd.type);
      if (handler?.validate && handler.validate(game, nextCmd) != null) {
        continue;
      }
      this._actionCount += 1;
      return [nextCmd];
    }

    return [];
  }
}

export default HqAi;
