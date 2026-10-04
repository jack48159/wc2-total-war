// AI Turn Visualizer & Stepper
// Runs AI turns country-by-country and command-by-command with smooth delay,
// triggering walking/attack animations, with speed-up and skip controls.

import { E } from '../../../core/index.js';
import { countryGameView } from '../../../game/rules/visibility.js';
import {
  beginCountry,
  endCountry,
  getAiTurnSequence,
  isDormantNeutral,
  advanceRound,
  finishRoundTransition
} from '../../../game/rules/turn.js';
import { getUnitName } from '../../../game/api/names.js';
import { World } from '../../../game/world.js';
import { BridgeController, bridgeStateHash } from '../../../game/bridge_controller.js';
import { Danmaku } from '../../../ui/danmaku.js';
import {
  playerCountryName,
  describeCommand,
  commandFocusArea,
} from '../../../game/describe.js';

const SERIF = E.CJK_SERIF;
const INK = '#2a1d12';
const MANUAL_CAMERA_PAUSE_MS = 3000;

const BRIDGE_GIVEUP_MS = 120000;   // 桥连不上/不同步：持续重试满 2 分钟才改用内置 AI

export class AiTurnRunner {
  constructor(battle) {
    this.battle = battle;
    this.running = false;
    this.orderBannerUntil = 0;
    this.seq = [];
    this.seqIndex = 0;
    this.countryBegun = false;
    this.roundAdvancedForItem = false;
    this.actionIndex = 0;
    this.blocked = new Set();
    this.advancedRound = false;
    this.speedMultiplier = 1; // 1, 2, 4 or 8
    this.stepDelay = 220;     // ms per action
    this.skipKind = null;
    this.skipRemaining = 0;
    this.lastStepTime = 0;
    this.statusText = '准备中';
    this.statusCountry = '';
    this.statusStep = 0;
    this.currentCountry = null;
    this.fade = 1;
    this.pan = null;
    this.manualCameraUntil = 0;
    this.bannerOffset = { x: 0, y: 0 };
    this.bannerDrag = null;
    this.paper = null;
    E.image('assets/board_paper-568h@2x.webp').then(img => { this.paper = img; }).catch(() => {});
  }

  get game() {
    return this.battle.game;
  }

  get playerRunning() {
    return !this.running && !this.bridgedPlayer && this.battle.autoPlayer.enabled && this.game?.activeCountry === this.game.player && this.game.phase !== 'finished';
  }

  get bridgedPlayer() { return !!this.battle.bridgeEnabled && this.battle.bridgeCountries?.includes(this.game?.player); }

  get active() { return this.running || this.playerRunning || performance.now() < this.orderBannerUntil; }
  get blocksInput() { return this.running || this.playerRunning || (this.bridgedPlayer && this.game?.phase === 'playing'); }

  announce(command, country, step) {
    // Resolve the unit before applying the command: it may move or die.
    const area = this.game.stage.st(command.from);
    const unit = area?.armies?.find(a => a.id === command.armyId) || area?.armies?.[0];
    const subject = unit ? getUnitName(unit.type) : playerCountryName(country, this.game.stage);
    this.setCountryBanner(country, `${subject}  ${describeCommand(command, this.game)}`, step);
    this.maybePanTo(commandFocusArea(command));
    if (!this.running && !this.playerRunning) this.orderBannerUntil = performance.now() + 1800;
  }

  stepPlayer() {
    if (!this.playerRunning || this.battle.dialog || this.battle.opening) return;
    // In multiplayer, plan the next AI action from the confirmed server state.
    // Otherwise it can repeat one action against a snapshot that has not changed yet.
    if (this.battle.options.multiplayerRoom && (this.battle.mpSending || this.battle.mpTurnEnding)) return;
    this.battle.autoPlayer.step(this.game);
  }

  startBridgedPlayer() {
    if (!this.bridgedPlayer || this.running || this.game?.phase !== 'playing' || this.game.activeCountry !== this.game.player || this.game.stage.countries.get(this.game.player)?.eliminated) return;
    this.start(true);
  }

