// Auto Play Mode: delegates player turn actions to HqAi (fuse_3) using performAction / commandsForTurn
import { StrongAi } from './ai/strong.js';
import { HqAi } from './ai/hq/index.js';
import { performAction } from './api/actions.js';
import { describeCommand, describeBlocked } from './describe.js';
import { isDiplomacyCommand, diplomacyKey, reportTakeoverChoice, DIPLOMACY_COOLDOWN_ROUNDS, MAX_DIPLOMACY_PROMPTS_PER_ROUND } from './takeover_diplomacy.js';

export class AutoPlayer {
  constructor(options = {}) {
    this.enabled = false;
    this.strongAi = new HqAi();
    this.blocked = new Set();
    this.maxActionsPerTurn = options.maxActionsPerTurn || 40;
    this.actionsThisTurn = 0;
    this.lastActionTime = 0;
    this.actionInterval = options.actionInterval || 250; // ms per step for visual smoothness
    this.statusText = '准备就绪';
    this.totalActionsPerformed = 0;
    this.onAction = options.onAction || null;
    this.onEndTurn = typeof options.onEndTurn === 'function' ? options.onEndTurn : null;
    this.onDiplomacy = typeof options.onDiplomacy === 'function' ? options.onDiplomacy : null;
    this.diplomacyPending = null;
    this.diplomacyCooldown = new Map();
    this.diplomacyPromptRound = null;
    this.diplomacyPrompts = 0;
  }

  start() {
    this.enabled = true;
    this.blocked.clear();
    this.actionsThisTurn = 0;
    this.statusText = '自动游玩中';
  }

  stop() {
    this.enabled = false;
    this.statusText = '已暂停接管';
  }

  toggle() {
    if (this.enabled) this.stop();
    else this.start();
    return this.enabled;
  }

  perform(game, command) {
    this.onAction?.(command, game);
    const prev = game?._inAutoPlay;
    if (game) game._inAutoPlay = true;
    try {
      if (isDiplomacyCommand(command)) {
        command.staff = true;
        if (!command.reason) command.reason = 'staff';
      }
      return performAction(game, command);
    } finally {
      if (game) game._inAutoPlay = prev;
    }
  }

  promptEvent(game, event) {
    if (!this.enabled || !this.onDiplomacy || event?.type !== 'decision') return false;
    if (this.diplomacyPending?.event?.id === event.id) return true;
    if (this.diplomacyPending) return true;
    const request = { kind: 'event', event };
    this.diplomacyPending = request;
    this.statusText = '等待玩家外交决断';
    this.onDiplomacy(request, choiceId => {
      if (this.diplomacyPending !== request) return;
      const choice = event.choices?.find(item => item.id === choiceId);
      if (!choice) return;
      const result = this.perform(game, { type: 'resolveEventDecision', country: game.player, eventId: event.id, choiceId });
      if (!result?.ok) return result;
      if (result?.ok) reportTakeoverChoice(game, `${event.title || '事件'}：玩家选择${choice.text}`, [game.player]);
      this.diplomacyPending = null;
      this.statusText = '自动游玩中';
    });
    return true;
  }

  promptCommand(game, command) {
    if (!this.onDiplomacy || !isDiplomacyCommand(command)) return false;
    const round = game.round || 1;
    if (this.diplomacyPromptRound !== round) { this.diplomacyPromptRound = round; this.diplomacyPrompts = 0; }
    const key = diplomacyKey(command, game.player);
    if ((this.diplomacyCooldown.get(key) || 0) > round || this.diplomacyPrompts >= MAX_DIPLOMACY_PROMPTS_PER_ROUND) {
      this.actionsThisTurn++;
      return true;
    }
    const request = { kind: 'command', command };
    this.diplomacyPending = request;
    this.diplomacyPrompts++;
    this.actionsThisTurn++;
    this.statusText = '等待玩家外交决断';
    this.onDiplomacy(request, approved => {
      if (this.diplomacyPending !== request) return;
      if (approved) {
        const result = this.perform(game, command);
        reportTakeoverChoice(game, `玩家同意参谋建议：${describeCommand(command, game)}（${command.type}，${command.state || command.action || ''}）${result?.ok ? '' : '，执行失败'}`, [game.player, command.second || command.first].filter(Boolean));
      } else {
        this.diplomacyCooldown.set(key, round + DIPLOMACY_COOLDOWN_ROUNDS);
        reportTakeoverChoice(game, `玩家拒绝参谋建议：${describeCommand(command, game)}（${command.type}，${command.state || command.action || ''}）`, [game.player, command.second || command.first].filter(Boolean));
      }
      this.diplomacyPending = null;
      this.statusText = '自动游玩中';
    });
    return true;
  }

  // Execute one step of action
  step(game) {
    if (!this.enabled || !game || game.phase === 'finished') return null;
    if (this.diplomacyPending) return null;
    if (game.activeCountry !== game.player) {
      this.statusText = '等待其他国家回合';
      return null;
    }

    // 1. If there are pending scenario notices or decisions, resolve automatically to prevent blocking
    if (game.scenarioEvents?.pending?.length > 0) {
      const topEv = game.scenarioEvents.pending.find(event => !event.targetCountry || event.targetCountry === game.player);
      if (!topEv) return null;
      if (topEv.type === 'decision' && topEv.choices?.length > 0) {
        if (this.promptEvent(game, topEv)) return { ok: true, pending: true };
        const choice = topEv.choices[0];
        const res = this.perform(game, {
          type: 'resolveEventDecision',
          country: game.player,
          eventId: topEv.id,
          choiceId: choice.id,
        });
        this.totalActionsPerformed++;
        this.statusText = `自动决策: ${choice.text}`;
        return res;
      } else {
        game.addReport?.({ category: 'scenario', kind: 'notice', actors: [game.player], text: `托管确认通知：${topEv.title || topEv.id}`, importance: 1 });
        const res = this.perform(game, {
          type: 'resolveEventNotice',
          eventId: topEv.id,
        });
        this.totalActionsPerformed++;
        this.statusText = `自动确认: ${topEv.title}`;
        return res;
      }
    }

    // 2. Fetch next command from StrongAi
    if (this.actionsThisTurn >= this.maxActionsPerTurn) {
      this.statusText = '达到步数上限，自动结束回合';
      return this.endPlayerTurn(game);
    }

    const cmds = this.strongAi.commandsForTurn(game, game.player, this.blocked);
    if (!cmds || cmds.length === 0) {
      this.statusText = '本回合行动完成，结束回合';
      return this.endPlayerTurn(game);
    }

    const cmd = cmds[0];
    if (this.promptCommand(game, cmd)) return { ok: true, pending: !!this.diplomacyPending };
    const res = this.perform(game, cmd);
    this.actionsThisTurn++;
    this.totalActionsPerformed++;

    if (!res.ok) {
      this.blocked.add(cmd.type === 'useCard' ? `recruit:${cmd.target}:${cmd.card}` : cmd.armyId || cmd.from);
      this.statusText = `动作受阻: ${describeBlocked(res.reason)}`;
    } else {
      this.statusText = `自动执行: ${describeCommand(cmd, game)}`;
    }
    return res;
  }

  // Battle scene passes onEndTurn → battle.endTurn() → aiTurnRunner (country-by-country playback).
  // Headless tools/tests construct AutoPlayer without a callback and keep the instant performAction path.
  endPlayerTurn(game) {
    this.actionsThisTurn = 0;
    this.blocked.clear();
    if (this.onEndTurn) {
      this.onEndTurn();
      return { ok: true };
    }
    return this.perform(game, { type: 'endTurn' });
  }
}