  start(includePlayer = false) {
    if (this.running || !this.game || this.game.activeCountry !== this.game.player) return;
    this.battle.disarmSelection?.();
    if (!includePlayer) endCountry(this.game, this.game.player);
    this.seq = includePlayer ? [{ country: this.game.player }, ...getAiTurnSequence(this.game)] : getAiTurnSequence(this.game);
    this.seqIndex = 0;
    // The player's turn was already begun by initialization or finishRoundTransition.
    this.countryBegun = includePlayer;
    this.roundAdvancedForItem = false;
    this.actionIndex = 0;
    this.blocked.clear();
    this.bridgeTurn = null;
    this.bridgeFallback = false;
    this.advancedRound = false;
    this.running = true;
    this.lastStepTime = performance.now();
    this.statusText = '战事推进中：轮候各国行动…';
    this.statusCountry = '';
    this.statusStep = 0;
    this.currentCountry = null;
    this.fade = 1;
    this.pan = null;
    this.manualCameraUntil = 0;
    E.playSfx('select.wav');
  }

  stop() {
    this.running = false;
    this.skipKind = null;
    this.countryBegun = false;
    this.statusText = '回合结束';
    this.pan = null;
    this.battle.select(this.battle.sel);
  }

  toggleSpeed() {
    this.speedMultiplier = this.speedMultiplier === 8 ? 1 : this.speedMultiplier * 2;
    E.playSfx('btn.wav');
  }

  manualCamera() {
    if (!this.blocksInput) return;
    this.pan = null;
    this.manualCameraUntil = performance.now() + MANUAL_CAMERA_PAUSE_MS;
  }

  get followCamera() {
    return E.state.aiFollowCamera ?? (localStorage.getItem('wc2-ai-follow-camera') !== 'false');
  }

  skip() {
    if (!this.active || this.battle.dialog || this.battle.opening) return;
    E.playSfx('btn.wav');
    // A full turn can contain hundreds of HqAi decisions. Drain it across
    // animation frames so the canvas and input stay responsive.
    this.skipKind = this.playerRunning ? 'player' : 'ai';
    this.skipRemaining = 1000;
  }

  setCountryBanner(country, text, step = 0) {
    if (country !== this.currentCountry) {
      this.currentCountry = country;
      this.fade = 0;
    }
    this.statusCountry = playerCountryName(country, this.game.stage);
    this.statusText = text;
    this.statusStep = step;
  }

  maybePanTo(areaId) {
    if (!this.followCamera || performance.now() < this.manualCameraUntil) return;
    const cam = this.battle.cam;
    if (!cam || areaId == null) return;
    const a = World.areas?.[areaId];
    const pt = a?.pts?.[0];
    if (!pt) return;
    const s = cam.toScreen(pt[0], pt[1]);
    const pad = 140;
    if (s.x >= pad && s.x <= E.W - pad && s.y >= pad && s.y <= E.H - pad) return;
    this.pan = { x0: cam.x, y0: cam.y, x1: pt[0], y1: pt[1], t: 0, dur: 0.42 };
  }

  panToCountry(country) {
    const st = this.game.stage;
    const owned = st.areas.filter(a => a.country === country);
    const withArmy = owned.find(a => a.armies?.length) || owned[0];
    if (withArmy) this.maybePanTo(withArmy.id);
  }

  step() {
    if (!this.running || !this.game || this.game.phase === 'finished') {
      this.stop();
      return;
    }

    if (this.seqIndex >= this.seq.length) {
      finishRoundTransition(this.game, this.advancedRound);
      this.stop();
      return;
    }

    const item = this.seq[this.seqIndex];
    if (item.advanceRoundBefore && !this.roundAdvancedForItem) {
      advanceRound(this.game);
      this.advancedRound = true;
      this.roundAdvancedForItem = true;
      if (this.game.phase === 'finished') {
        this.stop();
        return;
      }
    }

    const st = this.game.stage;
    const countryInfo = st.countries.get(item.country);
    if (countryInfo?.eliminated || isDormantNeutral(this.game, item.country)) {
      this.seqIndex++;
      this.countryBegun = false;
      this.roundAdvancedForItem = false;
      return;
    }

    if (!this.countryBegun) {
      beginCountry(this.game, item.country);
      this.countryBegun = true;
      this.actionIndex = 0;
      this.blocked.clear();
      this.bridgeTurn = null;
      this.bridgeFallback = false;
      const name = playerCountryName(item.country, st);
      this.setCountryBanner(item.country, `${name}行动`, 0);
      this.panToCountry(item.country);
      return;
    }

    const activeController = this.game.controllers?.get(item.country);
    const bridged = activeController instanceof BridgeController;
    if (bridged && !this.bridgeFallback) {
      if (!this.bridgeTurn) {
        this.bridgeTurn = { status: 'waiting', started: Date.now(), commands: [], index: 0 };
        this.pollBridge(activeController);
      }
      const turn = this.bridgeTurn;
      if (turn.status === 'error') return;
      if (turn.status !== 'ready') return;
      // 一个一个地连续回放：每条命令间隔 stepMs，弹幕随进度逐条出现，最后停一下再结束回合
      const stepMs = Math.max(200, Number(E.state.bridgeStepMs) || 1100) / (2 * this.speedMultiplier), now = performance.now();
      const showNotes = upTo => {
        const notes = turn.notes || [], who = playerCountryName(item.country, this.game.stage);
        while (turn.notesShown < notes.length && turn.notesShown < upTo) {
          const n = notes[turn.notesShown++];
          Danmaku.push([{ who: n.label ? `${who}·${n.label}` : who, text: n.reason }], 1);
        }
      };
      if (now < (turn.nextAt || 0)) return;
      if (!turn.sepShown) { turn.sepShown = true; try { Danmaku.turn(`第 ${this.game.round} 回合 · ${playerCountryName(item.country, this.game.stage)}`); } catch (e) {} }
      if (turn.index < turn.commands.length) {
        const total = turn.commands.length, nn = (turn.notes || []).length, b = this.battle;
        const command = turn.commands[turn.index];
        // 像玩家自己操作一样演示：先“选中单位/打开商城选卡”(有音效和箭头/落点高亮)，停一下，再真正执行
        const unitCmd = (command.type === 'move' || command.type === 'attack') && command.from != null;
        const cardCmd = command.type === 'useCard';
        const buyCmd = cardCmd && command.pendingPurchase;
        if (!turn.phase) turn.phase = unitCmd ? 'select' : cardCmd ? 'target' : 'apply';
        if (turn.phase === 'shop') {
          this.announce(command, item.country, turn.index + 1);
          try { b.showShopPreview?.(command.card, item.country); E.playSfx('pop.wav'); } catch (e) {}
          turn.phase = 'target'; turn.nextAt = now + Math.round(stepMs * 0.9); return;
        }
        if (turn.phase === 'target') {
          try { b.hideShopPreview?.(); if (buyCmd) E.playSfx('buy.wav'); else E.playSfx('select.wav'); b.enterCardMode(command.card, !!command.pendingPurchase); } catch (e) {}
          this.announce(command, item.country, turn.index + 1);
          turn.phase = 'apply'; turn.nextAt = now + Math.round(stepMs * 0.8); return;
        }
        if (turn.phase === 'select') {
          try { b.select(command.from); E.playSfx('select.wav'); } catch (e) {}
          this.announce(command, item.country, turn.index + 1);
          turn.phase = 'apply'; turn.nextAt = now + Math.round(stepMs * 0.9); return;
        }
        showNotes(nn ? Math.min(nn, Math.floor(turn.index * nn / total) + 1) : 0);
        turn.index++; turn.phase = null;
        turn.nextAt = now + stepMs;
        this.announce(command, item.country, turn.index);
        const res = this.game.apply(command);
        try { if (unitCmd) b.select(-1); if (cardCmd) b.cancelCardMode(); } catch (e) {}
        if (!res.ok) {
          console.error('[WC2 bridge] command rejected', command, res);
          this.failBridge(turn, item.country, `桥接命令失败：${res.reason || command.type}`);
        }
        return;
      }
      if (!turn.finishing) {
        turn.finishing = true; showNotes(Infinity); turn.nextAt = now + Math.round(stepMs * 1.2);
        return;
      }
      const actual = bridgeStateHash(this.game);
      if (actual !== turn.hash) {
        console.error('[WC2 bridge] state diverged', { actual, expected: turn.hash });
        try { activeController.request('debug', { turnId: turn.turnId, actual, expected: turn.hash, commands: turn.commands, snapshot: this.game.snapshot() }).catch(() => {}); } catch (e) {}
        this.failBridge(turn, item.country, '桥接状态不同步');
        return;
      }
      if (turn.endSnapshot) {
        this.game.visibilityMemory = turn.endSnapshot.visibilityMemory;
        this.game.reportLog = turn.endSnapshot.reportLog;
        this.game.nextReportId = turn.endSnapshot.nextReportId;
        this.game.reportRevision = turn.endSnapshot.reportRevision;
      }
      endCountry(this.game, item.country);
      this.seqIndex++; this.countryBegun = false; this.roundAdvancedForItem = false;
      this.bridgeTurn = null;
      return;
    }
    const controller = bridged ? (this.battle.bridgeBuiltinControllers?.get(item.country) || this.battle.bridgeBuiltinController) : activeController;
    const maxActions = controller?.maxActions || 40;

    if (this.actionIndex >= maxActions) {
      endCountry(this.game, item.country);
      this.seqIndex++;
      this.countryBegun = false;
      this.roundAdvancedForItem = false;
      return;
    }

    const controllerGame = this.game.fogOfWar ? countryGameView(this.game, item.country) : this.game;
    const command = controller?.commandsForTurn?.(controllerGame, item.country, this.blocked)?.[0];
    if (!command) {
      endCountry(this.game, item.country);
      this.seqIndex++;
      this.countryBegun = false;
      this.roundAdvancedForItem = false;
      return;
    }

    this.announce(command, item.country, this.actionIndex + 1);
    // 内置 AI 的外交提议必须带 aiIssued，才会走"需要人类/接管方同意"的待决事件(否则停战/结盟被强行生效)；与 rules/turn.js 的无头流程保持一致
    const isDipl = command.type === 'setDiplomacy' || command.type === 'proposeDiplomacy';
    const res = this.game.apply(isDipl ? { ...command, aiIssued: true } : command);
    if (isDipl && command.second === this.game.player && item.country !== this.game.player &&
        ((command.type === 'setDiplomacy' && ['peace', 'alliance'].includes(command.state)) ||
         (command.type === 'proposeDiplomacy' && ['peace', 'alliance', 'nap'].includes(command.action)))) {
      this.blocked.add(`consent:${command.type}:${command.first}:${command.second}:${command.state || command.action}`);
    }
    this.actionIndex++;
    if (this.game.phase === 'finished') {
      this.stop();
      return;
    }

    if (!res.ok) {
      this.blocked.add(command.type === 'useCard' ? `recruit:${command.target}:${command.card}` : command.armyId);
    }


  }

  // 向桥申请回合并等待 LLM 的结果。任何网络/桥异常都先自动重试(退避)，回合丢失(桥重启/被取消)会重新发起；
  // 真正无法继续时进入 error，并在几秒后自动改用内置 AI，避免整局卡死。
  async pollBridge(controller) {
    const turn = this.bridgeTurn, country = controller.country;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let failures = 0, firstFailAt = 0;   // 连续失败超过 BRIDGE_GIVEUP_MS 才放弃(改用内置 AI)，期间一直重试同步
    while (this.bridgeTurn === turn && turn.status === 'waiting') {
      try {
        if (!turn.turnId) {
          turn.turnId = await controller.startTurn();
          this.setCountryBanner(country, '等待 LLM 对手决策…', 0);
        }
        if (Date.now() - turn.started > this.battle.bridgeTimeoutMinutes * 60000) {
          if (E.state.bridgeTimeoutAction === 'fallback') { this.fallbackBridge(); return; }
          turn.status = 'timeout'; this.setCountryBanner(country, 'LLM 对手超时，请改用内置 AI 或继续等待'); return;
        }
        const result = await controller.result(turn.turnId);
        failures = 0; firstFailAt = 0;
        if (this.bridgeTurn !== turn) return;
        if (result.waiting) continue;
        turn.commands = result.commands || [];
        turn.notes = (result.notes && result.notes.length) ? result.notes : (result.summary ? [{ label: '本回合总结', reason: result.summary }] : []);
        turn.notesShown = 0; turn.nextAt = 0;
        turn.hash = result.endState?.hash;
        turn.endSnapshot = result.endSnapshot;
        turn.index = 0; turn.status = 'ready';
        this.setCountryBanner(country, 'LLM 对手正在行动', 0);
      } catch (error) {
        if (this.bridgeTurn !== turn) return;
        if (error?.code === 'turn-lost') { turn.turnId = null; failures = 0; firstFailAt = 0; await sleep(500); continue; }   // 桥重启或回合被取消：重新发起
        failures++; if (!firstFailAt) firstFailAt = Date.now();
        const lost = Date.now() - firstFailAt;
        if (lost >= BRIDGE_GIVEUP_MS) { this.failBridge(turn, country, `LLM 对手未连接：${error.message}`); return; }
        this.setCountryBanner(country, `LLM 对手连接异常（${error.message}），继续重试同步…（${Math.max(0, Math.ceil((BRIDGE_GIVEUP_MS - lost) / 1000))} 秒后才改用内置 AI）`);
        await sleep(Math.min(5000, 800 * failures));
      }
    }
  }
  // 回放或同步失败时保持当前回合，只有用户明确选择后才改用内置 AI。
  failBridge(turn, country, text) {
    turn.status = 'error';
    this.setCountryBanner(country, text);
  }
  fallbackBridge() {
    const turn = this.bridgeTurn;
    const country = this.seq[this.seqIndex]?.country;
    const ctrl = this.game.controllers?.get(country);
    if (ctrl?.fallback) {
      ctrl.fallback(turn?.turnId);
    } else if (turn?.turnId) {
      this.battle.bridgeController?.request('cancel', { turnId: turn.turnId }).catch(() => {});
    }
    this.bridgeFallback = true;
    this.bridgeTurn = null;
    this.setCountryBanner(country, '本回合改用内置 AI');
  }

  update(dt) {
    if (!this.active || this.battle.dialog || this.battle.opening) {
      if (!this.active) this.skipKind = null;
      return;
    }
    if (this.bridgeTurn?.status === 'waiting') {
      const left = Math.max(0, Math.ceil(this.battle.bridgeTimeoutMinutes * 60 - (Date.now() - this.bridgeTurn.started) / 1000));
      this.setCountryBanner(this.seq[this.seqIndex]?.country, `等待 LLM 对手决策… ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }
    if (this.playerRunning && this.currentCountry !== this.game.player) this.setCountryBanner(this.game.player, '我军开始托管行动', 0);
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.28);
    if (this.pan && !this.followCamera) this.pan = null;
    if (this.pan && performance.now() >= this.manualCameraUntil) {
      const cam = this.battle.cam;
      this.pan.t += dt;
      const k = Math.min(1, this.pan.t / this.pan.dur);
      const e = k * k * (3 - 2 * k);
      cam.x = this.pan.x0 + (this.pan.x1 - this.pan.x0) * e;
      cam.y = this.pan.y0 + (this.pan.y1 - this.pan.y0) * e;
      cam.clamp?.();
      if (k >= 1) this.pan = null;
    }
    if (this.skipKind) {
      const player = this.skipKind === 'player';
      const deadline = performance.now() + 6;
      while ((player ? this.playerRunning : this.running) && !this.battle.dialog && this.skipRemaining > 0 && performance.now() < deadline) {
        if (player && this.battle.options.multiplayerRoom && (this.battle.mpSending || this.battle.mpTurnEnding)) break;
        if (player) this.stepPlayer(); else this.step();
        this.skipRemaining--;
      }
      if (!(player ? this.playerRunning : this.running) || this.skipRemaining <= 0) {
        // Exhausting the fast-forward budget only stops fast-forward, not the turn.
        this.skipKind = null;
      }
      this.lastStepTime = performance.now();
      return;
    }
    const now = performance.now();
    const delay = this.stepDelay / this.speedMultiplier;
    // A slow synchronous action must not accumulate playback debt. Show at most
    // one action per frame, then start the next delay after that action ends.
    if (now - this.lastStepTime >= delay && (this.running || this.playerRunning)) {
      if (this.running) this.step(); else this.stepPlayer();
      this.lastStepTime = performance.now();
    }
  }

  geom() {
    const takeover = this.battle.autoPlayer.enabled || !!this.bridgeTurn;
    if (E.platform?.isTouch) {
      // 触屏：播报条默认在屏幕上方正中(不挡右上角暂停)，做成细条：高 32pt、按钮 26pt；字号用 pt 换算
      const pt = n => n * (E.view?.dpr || 1) / (E.view?.scale || 1);
      const bw = Math.min(E.W - pt(140), takeover ? pt(430) : pt(360)), bh = pt(32), bH = pt(26), pad = (bh - bH) / 2;
      const bx = E.clamp((E.W - bw) / 2 + this.bannerOffset.x, 0, E.W - bw), by = E.clamp(pt(4) + this.bannerOffset.y, 0, E.H - bh);
      const w = pt(58), wide = pt(70), right = bx + bw - pad - pt(2);
      const stopBtn = takeover ? { x: right - wide, y: by + pad, w: wide, h: bH } : null;
      const skipBtn = { x: (stopBtn?.x ?? right) - pt(5) - wide, y: by + pad, w: wide, h: bH };
      const speedBtn = { x: skipBtn.x - pt(5) - w, y: by + pad, w, h: bH };
      return { bx, by, bw, bh, speedBtn, skipBtn, stopBtn, touch: true, pt };
    }
    const hitSize = Math.max(44, Math.ceil(44 * (E.view?.dpr || 1) / (E.view?.scale || 1)));
    const bw = Math.min(E.W, takeover ? 850 : 710), bh = hitSize + 20;
    const bx = E.clamp((E.W - bw) / 2 + this.bannerOffset.x, 0, E.W - bw);   // 用户：默认放在屏幕上方正中
    const by = E.clamp(10 + this.bannerOffset.y, 0, E.H - bh);
    const w = Math.max(100, hitSize), wide = Math.max(106, hitSize), right = bx + bw - 12;
    const stopBtn = takeover ? { x: right - wide, y: by + 10, w: wide, h: hitSize } : null;
    const skipBtn = { x: (stopBtn?.x ?? right) - 10 - wide, y: by + 10, w: wide, h: hitSize };
    const speedBtn = { x: skipBtn.x - 10 - w, y: by + 10, w, h: hitSize };
    return { bx, by, bw, bh, speedBtn, skipBtn, stopBtn };
  }

  down(p) {
    if (!this.active) return false;
    if (!this.running && !this.playerRunning) { this.orderBannerUntil = 0; return true; }
    const { bx, by, bw, bh, speedBtn, skipBtn, stopBtn } = this.geom();
    if (stopBtn && p.x >= stopBtn.x && p.x <= stopBtn.x + stopBtn.w && p.y >= stopBtn.y && p.y <= stopBtn.y + stopBtn.h) { if (this.bridgeTurn) this.fallbackBridge(); else this.battle.stopAutoPlay(); return true; }
    if (p.x < bx || p.x > bx + bw || p.y < by || p.y > by + bh) {
      return false;
    }
    if (p.x >= speedBtn.x && p.x <= speedBtn.x + speedBtn.w && p.y >= speedBtn.y && p.y <= speedBtn.y + speedBtn.h) {
      this.toggleSpeed();
      return true;
    }
    if (p.x >= skipBtn.x && p.x <= skipBtn.x + skipBtn.w && p.y >= skipBtn.y && p.y <= skipBtn.y + skipBtn.h) {
      if (this.bridgeTurn?.status === 'timeout') { this.bridgeTurn.status = 'waiting'; this.bridgeTurn.started = Date.now(); this.pollBridge(this.game.controllers.get(this.seq[this.seqIndex]?.country)); }
      else if (!this.bridgeTurn) this.skip();
      return true;
    }
    this.startBannerDrag(p);
    return true;
  }

  startBannerDrag(p) {
    const { bx, by, bw, bh } = this.geom();
    if (p.x < bx || p.x > bx + bw || p.y < by || p.y > by + bh) return false;
    this.bannerDrag = { x: p.x, y: p.y, bx, by };
    return true;
  }

  moveBannerDrag(p) {
    if (!this.bannerDrag) return false;
    const { x, y, bx, by } = this.bannerDrag;
    const { bw, bh } = this.geom();
    this.bannerOffset.x += E.clamp(bx + p.x - x, 0, E.W - bw) - this.geom().bx;
    this.bannerOffset.y += E.clamp(by + p.y - y, 0, E.H - bh) - this.geom().by;
    return true;
  }

  endBannerDrag() {
    const wasDragging = !!this.bannerDrag;
    this.bannerDrag = null;
    return wasDragging;
  }

  drawButton(frame, r, label, stroke) {
    const hover = E.pointer.x >= r.x && E.pointer.x <= r.x + r.w && E.pointer.y >= r.y && E.pointer.y <= r.y + r.h;
    if (frame) {
      const s = Math.min(r.w / frame.w, r.h / frame.h);
      E.drawFrame(frame,
        r.x + (r.w - frame.w * s) / 2 + frame.rx * s,
        r.y + (r.h - frame.h * s) / 2 + frame.ry * s,
        { scale: s, noLayout: true, filter: hover ? 'brightness(1.12)' : 'none' });
    } else {
      E.panel(r.x, r.y, r.w, r.h, { fill: hover ? '#5e4324' : '#453018', stroke: '#d8b66c', lineWidth: 1.5, r: 6 });
    }
    E.text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, {
      size: this._fs ? this._fs(11) : 14, color: '#f4ecd6', stroke, strokeW: 4.5, align: 'center', font: SERIF,
    });
  }

  draw(c) {
    if (!this.active) return;
    const G = this.geom(), { bx, by, bw, bh, speedBtn, skipBtn, stopBtn } = G;
    const ui1 = this.battle.ui1;
    this._fs = G.touch ? G.pt : null;   // 触屏：按钮/文字字号按 pt 换算
    const army = this.battle.units?.army;

    c.save();
    c.globalAlpha = 0.55 + 0.45 * this.fade;

    c.beginPath();
    c.roundRect(bx, by, bw, bh, 8);
    c.save();
    c.clip();
      c.fillStyle = '#d8c4a0';
      c.fillRect(bx, by, bw, bh);
      if (this.paper) {
        const img = this.paper;
        const srcX = Math.min(24, Math.floor(img.width * 0.04));
        const srcW = Math.max(1, img.width - srcX * 2);
        const srcH = Math.max(1, Math.round(bh * srcW / bw));
        const srcY = Math.max(0, Math.floor((img.height - srcH) * 0.28));
        c.drawImage(img, srcX, srcY, srcW, Math.min(srcH, img.height - srcY), bx, by, bw, bh);
      }
    c.restore();

    c.strokeStyle = 'rgba(90, 58, 28, 0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(bx + 0.5, by + 0.5, bw - 1, bh - 1, 8);
    c.stroke();

    const flagKey = this.currentCountry && this.game.stage.countries.get(this.currentCountry)?.flag;
    const fl = flagKey && army ? army['flag_' + flagKey] : null;
    let textX = bx + 18;
    if (fl) {
      const fs = G.touch ? (bh - G.pt(10)) / fl.h : 0.36;
      E.drawFrame(fl, bx + (G.touch ? G.pt(6) : 12), by + (G.touch ? G.pt(5) : 8), { scale: fs, noRef: true, noLayout: true });
      textX = bx + (G.touch ? G.pt(6) : 12) + fl.w * fs + (G.touch ? G.pt(6) : 10);
    }

    c.save();
    c.beginPath();
    c.rect(textX, by, Math.max(0, speedBtn.x - textX - 10), bh);
    c.clip();
    if (G.touch) E.text(this.statusText + (this.statusStep > 0 ? `  · 第 ${this.statusStep} 步` : ''), textX, by + bh / 2 + G.pt(0.5), { size: G.pt(13), color: INK, bold: true, font: SERIF, base: 'middle' });
    else E.text(this.statusText, textX, by + (this.statusStep > 0 ? 24 : 30), { size: 18, color: INK, bold: true, font: SERIF });
    if (this.statusStep > 0 && !G.touch) {
      E.text(`第 ${this.statusStep} 步`, textX, by + 44, { size: 12, color: 'rgba(42,29,18,0.45)', font: SERIF });
    }
    c.restore();

    this.drawButton(ui1?.longgreen_normal, speedBtn,
      this.bridgeTurn ? `${2 * this.speedMultiplier}x 加速` : this.speedMultiplier === 1 ? '1x 正常' : `${this.speedMultiplier}x 加速`, '#25501f');
    this.drawButton(ui1?.longred_normal, skipBtn, this.bridgeTurn?.status === 'timeout' ? '继续等待' : this.bridgeTurn?.status === 'waiting' ? '等待中' : '跳过本回合', '#4a1e14');
    if (stopBtn) this.drawButton(null, stopBtn, this.bridgeTurn ? '改用内置 AI' : '停止接管', '#4a1e14');

    c.restore();
  }
}
