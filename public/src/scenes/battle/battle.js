// Battle scene: wires the pieces together and routes input. All state lives in `game` (src/game); drawing lives in
// MapRenderer / UnitRenderer / BattleHud / Opening / PauseMenu / CardShop; this class only decides who gets what.
import { E } from '../../core/index.js';
import { Page } from '../../ui/ui.js';
import { World } from '../../game/world.js';
import { Game } from '../../game/game.js';
import { BridgeController, newBridgeGameId, bridgeTransportUrl } from '../../game/bridge_controller.js';
import { Danmaku } from '../../ui/danmaku.js';
import { playerCountryName } from '../../game/describe.js';
import { LiveGames } from '../../game/live_games.js';
import { SaveStore } from '../../game/savestore.js';
import { Rng } from '../../game/rng.js';
import { shopCards } from '../../game/cards.js';
import { Camera } from './render/camera.js';
import { loadLeaders, drawLeader, seatExtent, LEADER } from './render/leaders.js';
import { applyRoom } from './render/rooms.js';
import { MapRenderer } from './render/map_renderer.js';
import { UnitRenderer, getGroupColor } from './render/unit_renderer.js';
import { BattleHud } from './ui/hud.js';
import { Opening } from './ui/opening.js';
import { PauseMenu } from './ui/pause_menu.js';
import { WarNoticeDialog } from './ui/war_notice.js';
import { DecisionDialog } from './ui/decision_dialog.js';
import { DiplomacyPrompt } from './ui/diplomacy_prompt.js';
import { AutoPlayer } from '../../game/auto_play.js';
import { HqAi } from '../../game/ai/hq/index.js';
import { ChainMenuDialog } from './ui/chain_menu.js';
import { ReplayControls } from './ui/replay_controls.js';
import { ResultDialog } from './ui/result_dialog.js';
import { AiTurnRunner } from './ui/ai_turn_runner.js';
import { CardShop } from './ui/card_shop.js';
import { AccessoryLayer, Library } from './render/accessories.js';
import { Decorator } from './ui/deco_mode.js';
import { Effects } from './render/effects.js';
import { ArmyPanel } from './ui/army_panel.js';
import { TalkDialog, loadPortrait, takeStageDialogue } from './ui/talk.js';
import { EV } from '../../game/events.js';
import { TARGET } from '../../game/stage.js';
import { handlerFor } from '../../game/commands.js';
import { LogStore } from '../../core/game_log.js';
import { Perf } from '../../core/perf.js';
import { countryGameView, rememberVisibility } from '../../game/rules/visibility.js';
import { desktopById, loadDesktops } from '../options.js';
import { frameDesktop } from './render/desk_frame.js';
import { CommandUI } from './ui/command_ui.js';
import { TheaterPanel } from './ui/theater_panel.js';
import { buildOrderPath } from '../../game/order_path.js';
import { MultiplayerClient, multiplayerRequest } from '../../game/multiplayer_client.js';
import { createOrderSketch, orderSketchPoint, orderSketchBack, orderSketchFinishAxis } from './ui/order_sketch.js';
import { OrderSettingsDialog, HighRiskWarningDialog } from './ui/order_settings.js';
import { HIGH_RISK_WIN_RATE_THRESHOLD } from '../../game/ai/hq/commander/verb_profile.js';

const BLINK_SECONDS = 3.6;   // our areas blink after the opening sequence
const PHOTO_TAPS = 4, TAP_GAP = 420;   // four taps only leave photo mode; entering uses the menu or a configured key
const TARGETED_CARDS = new Set([...Array.from({ length: 21 }, (_, id) => id), 22, 23, 24, 25, 26, 27, 28].filter(id => id !== 21));
// End-turn also runs other countries and server HqAi, so it remains server-driven.
// Every direct player command is applied locally before it is uploaded.

export class Battle extends Page {
  // stageName: data/stages/<name>.json; snapshot: from Game.snapshot() when loading a save
  constructor(stageName = 'battle_axis1', snapshot = null, options = {}) {
    super(); this.ownTouch = true; this.stageName = stageName; this.options = options; this.route = options.multiplayerRoom ? 'multiplayer/' + options.multiplayerRoom : 'battle/' + stageName; this.snapshotData = snapshot;
    this.showBack = true; this.hasOk = false; this.showMedals = false; this.multiplayerSpectator=!!options.multiplayerSpectator;
    this.sel = -1; this.blink = 0; this.mpTurnKey = null; this.drag = null; this.press = null; this.opening = null; this.cardTarget = null; this.cardPending = false;
    this.shopSelection = E.state.cardShopSelection || { tab: 'army' }; this.lastDragEndTime = 0; this.hudPressCandidate = null;
    this.autoBannerStep = 0;
    this.autoPlayer = new AutoPlayer({ onEndTurn: () => { this.autoBannerStep = 0; this.endTurn(); }, onAction: command => this.aiTurnRunner.announce(command, this.game.player, ++this.autoBannerStep), onDiplomacy: (request, decide) => {
      const close = () => { this.dialog = null; };
      if (request.kind === 'event') this.dialog = new DecisionDialog(this.game, request.event, { close, onChoice: decide });
      else this.dialog = new DiplomacyPrompt(this.game, request.command, answer => { decide(answer); close(); });
      E.playSfx('pop.wav');
    } });
    this.aiTurnRunner = new AiTurnRunner(this);
    this.orderUndoStack = [];
  }

  // the desk image chosen in Options (it may change while the battle is paused, see load())
  async loadDesk() {
    await loadDesktops();
    const deskId = E.state.desktopTexture || 'solid_wood_mahogany';
    const deskItem = desktopById(deskId);
    // an optional seamless tile of the same desk (assets/desktop/tiles/<id>.png): repeated at real size it is much sharper than one stretched photo
    this.deskTile = null;                                       // (a tiled desk was tried; it cost too much, so the whole desk photo is used again)
    return frameDesktop(await E.image(deskItem.file), 2048, deskItem.id);
  }
  // Coming back from Options / the save screen re-enters this same instance (init() does not run again): take up a changed desk
  // texture and rebuild the 3D desk, which dispose() released when the scene was left.
  async load() {
    const again = this._loaded;
    await super.load();
    if (!again) return;
    this.configureBridge();
    const img = await this.loadDesk();
    this.map.desktop = img;
    if (this.want3d && this.deskOn && this.l3dMod) {
      try { if (this.l3d) this.l3d.setDesk(img, this.deskTile); else this.l3d = this.l3dMod.Layer3D.create(this.cam, this.game.stage.bounds, img, this.acc, this.deskTile); } catch (e) { console.warn('3D desk disabled:', e); this.l3d = null; }
    }
    if (this.l3d) applyRoom(this.l3d);                                    // the room may have been changed in Options
    this.applyDeskView();
  }
  // 3D view on: the map (drawn flat, laid on the desk), the units (2D icons standing on it), the accessories and the desk share one perspective
  applyDeskView() { const on = this.deskOn && !!this.l3d; this.cam.desk3d = on; this.cam.tilt = on; }

  async ensureDesk3d() {
    if (!this.want3d || this.l3d) return;
    if (this.deskLoading) return this.deskLoading;
    this.deskLoading = (async () => {
      try {
        this.l3dMod = await import('./render/layer3d.js');
        if (this.leaving) return;
        this.l3d = this.l3dMod.Layer3D.create(this.cam, this.game.stage.bounds, this.map.desktop, this.acc, this.deskTile);
        applyRoom(this.l3d);
      } catch (e) { console.warn('3D desk disabled:', e); }
    })();
    try { await this.deskLoading; } finally { this.deskLoading = null; }
  }

  async init() {
    const resources = Promise.all([E.atlas('army_hd'), this.loadDesk(), Promise.all([1, 2, 3].map(i => E.image(`assets/box${i}_paper@2x.png`))), E.atlas('text_cn_hd')]);
    resources.catch(() => {}); // Observe failures while the independent game data is loading.
    const gameId = this.snapshotData?.gameId || this.options.bridge?.gameId || newBridgeGameId();
    const game = this.game = await Game.create(this.stageName, this.snapshotData, {
      ...this.options, fogOfWar: this.options.fogOfWar ?? (E.state.fogOfWar === true), medalLevels: E.state.medalLevels, gameId, logEnabled: E.state.logEnabled !== false,
      ownedCommanders: E.state.ownedCommanders || [], initialGameLog: LogStore.load(gameId),
      logSink: (id, packet) => packet.flush
        ? LogStore.sync(id, packet.entries, { stage: this.stageName })
        : LogStore.append(id, packet, { stage: this.stageName }),
    });
    this.bridgeCreatedAt = Date.now();
    // URL 带上对局 ID：刷新页面后按 ID 恢复原对局；对战桥/MCP 用的对局 ID 也不变
    if (!this.options.multiplayerRoom && game.gameId) this.route = `battle/${this.stageName}/${game.gameId}`;
    if (game.gameId) Danmaku.attach(game.gameId);   // 同一对局的弹幕历史在离开/刷新后恢复
    this.bridgeEnabled = !this.options.multiplayerRoom && ((this.options.bridge?.enabled === true) || new URLSearchParams(location.search).has('llmOpponent'));
    this.configureBridge();
    this.hydrateDanmakuFromBridge(game);
    clearInterval(this.sayTimer); this.sayTimer = setInterval(() => this.pollSays(), 2500);
    E.state.lastPlayedCountry = game.player; E.saveState();
    const stage = game.stage;
    const [army, desktop, paperBorder, txt] = await resources;
    this.txt = txt;
    this.cam = new Camera(stage.bounds);
    // camera starts on the middle of the stage's areas
    let sx = 0, sy = 0; for (const id of stage.data.enabled) { const p = World.areas[id].pts[0]; sx += p[0]; sy += p[1]; }
    this.cam.x = sx / stage.data.enabled.length; this.cam.y = sy / stage.data.enabled.length; this.cam.clamp();
    this.portraitMenu = new TheaterPanel({game,battle:this,close:()=>{this.portraitMenu.menu=null;}});
    this.map = new MapRenderer(game, this.cam, { army, desktop, paperBorder });
    const mapReady = this.map.preload();
    this.acc = new AccessoryLayer(this.cam, stage.bounds);             // desk accessories (Pause > 摆件); drawn between map and units
    await Library.ready(); await Promise.all(this.acc.items.map(it => Library.load(it.id)));
    this.units = new UnitRenderer(game, this.cam, army);
    this.units.map = this.map;
    this.leaders = [];
    const leadersReady = loadLeaders(stage).then(leaders => { this.leaders = leaders; }).catch(() => {});
    // dragging left / right may go as far as the side leaders' chairs (camera.js stayAtTable)
    this.cam.sideSeats = () => this.leaders.map(L => seatExtent(L, this.acc.desk(), this.cam.upm)).filter(Boolean);
    // The 3D desk (layer3d.js): the desk, the room and the accessories outside the flat 2D map get the standing player's perspective. The map
    // and the units are the original 2D. Optional: if three.js fails to load the game keeps the flat top-down desk. `?flat` starts without
    // it; V toggles.
    this.want3d = !new URLSearchParams(location.search).has('flat'); this.deskOn = new URLSearchParams(location.search).has('3d');   // a battle opens in 2D (?3d: in 3D, for tests); V / the pause menu switch
    if (this.deskOn) await Promise.all([this.ensureDesk3d(), leadersReady]);
    this.applyDeskView();
    this.perfExtra = () => ({ mode: this.cam.desk3d ? '3D' : 'flat', zoom: +this.cam.zoom.toFixed(2), sel: this.sel, dialog: this.dialog ? this.dialog.constructor.name : null, opening: !!this.opening,
      repaints: this.l3d ? this.l3d.repaints || 0 : 0, zoneRebuilds: this.map?.zoneRebuilds || 0, glRenders: this.l3d ? this.l3d.glRenders || 0 : 0, region: this.l3d && this.l3d.region ? `${this.l3d.region.cw}x${this.l3d.region.ch}@${this.l3d.region.ppu.toFixed(2)}` : '', gpu: this.l3d ? this.l3d.glInfo() : '' });
    Perf.extra = this.perfExtra;
    this.effects = new Effects(game, this.cam, { onCaptured: () => this.map.invalidate() });
    this.panel = new ArmyPanel(game, this.ui1, this.units, { front: (area, armyId) => {
      const shop = this.dialog instanceof CardShop ? this.dialog : null;
      const cardId = shop ? shop.card?.id : this.cardTarget;
      if ([22, 23, 24].includes(cardId)) {
        this.applyUnitCard(area, armyId, cardId, shop ? true : this.cardPending);
        return;
      }
      if (this.cardTarget != null) return;
      if (this.game.apply({ type: 'frontArmy', from: area, armyId }).ok) { this.panel.resetOrder(area); E.playSfx('select.wav'); this.select(area); }
    } });
    this.talks = [];                                                     // dialogues waiting for their turn: { wait, lines, portraits }
    game.on('orderCommandStarting', ev => this.aiTurnRunner.announce(ev.command, ev.country, ++this.autoBannerStep));
    game.on(EV.COMMANDER_COMPLAINT, ev => this.queueComplaint(ev));
    game.on(EV.ROUND_BEGIN, () => this.queueStageDialogue());
    game.on(EV.GAME_OVER, ev => this.showResult(ev));
    this.hud = new BattleHud(this.ui1, army, game, { pause: () => this.openPause(), save: () => this.goSave(), strategy: () => this.toggleZhengwu(), zhengwu: () => this.toggleZhengwu(), shop: () => this.openShop(), cardCancel: () => this.cancelCardMode(), endRound: () => this.endTurn(), canEndRound: () => !this.aiTurnRunner.running, topNotice: () => this.aiTurnRunner.running || (this.autoPlayer.enabled && !this.aiTurnRunner.running),
      // touch buttons (the hotkey actions, for screens without a keyboard)
      zoomIn: () => this.zoomBy(1.25), zoomOut: () => this.zoomBy(1 / 1.25), mode: () => this.toggleMode(), photo: () => this.setPhoto(true), decorate: () => this.openDecorate(),
      modeLabel: () => this.l3d ? (this.cam.desk3d ? '2D' : '3D') : '' });
    this.cmdUI = new CommandUI(game, this);                                   // theatre strips / order bar / box selection (ui/command_ui.js)
    this.hud.tileInfo.countryCard.context = { cam: this.cam, hud: this.hud, panel: this.panel };
    if (E.exp('marshal')) this.marshalTuner();                             // ?exp=marshal: live sliders to find the best marshal fit
    if (this.snapshotData && !this.options.multiplayerRoom) this.blink = BLINK_SECONDS; // multiplayer waits for the server's turn state
    else this.opening = await Opening.create(game, this.ui1, { done: () => {
      this.opening = null;
      if (!this.options.multiplayerRoom || (game.phase === 'playing' && game.activeCountry === game.player)) this.blink = BLINK_SECONDS;
      if (!this.options.multiplayerRoom && game.turnOrder === 'second' && game.phase === 'playing') this.aiTurnRunner.start();
    }, bank: () => E.go('bank', this) });
    if (game.phase === 'finished' && game.result) this.showResult(game.result);
    await mapReady;
    if (new URLSearchParams(location.search).has('leaderAudit')) {
      await leadersReady;
      this.opening = null;
      this.cam.zoom = this.cam.minZoom();
      this.cam.x = (stage.bounds.x0 + stage.bounds.x1) / 2;
      this.cam.clamp();
      document.body.dataset.leaderReady = new URLSearchParams(location.search).get('leaderAudit');
    }
    if (this.options.multiplayerRoom) this.initMultiplayer();
  }

  // 本地没有该对局的弹幕历史(比如刷新前的弹幕没被保存)：向桥要这局已完成回合的操作说明，重建弹幕
  hydrateDanmakuFromBridge(game) {
    if (!this.bridgeEnabled || !game.gameId) return;
    this.saySince = this.saySince || 0;
    fetch(`${this.bridgeUrl}/bridge/history?gameId=${encodeURIComponent(game.gameId)}`).then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      for (const say of d.says || []) this.saySince = Math.max(this.saySince, say.id || 0);   // 已有的发话不重复显示
      // 回合记录和 agent 发话按时间合并重建
      const rows = [...(d.turns || []).map(t => ({ at: t.created || 0, turn: t })), ...(d.says || []).map(x => ({ at: x.created || 0, say: x }))].sort((a, b) => a.at - b.at);
      const items = []; let n = 0;
      for (const row of rows) {
        if (row.turn) {
          const t = row.turn, who = playerCountryName(t.country, game.stage);
          items.push({ sep: true, text: Danmaku.sepText(++n, `第 ${t.round} 回合 · ${who}`) });
          const notes = t.notes?.length ? t.notes : (t.summary ? [{ label: '本回合总结', reason: t.summary }] : []);
          for (const note of notes) items.push({ who: note.label ? `${who}·${note.label}` : who, text: note.reason });
        } else {
          const x = row.say, who = playerCountryName(x.country, game.stage);
          items.push({ who: `${who}·${x.label || '感言'}〔${Danmaku.audienceLabel(x, c => playerCountryName(c, game.stage))}〕`, text: x.text });
        }
      }
      Danmaku.hydrate(items, n);
    }).catch(() => {});
  }
  // 轮询 agent 的发话(wc2_bridge_say)，作为弹幕显示
  pollSays() {
    const g = this.game; if (!this.bridgeEnabled || !g?.gameId || this.leaving) return;
    fetch(`${this.bridgeUrl}/bridge/says?gameId=${encodeURIComponent(g.gameId)}&since=${this.saySince || 0}`).then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.says?.length) return;
      for (const say of d.says) {
        this.saySince = Math.max(this.saySince || 0, say.id || 0);
        const who = playerCountryName(say.country, g.stage);
        Danmaku.push([{ who: `${who}·${say.label || '感言'}〔${Danmaku.audienceLabel(say, c => playerCountryName(c, g.stage))}〕`, text: say.text }], 900);
      }
    }).catch(() => {});
  }
  onShow() { this.leaving = false; Danmaku.keepAlive(); if (this.bridgeEnabled) { clearInterval(this.sayTimer); this.sayTimer = setInterval(() => this.pollSays(), 2500); } }
  dispose() { this.leaving = true; this.aiTurnRunner?.dispose(); clearInterval(this.sayTimer); Danmaku.detach(); clearInterval(this.bridgeHeartbeat); if (Perf.extra === this.perfExtra) Perf.extra = null; this.mpClient?.close(); this.mpStatus?.remove(); this.mpTurnWarning?.remove(); this.mpSpectatorBar?.remove(); if (this.photo) this.setPhoto(false); if (this.l3d) { this.l3d.dispose(); this.l3d = null; } if (this.cam) this.cam.desk3d = this.cam.tilt = false; }
  configureBridge() {
    if (!this.game || this.options.multiplayerRoom) return;
    clearInterval(this.bridgeHeartbeat);
    if (this.bridgeBuiltinControllers) {
      for (const [co, ctrl] of this.bridgeBuiltinControllers) {
        this.game.controllers.set(co, ctrl);
      }
    }
    this.bridgeBuiltinControllers = new Map();
    this.bridgeUrl = bridgeTransportUrl(this.options.bridge?.url || E.state.bridgeUrl);
    this.bridgeTimeoutMinutes = Math.max(1, Number(E.state.bridgeTimeoutMinutes) || 10);
    const param = new URLSearchParams(location.search).get('llmOpponent');
    const candidates = this.game.stage.data.countries.map(c => c.id);

    let selectedList = [];
    if (param === 'all-ai') {
      selectedList = candidates.filter(c => c !== this.game.player);
    } else if (param) {
      const parts = param.split(',').map(s => s.trim()).filter(Boolean);
      selectedList = candidates.filter(c => parts.includes(c));
    } else if (Array.isArray(this.options.bridge?.countries) && this.options.bridge.countries.length > 0) {
      selectedList = candidates.filter(c => this.options.bridge.countries.includes(c));
    } else if (Array.isArray(E.state.bridgeCountries) && E.state.bridgeCountries.length > 0) {
      selectedList = candidates.filter(c => E.state.bridgeCountries.includes(c));
    } else if (E.state.bridgeCountry && candidates.includes(E.state.bridgeCountry)) {
      selectedList = [E.state.bridgeCountry];
    } else if (candidates.length > 0) {
      selectedList = [candidates.find(c => c !== this.game.player) || candidates[0]];
    }

    this.bridgeCountries = selectedList;
    this.bridgeCountry = selectedList[0] || candidates[0] || '';
    this.bridgeEnabled = !!this.bridgeEnabled && this.bridgeCountries.length > 0;
    this.game.bridgeSpectating = this.bridgeEnabled && candidates.length > 0 && candidates.every(c => this.bridgeCountries.includes(c));
    this.game.spectating = !!this.replayView || !!this.multiplayerSpectator;
    if (!this.bridgeEnabled) return;

    this.game.bridgeOpponentCountry = this.bridgeCountry;
    this.game.bridgeOpponentCountries = this.bridgeCountries;

    for (const c of this.bridgeCountries) {
      const original = c === this.game.player ? new HqAi() : this.game.controllers.get(c);
      if (original) this.bridgeBuiltinControllers.set(c, original);
      const ctrl = new BridgeController(this, c);
      this.game.controllers.set(c, ctrl);
    }
    this.bridgeController = new BridgeController(this, this.bridgeCountry);
    this.bridgeController.register().catch(error => { this.bridgeStatus = error.message; });
    this.bridgeHeartbeat = setInterval(() => this.bridgeController.heartbeat().catch(error => { this.bridgeStatus = error.message; }), 10000);
  }
  onBack() {
    if (this.options.multiplayerRoom) { if(this.multiplayerSpectator)this.mpSpectatorBar?.querySelector('.mp-spectator-exit')?.click();else E.go('multiplayer', this.options.multiplayerRoom, { stayInRoom: true }); return; }
    if (this.replayView) { this.replayView.exit(); return; }
    const cq = /^conquest_(\d+)$/.exec(this.stageName);
    if (cq) E.go('countrySelect', +cq[1]); else E.go('campaignList', this.stageName.replace(/battle_|\d+$/g, '') || 'axis');
  }
  focusables() { return this.opening ? [] : this.hud.buttons; }

  // ---- selection ----
  select(id) {
    if (this.replayView||this.multiplayerSpectator||this.game.bridgeSpectating) { this.inspectArea = null; this.sel = id; this.map.setTargets(new Map()); return; }
    this.inspectArea = null;
    if (this.game.fogOfWar && !this.game.bridgeSpectating) {
      const { now } = rememberVisibility(this.game, this.game.player);
      if (id >= 0 && !now.has(id)) id = -1;
    }
    this.sel = this.game.phase === 'finished' ? -1 : id;
    const targetStage = (this.game.fogOfWar && !this.game.bridgeSpectating) ? countryGameView(this.game, this.game.player).stage : this.game.stage;
    this.map.setTargets(targetStage.targetsFor(this.sel, this.game.airstrikeRadius()));
  }
  get targets() { return this.map.targets; }

  // ---- dialogs ----
  openPause() {
    if (this.replayView) { this.replayView.pause(); return; }
    const online = !!(this.options.multiplayerRoom && this.mpRoom?.id === this.options.multiplayerRoom);
    const close = () => { this.dialog = null; };
    this.dialog = new PauseMenu(this.ui1, this.txt, {
      resume: close,
      save: () => { close(); this.goSave(); },
      options: () => { close(); this.goOptions(); },
      mode: () => this.toggleMode(),
      allFlags: () => { E.state.allFlags = !E.state.allFlags; E.saveState(); close(); },
      decorate: () => this.openDecorate(),
      photo: () => { close(); this.setPhoto(true); },
      replay: () => { close(); this.replayView = new ReplayControls(this); },
      multiplayerInfo: () => { close(); E.go('multiplayer', this.options.multiplayerRoom, { stayInRoom: true }); },
      multiplayerPause: () => this.toggleMultiplayerPause(),
      restart: () => { close(); E.go('battle', this.stageName, null, this.options); },
      quit: () => { close(); E.go('home'); },
    }, {
      // the 2D / 3D switch names the mode it switches TO; without the 3D layer (three.js failed / ?flat) it is disabled
      label: id => id === 'options' ? '设置' : id === 'mode' ? (this.l3d ? (this.cam.desk3d ? '切换 2D' : '切换 3D') : '3D 不可用')
        : id === 'allFlags' ? `全旗帜：${E.state.allFlags ? '开' : '关'}`
        : id === 'multiplayerPause' ? (this.mpRoom?.paused ? '继续联机' : '暂停联机') : null,
      enabled: id => id === 'multiplayerPause' ? !this.mpPausePending : id !== 'mode' || !!this.l3d,
      online,
      extraItems: online ? ['multiplayerInfo', ...(this.mpRoom.hostId === E.user?.id ? ['multiplayerPause'] : [])] : [],
    });
    E.playSfx('pop.wav');
  }
  // actions shared by the pause menu buttons and the hotkeys
  openDecision(event) { if (this.autoPlayer.promptEvent(this.game, event)) return; this.dialog = new DecisionDialog(this.game, event, { close: () => { this.dialog = null; } }); E.playSfx('pop.wav'); }
  openWarNotice(event) {
    this.dialog = new WarNoticeDialog(this.game, event, {
      close: () => { this.dialog = null; },
      focusArea: (areaId) => {
        if (areaId == null) return;
        let a = typeof areaId === 'number' ? World?.areas?.[areaId] : World?.areas?.find(ar => ar?.name === areaId || ar?.id === areaId);
        if (a && this.cam) {
          this.cam.x = a.x + a.w / 2;
          this.cam.y = a.y + a.h / 2;
          this.cam.clamp();
          this.sel = a.id;
        }
      }
    });
    E.playSfx('pop.wav');
  }
  toggleZhengwu() {
    if (this.dialog && (this.dialog.isZhengwu || this.dialog instanceof ChainMenuDialog)) {
      this.dialog.close();
    } else {
      this.openZhengwu();
    }
  }
  openZhengwu(tab = 'situation') {
    this.dialog = new ChainMenuDialog(this.game, this, { initialTab: tab, close: () => { this.dialog = null; } });
    this.dialog.isZhengwu = true;
    E.playSfx('pop.wav');
  }
  openChainMenu(tab = 'situation') { this.openZhengwu(tab); }
  startAutoPlay() { if (this.bridgeEnabled && this.bridgeCountries.includes(this.game.player)) return; this.autoBannerStep = 0; this.autoPlayer.start(); this.aiTurnRunner.setCountryBanner(this.game.player, '我军开始托管行动', 0); E.playSfx('btn.wav'); }
  stopAutoPlay() { this.autoPlayer.stop(); E.playSfx('cancel.wav'); }
  openSituation() { this.openZhengwu('situation'); }
  openDiplomacy() { this.openZhengwu('diplomacy'); }
  async toggleMode() {
    if (!this.want3d || this.modeSwitching) return;
    this.modeSwitching = true;
    try { await this.ensureDesk3d(); if (!this.leaving && this.l3d) { this.deskOn = !this.deskOn; this.applyDeskView(); } }
    finally { this.modeSwitching = false; }
  }
  // The card-style army-group dialog is gone: groups are built on the map (Shift+click or drag) and managed in the right-edge theatre strips.
  // Callers that used to open the dialog land here: with a group id it opens the commander picker, otherwise it explains the flow.
  openArmyGroups(groupId = null) {
    if (this.replayView || this.photo || this.opening || this.aiTurnRunner.running || !this.cmdUI) return;
    const g = groupId && this.game.armyGroups.find(v => v.id === groupId);
    if (g) { this.cmdUI.chooseCommander(g); return; }
    this.cmdUI.say('编集团军：按住 Shift 点选或拖框选兵，再点「新建集团军」；把钢盔标拖到右侧战区条上编入战区');
  }
  openDecorate() { this.dialog = new Decorator({ cam: this.cam, layer: this.acc, ui1: this.ui1, done: () => { this.dialog = null; } }); E.playSfx('pop.wav'); }
  // Photo mode: every button and info panel is hidden; the hotkey or four taps leave it.
  setPhoto(on) {
    this.photo = !!on; this.lastTap = null; this.photoHintUntil = on ? performance.now() + 3200 : 0;
    if (on) { this.select(-1); this.cancelCardMode(); }
    E.playSfx(on ? 'pop.wav' : 'cancel.wav');
    // borderless full screen while in photo mode (the browser's Fullscreen API; needs the click / key that started it, which it has).
    // Only leave full screen if we were the one who entered it. The browser's own Esc also leaves full screen: photo mode then stays on.
    try {
      if (on) { this.photoFsOwn = !document.fullscreenElement; if (this.photoFsOwn) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { this.photoFsOwn = false; }); }
      else if (this.photoFsOwn && document.fullscreenElement) { this.photoFsOwn = false; document.exitFullscreen().catch(() => {}); }
    } catch (e) {}
  }
  // Consecutive taps on the same spot: each within TAP_GAP ms of the previous one and within 40 px of the first. Returns how many in a row
  // this tap makes (1 = a lone tap).
  tapRun(p) {
    const now = performance.now(), l = this.lastTap;
    const n = l && now - l.t < TAP_GAP && Math.hypot(p.x - l.x, p.y - l.y) < 40 ? l.n + 1 : 1;
    this.lastTap = { t: now, x: l && n > 1 ? l.x : p.x, y: l && n > 1 ? l.y : p.y, n };
    return n;
  }
  photoTap(p) { if (this.tapRun(p) >= PHOTO_TAPS) this.setPhoto(false); }
  zoomBy(f) { this.aiTurnRunner?.manualCamera(); this.cam.zoomAt(E.W / 2, E.H / 2, f); this.cam.clamp(); }
  // two-finger gesture (see core/runtime.js): zoom and pan the map
  pinch(scale, cx, cy, dx, dy) { if (this.cmdUI?.touchBoxSelect || this.cmdUI?.box) return; this.replayView?.wake(); if (!this.opening) { this.aiTurnRunner?.manualCamera(); this.cam.pinch(scale, cx, cy, dx, dy); } }
  goSave() { E.go('saveScreen', this); }
  goOptions() { E.go('options', null, this); }
  // 回放对手(LLM)买卡时，非交互地画出卡牌商城并选中那张卡，让玩家看到它在商城里的选择
  showShopPreview(cardId, country) {
    const g = this.game, card = g.findCard(cardId); if (!card) return;
    const asCountry = new Proxy(g, { get: (t, p, r) => p === 'player' ? country : Reflect.get(t, p, r) });
    const flag = g.stage.countries.get(country)?.flag;
    this.shopPreview = new CardShop(asCountry, { ui1: this.ui1, ui2: this.ui2 }, shopCards(g.cardData, flag || g.playerInfo.flag), { close() {}, purchased() {}, notice() {} }, { tab: card.type, cardId });
  }
  hideShopPreview() { this.shopPreview = null; }
  openShop() {
    const g = this.game;
    if (g.phase === 'finished') return;
    let shop;
    const close = () => {
      this.shopSelection = { tab: shop.tab, cardId: shop.card?.id ?? null, scroll: E.clamp(shop.scroll, 0, shop.maxScroll()) };
      E.state.cardShopSelection = this.shopSelection; E.saveState(); this.dialog = null;
    };
    shop = new CardShop(g, { ui1: this.ui1, ui2: this.ui2 }, shopCards(g.cardData, g.playerInfo.flag), {
      close,
      armyPanelWidth: () => this.panel.area(this.sel) ? 180 : 0,
      purchased: (card, opts) => {
        close();
        if (TARGETED_CARDS.has(card.id)) this.enterCardMode(card.id, opts?.pending);
      },
      notice: msg => this.notice(msg),
    }, this.shopSelection);
    this.dialog = shop;
    E.playSfx('pop.wav');
  }

  cardTargetsFor(cardId, isPending = false) {
    const card = this.game.findCard(cardId), handler = handlerFor('useCard'), targets = [];
    if (!card || !handler?.validate) return targets;
    for (const id of this.game.stage.enabled) {
      const armies = [22, 23, 24].includes(cardId) ? this.game.stage.st(id)?.armies || [] : [null];
      if (armies.some(army => !handler.validate(this.game, { type: 'useCard', card, target: id, ...(army ? { armyId: army.id } : {}), pendingPurchase: isPending }))) {
        targets.push(id);
      }
    }
    return targets;
  }
  enterCardMode(cardId, isPending = false) {
    this.cardTarget = cardId;
    this.cardPending = isPending;
    if (![22, 23, 24].includes(cardId)) this.select(-1);
    this.map.setCardTargets(this.cardTargetsFor(cardId, isPending));
    this.hud.setCardMode(true);
  }
  cancelCardMode() {
    this.cardTarget = null;
    this.cardPending = false;
    this.map.setCardTargets([]);
    this.hud.setCardMode(false);
  }

  applyUnitCard(area, armyId, cardId, pendingPurchase) {
    const card = this.game.findCard(cardId);
    const result = this.game.apply({ type: 'useCard', card, target: area, armyId, pendingPurchase: !!pendingPurchase });
    if (!result.ok) {
      this.notice({ money: '资金不足。', industry: '工业值不足。', tech: '科技等级不足。', cooldown: '该卡片仍在冷却中。', 'no-card': '没有可用的卡片。', 'illegal-target': '该部队不能使用这张卡片，或已拥有该效果。' }[result.reason] || '无法使用这张卡片。');
      return;
    }
    E.playSfx(pendingPurchase ? 'buy.wav' : 'select.wav');
    this.select(area);
    if (!(this.dialog instanceof CardShop)) {
      if (pendingPurchase ? !this.game.whyNot(card) && this.cardTargetsFor(cardId, true).length : (this.game.hand[cardId] || 0) > 0 && !(this.game.cardCooldowns[cardId] || 0)) this.enterCardMode(cardId, pendingPurchase);
      else this.cancelCardMode();
    }
  }

  // ---- input (real coordinates; the world ignores the design-canvas centring) ----
  // Bulletproof HUD click handling:
  // 1. Buttons are NEVER pre-armed in down.
  // 2. Any movement > 4px immediately nullifies any button candidate and locks dragging.
  // 3. For 500ms after any drag ends, all HUD clicks and map clicks are locked out.
  // 4. A button fires ONLY IF pressed and released on the exact same button with movement <= 4px within 500ms.
  disarmHud() { this.hud.disarm(); this.hudCandidate = null; if (this.opening) this.opening.disarm(); }
  // a map drag: in the tilt view the map point under the pointer is grabbed (ray onto the desk with the camera as it was at the press)
  dragFrom(p) {
    const cam = this.cam, tilt = cam.tilt;
    return { x: p.x, y: p.y, cx: cam.x, cy: cam.y, moved: false, rig: tilt ? cam.rigAt(cam.x, cam.y, cam.zoom) : null, w0: tilt ? cam.toWorld(p.x, p.y) : null };
  }
  async toggleMultiplayerPause() {
    if (!this.options.multiplayerRoom || this.mpPausePending || this.mpRoom?.hostId !== E.user?.id) return;
    this.mpPausePending = true;
    try { await multiplayerRequest(`rooms/${this.options.multiplayerRoom}/pause`, 'POST', { paused: !this.mpRoom.paused }); }
    catch (error) { this.notice(error.message); }
    finally { this.mpPausePending = false; }
  }
  setMultiplayerStatus(message = '') {
    if (!this.mpStatus) return;
    this.mpStatus.textContent = message;
    this.mpStatus.style.display = message ? '' : 'none';
  }
  updateMultiplayerTurnWarning() {
    if (!this.mpTurnWarning) return;
    const deadline = this.mpTurnDeadlineAt;
    if (deadline && this.game.phase === 'playing' && this.game.activeCountry === this.game.player) {
      const remaining = Math.ceil((deadline + (this.mpClockOffset || 0) - Date.now()) / 1000);
      if (remaining > 0 && remaining <= 10 && !this.mpWarned10) {
        this.mpWarned10 = this.mpWarned30 = true;
        this.mpTurnWarning.textContent = `回合即将结束 · 剩余 ${remaining} 秒`;
        this.mpWarningUntil = performance.now() + 3500;
      } else if (remaining > 10 && remaining <= 30 && !this.mpWarned30) {
        this.mpWarned30 = true;
        this.mpTurnWarning.textContent = `回合即将结束 · 剩余 ${remaining} 秒`;
        this.mpWarningUntil = performance.now() + 3500;
      }
    }
    this.mpTurnWarning.style.display = performance.now() < (this.mpWarningUntil || 0) ? '' : 'none';
  }
  initMultiplayer() {
    const roomId = this.options.multiplayerRoom;
    if(this.multiplayerSpectator){this.game.spectating=true;this.opening=null;}
    this.mpStatus = document.createElement('div');
    this.mpStatus.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:75;background:#202d25e8;border:2px solid #b99a57;border-radius:5px;color:#f8ebc5;padding:8px 16px;font:600 16px Georgia,"Microsoft YaHei",sans-serif;pointer-events:none;box-shadow:0 3px 14px #0008';
    document.body.append(this.mpStatus);
    this.mpTurnWarning = document.createElement('div');
    this.mpTurnWarning.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:76;display:none;background:#702b20ee;border:2px solid #e9b774;border-radius:5px;color:#fff2d5;padding:9px 18px;font:700 18px Georgia,"Microsoft YaHei",sans-serif;pointer-events:none;box-shadow:0 3px 14px #0008';
    document.body.append(this.mpTurnWarning);
    const applyLocal = this.game.apply.bind(this.game);
    this.game.apply = command => {
      if(this.multiplayerSpectator)return {ok:false,reason:'观战者为只读身份，不能发送游戏命令'};
      if (this.mpLocalApplying) return applyLocal(command); // included in the parent command sent to the server
      if (this.mpRoom?.paused) return { ok: false, reason: '联机已暂停，等待房主继续' };
      if (this.game.activeCountry !== this.game.player) return { ok: false, reason: '等待其他国家行动' };
      if (this.mpTurnDeadlineAt && Date.now() - (this.mpClockOffset || 0) >= this.mpTurnDeadlineAt) return { ok: false, reason: '本回合操作时间已结束' };
      if (this.mpTurnEnding) return { ok: false, reason: '正在结束回合' };
      if (command.type !== 'endTurn') {
        this.mpLocalApplying = true;
        let result;
        try { result = applyLocal(command); }
        finally { this.mpLocalApplying = false; }
        if (!result.ok) return result;
      }
      this.sendMultiplayerCommand(command);
      return { ok: true };
    };
    this.mpClient = new MultiplayerClient(roomId, packet => this.receiveMultiplayer(packet), error => {
      this.setMultiplayerStatus(`联机连接中断，正在重连：${error.message}`);
    },{spectator:this.multiplayerSpectator});
    if(this.multiplayerSpectator)this.createSpectatorBar();
    this.setMultiplayerStatus(this.multiplayerSpectator?'正在连接观战…':'正在连接联机对局…');
  }
  createSpectatorBar(){
    this.mpSpectatorBar=document.createElement('div');this.mpSpectatorBar.style.cssText='position:fixed;right:18px;top:12px;z-index:78;display:flex;gap:8px;align-items:center;background:#172019e8;border:1px solid #b99a57;padding:7px 9px;color:#f8ebc5;font:600 14px Georgia,"Microsoft YaHei",sans-serif';
    this.mpSpectatorBar.innerHTML='<span>只读观战</span><select class="mp-spectator-country" style="background:#26342b;color:#f8ebc5;border:1px solid #8e7747;padding:4px"><option value="">全知视角</option></select><button class="mp-spectator-style" style="background:#26342b;color:#fff;border:1px solid #8e7747;padding:5px 9px">显示：兵人</button><button class="mp-spectator-report" style="background:#26342b;color:#fff;border:1px solid #8e7747;padding:5px 9px">战报</button><button class="mp-spectator-exit" style="background:#653126;color:#fff;border:1px solid #b99a57;padding:5px 9px">退出观战</button>';
    document.body.append(this.mpSpectatorBar);const select=this.mpSpectatorBar.querySelector('select');for(const c of this.game.stage.data.countries){const o=document.createElement('option');o.value=c.id;o.textContent=`跟随 ${c.name||c.id}`;select.append(o);}
    select.addEventListener('change',async()=>{try{const packet=await multiplayerRequest(`rooms/${this.options.multiplayerRoom}/spectator-view`,'POST',{country:select.value||null});this.receiveMultiplayer(packet);}catch(error){this.notice(error.message);}});
    const styles=['兵人','国旗','纯地块','军旗'];this.mpSpectatorBar.querySelector('.mp-spectator-style').addEventListener('click',e=>{this.units.replayStyle=((this.units.replayStyle||0)+1)%styles.length;e.currentTarget.textContent=`显示：${styles[this.units.replayStyle]}`;});
    this.mpSpectatorBar.querySelector('.mp-spectator-report').addEventListener('click',()=>this.openZhengwu('events'));
    this.mpSpectatorBar.querySelector('.mp-spectator-exit').addEventListener('click',async()=>{try{await multiplayerRequest(`rooms/${this.options.multiplayerRoom}/leave-spectate`,'POST');}catch{}this.mpClient?.close();E.go('multiplayer');});
  }
  sendMultiplayerCommand(command) {
    this.mpQueue ||= [];
    this.mpQueue.push(structuredClone(command));
    if (command.type === 'endTurn') this.mpTurnEnding = true;
    this.setMultiplayerStatus();
    if (this.mpSending) return;
    this.mpSending = true;
    (async () => {
      do {
        while (this.mpQueue.length) {
          const next = this.mpQueue.shift();
          try { await this.mpClient.command(next); }
          catch (error) {
            if (next.type === 'endTurn') this.mpTurnEnding = false;
            // Later commands can refer to an ID created by the rejected command.
            // Discard them and reload the server's authoritative state.
            this.mpQueue.length = 0;
            this.notice(error.message);
            this.setMultiplayerStatus(`命令未执行：${error.message}`);
          }
        }
        // WebSocket packets for intermediate commands must not replace later
        // optimistic changes while this batch is in flight.
        try {
          const packet = await this.mpClient.room();
          if (!this.mpQueue.length && (!this.mpPendingPacket || packet.room.revision > this.mpPendingPacket.room.revision)) this.mpPendingPacket = packet;
        } catch (error) {
          this.setMultiplayerStatus(`正在重新同步对局：${error.message}`);
        }
      } while (this.mpQueue.length);
      this.mpSending = false;
      const packet = this.mpPendingPacket;
      this.mpPendingPacket = null;
      if (packet) this.receiveMultiplayer(packet);
    })();
  }
  receiveMultiplayer(packet) {
    if(packet.type==='notice'){this.notice(packet.message);return;}
    if (packet.type === 'roomClosed') {
      this.mpClient?.close();
      E.go('multiplayer').then(() => E.scene?.error?.(packet.reason || '房间已解散'));
      return;
    }
    if (!this.mpStatus || !packet.snapshot) return;
    if ((packet.room?.revision || 0) < (this.mpLastRevision || 0)) return;
    if (this.mpSending) {
      if (!this.mpPendingPacket || (packet.room?.revision || 0) >= (this.mpPendingPacket.room?.revision || 0)) this.mpPendingPacket = packet;
      return;
    }
    this.mpLastRevision = packet.room?.revision || this.mpLastRevision || 0;
    this.mpRoom = packet.room;
    const playEvents = Array.isArray(packet.events) && this.mpLastRevision > (this.mpEffectsRevision || 0);
    if (playEvents) this.mpEffectsRevision = this.mpLastRevision;
    const snap = packet.snapshot, game = this.game, stage = game.stage;
    for (const incoming of snap.areas) {
      const area = stage.byArea.get(incoming.id);
      if (area) Object.assign(area, incoming);
    }
    for (const incoming of snap.countries) {
      const country = stage.countries.get(incoming.id);
      if (country) Object.assign(country, incoming);
    }
    // Game.player is derived from Stage; never assign to its getter.
    if ('player' in snap) stage.data.player = snap.player;
    for (const key of ['fogOfWar','round','activeCountry','phase','result','money','industry','tech','stability','hand','cardCooldowns','techTurn','ownedCommanders','medalLevels','armyGroups','theatres','orders','coordination','diplomacy','scenarioEvents','visibilityMemory','nextArmyId','nextArmyGroupId','nextTheaterId','nextOrderId','reportLog','nextReportId','reportRevision']) {
      if (key in snap) game[key] = snap[key];
    }
    if(this.multiplayerSpectator){game.spectating=true;const select=this.mpSpectatorBar?.querySelector('select');if(select)select.value=snap.spectator?.viewCountry||'';}
    if (snap.rng) game.rng = Rng.restore(snap.rng);
    this.map.invalidate();
    this.units.fcache?.clear(); this.units.gcache?.clear();
    if (playEvents) for (const event of packet.events) game.events.emit(event);
    if (game.activeCountry !== game.player) this.mpTurnEnding = false;
    this.mpClockOffset = Date.now() - (packet.room.serverNow || Date.now());
    const deadline = packet.room.turnDeadlineAt || null;
    if (deadline !== this.mpTurnDeadlineAt) {
      this.mpTurnDeadlineAt = deadline;
      this.mpWarned30 = this.mpWarned10 = false;
      this.mpWarningUntil = 0;
      if (this.mpTurnWarning) this.mpTurnWarning.style.display = 'none';
    }
    const turnKey = game.phase === 'playing' && game.activeCountry === game.player ? `${game.round}:${game.player}` : null;
    if (turnKey && turnKey !== this.mpTurnKey && !this.opening) this.blink = BLINK_SECONDS;
    this.mpTurnKey = turnKey;
    this.setMultiplayerStatus(game.phase === 'finished' ? '对局结束 · 服务器已保存'
      : packet.room.paused ? '联机已暂停 · 等待房主继续' : this.multiplayerSpectator?(snap.spectator?.viewCountry?`观战中 · 跟随 ${snap.spectator.viewCountry}`:'观战中 · 全知视角'):'');
    this.select(this.sel);
    if (game.phase === 'finished' && game.result && !this.dialog) this.showResult(game.result);
  }
  pointerCancel() {
    this.touchPan = null;
    this.hud?.tileInfo?.countryCard.cancelDrag();
    this.cmdUI?.pointerCancel();
    this.aiTurnRunner?.endBannerDrag();
    if (this.tilePortraitHold) clearTimeout(this.tilePortraitHold.timer);
    this.tilePortraitHold = null;
    this.orderLinePress = null;
    this.orderEndpointDrag = null;
    this.orderStroke = null;
    if (this.replayView) this.replayView.cancel();
    if (this.accHold) { if (this.accHold.active) { this.acc.held = null; this.acc.save(); } this.accHold = null; }
    this.disarmHud();
    const wasDragging = this.isDragging || (this.drag && this.drag.moved);
    this.drag = null; this.press = null; this.hudCandidate = null; this.isDragging = false;
    if (wasDragging) {
      this.lastDragEndTime = performance.now();
      this.cam.release();
    }
  }
  pointerDown(p) {
    if (this.game.bridgeSpectating && !this.dialog && !this.opening && this.hud?.pause?.hit(p)) { this.openPause(); return; }
    if (!this.dialog && !this.opening && !this.photo && !this.replayView && this.hud?.barDown?.(p)) { this.disarmHud(); this.press = null; this.drag = null; return; }   // 资源栏拖动(触屏)
    if (!this.dialog && !this.opening && !this.replayView && this.aiTurnRunner.blocksInput) {
      this.disarmHud(); this.press = null; this.drag = null;
      if (this.aiTurnRunner.down(p)) return;
      if (p.button !== 2) this.drag = this.dragFrom(p);
      return;
    }
    if (p.pointerType === 'touch' && this.orderDrawing && !this.touchDrawMode) {
      this.touchPan = this.dragFrom(p);
      return;
    }
    if (!this.dialog && this.portraitMenu?.menu) { this.portraitMenu.down(p); this.cmdUI?.adoptMenuPicker(); return; }
    // 地块信息面板在最上层：点在它上面时先交给它，不让下面的战区指挥部抢走
    if (!this.dialog && !this.opening && !this.photo && !this.replayView && this.hud?.tileInfo?.contains(p, this.inspectArea ?? this.sel) && this.hud.tileInfo.countryCard.pointerDown(p)) { this.disarmHud(); this.press = null; this.drag = null; this.isDragging = false; return; }
    if (this.cmdUI?.pointerDown(p)) return;                        // theatre strips, order bar, selection bar, banners, Shift+unit selection
    if (!this.dialog && !this.opening && !this.photo && !this.replayView && !this.orderDrawing && !this.aiTurnRunner?.blocksInput) {
      const hudHit = [...this.hud.buttons, ...this.hud.touchButtons()].some(b => b.enabled && b.visible && b.hit(p));
      if (!hudHit && this.hud.tileInfo.countryCard.pointerDown(p)) {
        this.disarmHud(); this.press = null; this.drag = null; this.isDragging = false;
        return;
      }
    }
    if (!this.dialog && !this.replayView && !this.opening && !this.photo && !this.aiTurnRunner?.blocksInput && !this.orderDrawing && this.cardTarget == null && p.button!==2) {
      const endpoint=this.focusedOrderEndpointHit(p);
      if(endpoint){this.orderLinePress={...endpoint,x:p.x,y:p.y};return;}
    }
    if (!this.orderDrawing && this.cmdUI?.focus && p.button !== 2) this.cmdUI.setFocus(null);
    if (!this.dialog && this.hud?.tileInfo) {
      const target=this.hud.tileInfo.orderTarget(p,this.inspectArea??this.sel);
      if(target){
        if(p.button===2)this.portraitMenu.openMenu(target.level,target.id,p.x,p.y);
        else if(p.pointerType==='touch'){
          const hold={target,x:p.x,y:p.y,long:false};
          hold.timer=setTimeout(()=>{hold.long=true;this.portraitMenu.openMenu(target.level,target.id,p.x,p.y);},520);
          this.tilePortraitHold=hold;
        } else this.portraitMenu.select(target.level,target.id);
        return;
      }
    }
    if (this.orderDrawing) {
      if (p.button === 2) { this.orderDrawing = null; return; }
      this.orderStroke = { x: p.x, y: p.y };
      this.addOrderPoint(p);
      return;
    }
    if (!this.dialog && !this.replayView && !this.opening && !this.photo && !this.aiTurnRunner?.blocksInput && !this.orderDrawing && this.cardTarget == null && p.button!==2) this.selectedOrderTarget=null;
    if (this.replayView) { this.replayView.pointerDown(p); return; }
    this.disarmHud();
    if (this.dialog instanceof CardShop && this.panel.contains(p, this.sel)) { this.shopPanelPointer = true; this.panel.down(p, this.sel); return; }
    if (this.dialog) { this.dialog.down(p); return; }
    const now = performance.now();
    this.press = { x: p.x, y: p.y, moved: false, time: now };
    if (this.opening) { this.opening.down(p); return; }
    if (!this.photo && this.panel.contains(p, this.sel)) { this.panel.down(p, this.sel); return; }
    if (!this.photo && this.hud.tileInfo.contains(p, this.inspectArea ?? this.sel)) { this.press = null; return; }
    if (!this.photo && this.hud.legendHit(p)) { this.press.legend = true; this.hud.toggleLegend(); return; }

    // Check if down falls strictly on an active HUD button
    const hitBtn = this.photo ? null : [...this.hud.buttons, ...this.hud.touchButtons()].find(b => b.enabled && b.visible && b.hit(p));
    if (hitBtn) {
      this.hudCandidate = { btn: hitBtn, x: p.x, y: p.y, time: now };
      hitBtn._armed = true; // visual feedback only
    } else {
      this.hudCandidate = null;
    }
    // a press on an accessory lying on the desk: hold still for about half a second and it can be dragged to a new place
    // (moving before that just pans the map as usual)
    this.accHold = null;
    if (!hitBtn && !this.photo && this.acc.items.length) {
      const w = this.cam.desk3d ? this.cam.toWorld3(p.x, p.y) : this.cam.toWorld(p.x, p.y), it = this.acc.hitTest(w.x, w.y, 10 / (this.cam.desk3d ? this.cam.scale3(w.x, w.y) : this.cam.zoom), p);
      if (it) this.accHold = { it, x: p.x, y: p.y, t0: now, active: false };
    }
    this.drag = this.dragFrom(p);
  }
  pointerMove(p) {
    if (this.cmdUI?.touchBoxSelect || this.cmdUI?.box) { this.cmdUI.pointerMove(p); return; }
    if (this.hud?.barMove?.(p)) return;
    if (!this.dialog && !this.opening && !this.replayView && this.aiTurnRunner.blocksInput) {
      if (this.aiTurnRunner.moveBannerDrag(p)) return;
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > 4) {
        d.moved = true; this.isDragging = true;
        this.aiTurnRunner.manualCamera();
      }
      if (d.moved && d.rig) { const w = this.cam.toWorldWith(d.rig, p.x, p.y); this.cam.dragTo(d.cx - (w.x - d.w0.x), d.cy - (w.y - d.w0.y)); }
      else if (d.moved) this.cam.dragTo(d.cx - (p.x - d.x) / this.cam.zoom, d.cy - (p.y - d.y) / this.cam.zoom);
      if (d.moved) this.aiTurnRunner.manualCamera();
      return;
    }
    if (this.touchPan) {
      const d = this.touchPan, w = d.rig && this.cam.toWorldWith(d.rig, p.x, p.y);
      if (Math.hypot(p.x - d.x, p.y - d.y) > 4) d.moved = true;
      if (d.moved) this.cam.dragTo(d.rig ? d.cx - (w.x - d.w0.x) : d.cx - (p.x - d.x) / this.cam.zoom,
        d.rig ? d.cy - (w.y - d.w0.y) : d.cy - (p.y - d.y) / this.cam.zoom);
      return;
    }
    if (this.hud?.tileInfo?.countryCard.pointerMove(p)) return;
    if (this.aiTurnRunner?.moveBannerDrag(p)) return;
    if (this.cmdUI?.pointerMove(p)) return;
    if(this.tilePortraitHold){const h=this.tilePortraitHold;if(Math.hypot(p.x-h.x,p.y-h.y)>12){clearTimeout(h.timer);this.tilePortraitHold=null;}return;}
    if(this.orderLinePress){
      const press=this.orderLinePress;
      if(press.endpoint&&Math.hypot(p.x-press.x,p.y-press.y)>4){this.orderLinePress=null;this.orderEndpointDrag=press;this.orderEndpointDrag.pointer=p;}
      return;
    }
    if(this.orderEndpointDrag){this.orderEndpointDrag.pointer=p;return;}
    if (this.orderDrawing) {
      if (this.orderStroke && Math.hypot(p.x-this.orderStroke.x,p.y-this.orderStroke.y)>4) this.addOrderPoint(p);
      return;
    }
    if (this.replayView) { this.replayView.pointerMove(p); return; }
    if (this.shopPanelPointer) { if (!this.panel.contains(p, this.sel)) this.panel.pressed = -1; return; }
    if (this.dialog) { if (this.dialog.move) this.dialog.move(p); return; }
    const h = this.accHold;
    if (h) {
      if (h.active) { const w = this.cam.desk3d ? this.cam.toWorld3(p.x, p.y) : this.cam.toWorld(p.x, p.y); this.acc.setPos(h.it, w.x - h.ox, w.y - h.oy); return; }   // carrying it
      if (Math.hypot(p.x - h.x, p.y - h.y) > 9) this.accHold = null;                                                                                   // moved before the long press: a map drag
    }
    const d = this.drag;
    if (!d) return;
    const dist = Math.hypot(p.x - d.x, p.y - d.y);
    if (dist > 4) {
      d.moved = true;
      this.isDragging = true;
      if (this.press) this.press.moved = true;
      this.hudCandidate = null; // Any movement immediately nullifies button click
      this.disarmHud();
    }
    if (d.moved && d.rig) { const w = this.cam.toWorldWith(d.rig, p.x, p.y); this.cam.dragTo(d.cx - (w.x - d.w0.x), d.cy - (w.y - d.w0.y)); }
    else if (d.moved) this.cam.dragTo(d.cx - (p.x - d.x) / this.cam.zoom, d.cy - (p.y - d.y) / this.cam.zoom);
  }
  pointerUp(p) {
    if (this.hud?.barUp?.(p)) return;
    if (!this.dialog && !this.opening && !this.replayView && this.aiTurnRunner.blocksInput) {
      if (this.aiTurnRunner.endBannerDrag()) { this.drag = null; return; }
      const moved = this.drag?.moved;
      this.drag = null; this.press = null; this.isDragging = false;
      if (moved) { this.lastDragEndTime = performance.now(); this.cam.release(); this.aiTurnRunner.manualCamera(); }
      else if (this.game.bridgeSpectating) this.clickWorld(p);
      return;
    }
    if (this.touchPan) { this.touchPan = null; this.cam.release(); return; }
    const countryCardDrop = this.hud?.tileInfo?.countryCard.pointerUp(p);
    if (countryCardDrop) {
      this.disarmHud(); this.press = null; this.drag = null; this.isDragging = false;
      if (countryCardDrop.moved) this.lastDragEndTime = performance.now();
      return;
    }
    if (this.aiTurnRunner?.endBannerDrag()) { this.press = null; this.drag = null; return; }
    if (this.cmdUI?.pointerUp(p)) { this.drag = null; this.press = null; return; }
    if(this.tilePortraitHold){const h=this.tilePortraitHold;clearTimeout(h.timer);this.tilePortraitHold=null;if(!h.long)this.portraitMenu.select(h.target.level,h.target.id);return;}
    if(this.orderLinePress){this.orderLinePress=null;return;}
    if(this.orderEndpointDrag){const drag=this.orderEndpointDrag;this.orderEndpointDrag=null;this.reviseOrderEndpoint(drag,p);return;}
    if (this.orderDrawing) {
      if (this.orderStroke) this.addOrderPoint(p);
      this.orderStroke=null;
      if (p.button === 2) this.orderDrawing=null;
      else {
        const id=this.orderDrawing?.points.at(-1)?.areaId, now=performance.now();
        if (id!=null && this.orderLastTap?.id===id && now-this.orderLastTap.at<350) this.finishOrderAxis();
        else if (id!=null && ['concentrate','withdraw'].includes(this.orderDrawing?.verb)) this.finishOrderAxis();
        this.orderLastTap={id,at:now};
      }
      return;
    }
    if (this.replayView) { this.replayView.pointerUp(p); return; }
    const pr = this.press; this.press = null;
    if (this.shopPanelPointer) { this.shopPanelPointer = false; this.panel.up(p, this.sel); return; }
    if (this.dialog) { this.disarmHud(); this.dialog.up(p); return; }
    if (this.accHold) {
      const h = this.accHold; this.accHold = null;
      if (h.active) {                                                   // dropped: remember where it is; this release is not a click
        this.drag = null; this.isDragging = false; this.acc.held = null; this.acc.save(); E.playSfx('pop.wav'); this.lastDragEndTime = performance.now();
        return;
      }
    }
    const d = this.drag; this.drag = null;
    const now = performance.now();
    if (!pr) { this.disarmHud(); this.isDragging = false; return; }   // no matching press (it was swallowed / belonged to a closed dialog): never a click
    const wasMoved = !!(this.isDragging || d?.moved || pr?.moved || (pr && Math.hypot(p.x - pr.x, p.y - pr.y) > 4));
    
    if (wasMoved) {
      this.lastDragEndTime = now;
      this.isDragging = false;
      this.disarmHud();
      if (this.opening) this.opening.up(p);
      if (d?.moved) this.cam.release();
      return; // Absolutely NEVER trigger HUD buttons or world click on drag release
    }
    this.isDragging = false;

    if (this.opening) { this.opening.up(p); return; }
    if (pr.legend) { this.disarmHud(); return; }
    if (this.photo) { this.photoTap(p); return; }                     // photo mode: a tap does nothing but count towards the taps that leave it
    if (this.panel.contains(p, this.sel) || this.panel.pressed !== -1) { this.panel.up(p, this.sel); return; }

    // HUD button click ONLY fires if candidate is valid, within 500ms, moved <= 4px, and still hits the button
    const cand = this.hudCandidate;
    this.hudCandidate = null;
    this.disarmHud();
    if (cand && (now - cand.time < 500)) {
      const movedFromStart = Math.hypot(p.x - cand.x, p.y - cand.y);
      if (movedFromStart <= 4 && cand.btn.enabled && cand.btn.visible && cand.btn.hit(p)) {
        cand.btn.click();
        return;
      }
    }

    this.clickWorld(p);
    if (p.pointerType === 'touch' && !this.orderDrawing && !this.dialog) {
      const now = performance.now(), last = this.touchWorldTap;
      if (last && now - last.time < 330 && Math.hypot(p.x-last.x,p.y-last.y) < 32) {
        const w = this.cam.toWorld(p.x,p.y); this.cam.x = w.x; this.cam.y = w.y; this.cam.clamp(); this.touchWorldTap = null;
      } else this.touchWorldTap = { x:p.x,y:p.y,time:now };
    }
  }
  wheel(dy) {
    this.replayView?.wake();
    if (this.dialog) { if (this.dialog.wheel) this.dialog.wheel(dy); return; }
    if (this.opening) return;
    this.aiTurnRunner?.manualCamera();
    this.cam.zoomAt(E.pointer.x, E.pointer.y, dy < 0 ? 1.12 : 1 / 1.12);
  }
  key(e) {
    if (!this.dialog && !this.opening && !this.replayView && this.aiTurnRunner?.blocksInput) {
      if (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter') this.aiTurnRunner.skip();
      else {
        const act = E.hotkeys.match(e);
        if (act === 'zoomIn' || act === 'zoomOut') this.zoomBy(act === 'zoomIn' ? 1.15 : 1 / 1.15);
        else {
          const s = 240 / this.cam.zoom;
          if (e.key === 'ArrowLeft') this.cam.x -= s;
          else if (e.key === 'ArrowRight') this.cam.x += s;
          else if (e.key === 'ArrowUp') this.cam.y -= s;
          else if (e.key === 'ArrowDown') this.cam.y += s;
          else return;
          this.aiTurnRunner.manualCamera(); this.cam.clamp();
        }
      }
      e.preventDefault(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      this.undoOrderOrDrawing();
      return;
    }
    if(e.key==='Escape'&&this.portraitMenu?.menu){this.portraitMenu.menu=null;e.preventDefault();return;}
    if(this.selectedOrderTarget && e.key==='Delete') {
      const {level,id}=this.selectedOrderTarget;
      this.game.apply({type:level==='army'?'setArmyOrder':'setTheaterOrder',country:this.game.player,groupId:id,theaterId:id,order:null});
      this.selectedOrderTarget=null;e.preventDefault();return;
    }
    if (this.orderDrawing) {
      if (e.key === 'Escape') { orderSketchBack(this.orderDrawing); if (this.orderDrawing.status === 'cancelled') this.orderDrawing=null; e.preventDefault(); return; }
      if (e.key === 'Backspace') { orderSketchBack(this.orderDrawing); e.preventDefault(); return; }
      if (e.key === 'Enter') { this.finishOrderAxis(); e.preventDefault(); return; }
    }
    if(this.multiplayerSpectator&&!this.dialog){if(e.key==='Escape')this.openPause();return;}
    if (!this.dialog && this.cmdUI?.key(e)) { e.preventDefault(); return; }
    if (this.replayView) { this.replayView.key(e); return; }
    if (this.dialog) { if (this.dialog.key) this.dialog.key(e); return; }
    if (this.opening) { this.opening.key(e); return; }
    const cam = this.cam; let act = E.hotkeys.match(e);      // the keys are user-configurable (Options > 快捷键)
    if (this.photo && act !== 'photo' && act !== 'zoomIn' && act !== 'zoomOut') act = null;   // in photo mode only the photo key (and the camera) work
    switch (act) {
      case 'zhengwu': if (!e.repeat) this.toggleZhengwu(); return;
      case 'formGroup': if (!e.repeat) this.openArmyGroups(); return;
      case 'photo': if (!e.repeat) this.setPhoto(!this.photo); return;
      case 'pause':                                           // Esc: cancel a card, else deselect, else the pause menu
        if (this.cardTarget != null) this.cancelCardMode(); else if (this.sel >= 0) this.select(-1); else this.openPause();
        return;
      case 'cardShop':
        // ignored right after a map drag: something on some machines sends a C keystroke ~50ms after a drag is released
        if (!e.repeat && performance.now() - (this.lastDragEndTime ?? -Infinity) > 1500) this.openShop();
        return;
      case 'toggle3d': if (!e.repeat) this.toggleMode(); return;
      case 'perfPanel': if (!e.repeat) this.showPerf = !this.showPerf; return;
      case 'endTurn': if (!e.repeat) this.endTurn(); return;
      case 'decorate': if (!e.repeat) this.openDecorate(); return;
      case 'save': if (!e.repeat) this.goSave(); return;
      case 'options': if (!e.repeat) this.goOptions(); return;
      case 'zoomIn': cam.zoomAt(E.W / 2, E.H / 2, 1.15); e.preventDefault(); cam.clamp(); return;
      case 'zoomOut': cam.zoomAt(E.W / 2, E.H / 2, 1 / 1.15); e.preventDefault(); cam.clamp(); return;
    }
    const s = 60 / cam.zoom * 4;
    if (e.key === 'ArrowLeft') cam.x -= s; else if (e.key === 'ArrowRight') cam.x += s; else if (e.key === 'ArrowUp') cam.y -= s; else if (e.key === 'ArrowDown') cam.y += s;
    else if (e.key === 'Escape') { this.select(-1); return; }
    else return;
    e.preventDefault(); cam.clamp();
  }
  pushOrderUndo(action) {
    if (!this.orderUndoStack) this.orderUndoStack = [];
    this.orderUndoStack.push(action);
    if (this.orderUndoStack.length > 30) this.orderUndoStack.shift();
  }
  undoOrderOrDrawing() {
    // 1. 如果正在画刷绘线中，优先撤回画刷节点
    if (this.orderDrawing) {
      import('./ui/order_sketch.js').then(({ orderSketchBack }) => {
        orderSketchBack(this.orderDrawing);
        if (this.orderDrawing.status === 'cancelled' || (!this.orderDrawing.points.length && !this.orderDrawing.axes.length)) {
          this.orderDrawing = null;
          this.orderStroke = null;
          this.cmdUI?.say('已取消画线');
        } else {
          this.cmdUI?.say('已撤回上一节点');
        }
        E.playSfx('pop.wav');
      }).catch(() => {
        if (this.orderDrawing.points?.length > 1) {
          this.orderDrawing.points.pop();
          this.cmdUI?.say('已撤回上一节点');
        } else {
          this.orderDrawing = null;
          this.orderStroke = null;
          this.cmdUI?.say('已取消画线');
        }
        E.playSfx('pop.wav');
      });
      return;
    }

    // 2. 如果不在画线中，撤回历史指令操作
    if (this.orderUndoStack && this.orderUndoStack.length > 0) {
      const act = this.orderUndoStack.pop();
      if (act.type === 'setOrder' || act.type === 'cancelOrder') {
        if (act.prevOrder) {
          this.game.apply({
            type: act.level === 'army' ? 'setArmyOrder' : 'setTheaterOrder',
            country: this.game.player,
            groupId: act.targetId,
            theaterId: act.targetId,
            order: act.prevOrder
          });
          if (act.prevStatus) {
            const entry = this.game.orders?.findLast(o => o.level === act.level && o.targetId === act.targetId);
            if (entry) entry.status = act.prevStatus;
          }
        } else {
          // 之前没有指令，撤回即清除新建的指令
          this.game.apply({
            type: act.level === 'army' ? 'setArmyOrder' : 'setTheaterOrder',
            country: this.game.player,
            groupId: act.targetId,
            theaterId: act.targetId,
            order: null
          });
        }
        this.cmdUI?.say('已撤回上一项指令');
      } else if (act.type === 'toggleExec') {
        const entry = this.game.orders?.findLast(o => o.level === act.level && o.targetId === act.targetId);
        if (entry) {
          entry.status = act.prevStatus;
          this.cmdUI?.say('已恢复指令执行状态');
        }
      } else if (act.type === 'assignTheater') {
        this.game.apply({
          type: 'assignArmyToTheater',
          country: this.game.player,
          groupId: act.groupId,
          theaterId: act.prevTheaterId
        });
        this.cmdUI?.say('已撤回战区编入变动');
      }
      E.playSfx('select.wav');
      return;
    }

    this.cmdUI?.say('无更多可撤回的操作');
  }
  startOrderDrawing({level,id,ids,verb}) {
    this.orderTarget={level,id,ids:ids?.length ? [...ids] : [id]};
    this.orderDrawing=createOrderSketch(verb);
    this.orderStroke=null;
    this.orderLastTap=null;
    this.orderHint='点击地图逐点绘制路线';
    this.orderInvalid=null;
  }
  addOrderPoint(p) {
    const w=this.cam.toWorld(p.x,p.y), areaId=World.areaAt(w.x,w.y);
    if (!this.game.stage.enabled.has(areaId) || this.game.stage.st(areaId)?.sea) { this.orderInvalid={x:p.x,y:p.y,at:performance.now()}; return; }
    this.orderInvalid=null;
    orderSketchPoint(this.orderDrawing,[w.x,w.y],areaId);
  }
  finishOrderAxis() {
    const sketch=this.orderDrawing;
    if (!sketch || !orderSketchFinishAxis(sketch)) return;
    const snap=points=>buildOrderPath(points.map(p=>p.point),this.game.stage.areas,{
      adjE:this.game.stage.adjE,hitTest:(x,y)=>World.areaAt(x,y),
      canPass:a=>this.game.stage.enabled.has(a.id),maxLength:sketch.verb==='defend'||sketch.verb==='screen'?60:40
    });
    try {
      const first=snap(sketch.axes[0]||sketch.points), second=sketch.axes.length?snap(sketch.points):null;
      if (!first.path.length || second&&!second.path.length) throw new Error('empty path');
      const line=['defend','screen'].includes(sketch.verb), path=first.path;
      const order={verb:sketch.verb,from:path[0],to:line?path:path.at(-1),risk:.5,priority:5,
        ...(line?{line:path,mustHold:path}: {path}),
        ...(second?{axes:[path,second.path]}:{}),
        draw:[...sketch.axes.flat(),...sketch.points].map(p=>p.point)};
      const target=this.orderTarget;
      this.orderDrawing=null; order.level=target.level;
      this.dialog=new OrderSettingsDialog(order, selected=>{
        const doApply=(finalOrder)=>{
          let appliedActions = 0;
          const waitingReasons = [];
          for (const id of target.ids) {
            const existing = this.game.orders?.findLast(o => o.level === target.level && o.targetId === id && !['cancelled','failed','achieved'].includes(o.status));
            const result=this.game.apply({type:target.level==='army'?'setArmyOrder':'setTheaterOrder',country:this.game.player,groupId:id,theaterId:id,order:structuredClone(finalOrder)});
            if (result.ok) {
              this.pushOrderUndo({
                type: 'setOrder', level: target.level, targetId: id,
                prevOrder: existing ? JSON.parse(JSON.stringify(existing.order)) : null,
                prevStatus: existing?.status
              });
              const execution = result.orderExecution;
              appliedActions += execution?.appliedCount || 0;
              if (!execution?.appliedCount) {
                const reason = execution?.report?.warnings?.[0];
                if (reason) waitingReasons.push(reason);
              }
            }
            else this.notice(result.reason);
          }
          this.dialog=null;
          if (appliedActions > 0) this.cmdUI?.say(`命令已执行 · ${appliedActions} 项单位行动`);
          else if (waitingReasons.length) this.cmdUI?.say(`命令已接收 · ${[...new Set(waitingReasons)].join('；')}`);
        };

        const isOffensive = ['attack', 'breakthrough', 'envelop'].includes(selected.verb);
        const goals = Array.isArray(selected.to) ? selected.to : [selected.to];
        let lowWinRate = false;
        let estimatedRate = 0.5;

        if (isOffensive && goals.length > 0) {
          const defenderArea = this.game.stage.st(goals[0]);
          const enemyHp = defenderArea?.armies?.reduce((sum, a) => sum + (a.hp || 100), 0) || 0;
          if (enemyHp > 0) {
            let ownAttackStrength = 0;
            for (const id of target.ids) {
              const group = target.level === 'army' ? this.game.armyGroups.find(g => g.id === id) : null;
              if (group) {
                for (const uid of group.unitIds || []) {
                  for (const a of this.game.stage.areas) {
                    const u = a.armies.find(x => x.id === uid);
                    if (u) ownAttackStrength += (u.hp || 50);
                  }
                }
              }
            }
            estimatedRate = ownAttackStrength / (ownAttackStrength + enemyHp * 3.5);
            if (estimatedRate < HIGH_RISK_WIN_RATE_THRESHOLD) {
              lowWinRate = true;
            }
          }
        }

        if (lowWinRate && !selected.confirmedHighRisk) {
          this.dialog = new HighRiskWarningDialog({
            order: selected,
            winRate: estimatedRate,
            onProceed: () => {
              selected.confirmedHighRisk = true;
              doApply(selected);
            },
            onCancel: () => {
              this.dialog = null;
            }
          });
        } else {
          doApply(selected);
        }
      },()=>{this.dialog=null;},(first.ignored.length+(second?.ignored.length||0))?('\u5df2\u5ffd\u7565 '+(first.ignored.length+(second?.ignored.length||0))+' \u4e2a\u65e0\u6cd5\u901a\u884c\u7684\u5730\u5757'):'');
    } catch (error) { this.orderHint=error.message; sketch.status='drawing'; }
  }
  focusedOrderEndpointHit(p) {
    const target=this.selectedOrderTarget;
    if(!target)return null;
    const center=id=>{const a=World.areas[id];return a?this.cam.toScreen(a.x+a.w/2,a.y+a.h/2):null;};
    const entries=(this.game.orders||[]).filter(entry=>entry.level===target.level&&entry.targetId===target.id&&!['cancelled','failed','achieved'].includes(entry.status));
    let best=null,distance=10;
    for(const entry of entries){
      const ids=entry.order.path||entry.order.line||entry.order.axes?.[0]||[];
      for(const [index,endpoint] of [[0,'first'],[ids.length-1,'last']]){
        const point=center(ids[index]);if(!point)continue;
        const d=Math.hypot(p.x-point.x,p.y-point.y);
        if(d<distance){best={entry,endpoint};distance=d;}
      }
    }
    return best;
  }
  startAlloutOrder({ level, id, ids }) {
    const targets = ids?.length ? ids : [id];
    const assignedIds = new Set(targets.flatMap(targetId => {
      if (level === 'country') return this.game.stage.areas.filter(a => a.country === this.game.player).flatMap(a => a.armies.map(u => u.id));
      const groups = level === 'army' ? this.game.armyGroups.filter(g => g.id === targetId)
        : this.game.armyGroups.filter(g => this.game.theatres.find(t => t.id === targetId)?.armyIds?.includes(g.id));
      return groups.flatMap(g => g.unitIds || []);
    }));
    const unitCount = this.game.stage.areas.filter(a => a.country === this.game.player)
      .flatMap(a => a.armies).filter(unit => assignedIds.has(unit.id)).length;
    this.dialog = new HighRiskWarningDialog({
      order: { verb: 'allout' }, allout: true, unitCount,
      onProceed: expires => {
        for (const targetId of targets) {
          const order = { verb: 'allout', risk: 1, priority: 9, ...(expires ? { expires } : {}) };
          const result = this.game.apply({ type: level === 'army' ? 'setArmyOrder' : level === 'theater' ? 'setTheaterOrder' : 'setCountryOrder',
            country: this.game.player, groupId: targetId, theaterId: targetId, order });
          if (!result.ok) this.notice(result.reason);
        }
        this.dialog = null;
      },
      onCancel: () => { this.dialog = null; }
    });
  }
  reviseOrderEndpoint(drag,p) {
    const w=this.cam.toWorld(p.x,p.y),id=World.areaAt(w.x,w.y),order=drag.entry.order,ids=order.path||order.line;
    if(!ids?.length||!this.game.stage.enabled.has(id)||this.game.stage.st(id)?.sea)return;
    const center=n=>{const a=World.areas[n];return[a.x+a.w/2,a.y+a.h/2];};
    const bridge=(a,b)=>buildOrderPath([center(a),center(b)],this.game.stage.areas,{adjE:this.game.stage.adjE,hitTest:(x,y)=>World.areaAt(x,y),canPass:a=>this.game.stage.enabled.has(a.id),maxLength:60}).path;
    try {
      let next;
      if(ids.length===1)next=[id];
      else if(drag.endpoint==='first')next=[...bridge(id,ids[1]),...ids.slice(2)];
      else next=[...ids.slice(0,-2),...bridge(ids.at(-2),id)];
      const line=!!order.line,updated={...order,from:next[0],to:line?next:next.at(-1),...(line?{line:next,mustHold:next}:{path:next}),draw:next.map(center)};
      const entry=drag.entry;
      this.pushOrderUndo({
        type: 'setOrder',
        level: drag.entry.level,
        targetId: drag.entry.targetId,
        prevOrder: JSON.parse(JSON.stringify(order))
      });
      const result=this.game.apply({type:entry.level==='army'?'setArmyOrder':'setTheaterOrder',country:this.game.player,groupId:entry.targetId,theaterId:entry.targetId,order:updated});
      if(!result.ok)this.notice(result.reason);
    }catch(error){this.notice(error.message);}
  }
  drawOrderLines(c, arrowsOnly = false) {
    const center=id=>{const a=World.areas[id];return a?this.cam.toScreen(a.x+a.w/2,a.y+a.h/2):null;};
    const splitStroke = (points, width, colors) => {
      if (points.length < 2) {
        c.strokeStyle = colors[0]; c.lineWidth = width;
        c.beginPath(); c.moveTo(points[0].x, points[0].y); c.lineTo(points[0].x + 0.01, points[0].y); c.stroke();
        return;
      }
      const normals = [];
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        const length = Math.hypot(dx, dy) || 1;
        normals.push({ x: -dy / length, y: dx / length });
      }
      const offsetPoint = (i, offset) => {
        const a = normals[Math.max(0, i - 1)], b = normals[Math.min(i, normals.length - 1)];
        const nx = a.x + b.x, ny = a.y + b.y, length = Math.hypot(nx, ny);
        const n = length > 0.01 ? { x: nx / length, y: ny / length } : b;
        const miter = Math.min(2, 1 / Math.max(0.5, n.x * b.x + n.y * b.y));
        return { x: points[i].x + n.x * offset * miter, y: points[i].y + n.y * offset * miter };
      };
      c.lineJoin = 'round'; c.lineCap = 'butt';
      colors.forEach((shade, lane) => {
        const offset = (colors.length - 1 - 2 * lane) * width / (2 * colors.length);
        c.strokeStyle = shade; c.lineWidth = width / colors.length + 0.35;
        c.beginPath();
        points.forEach((_, i) => { const p = offsetPoint(i, offset); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); });
        c.stroke();
      });
    };
    const paint = (ids, color, width = 10, { verb = '', label = '', moving = false, draw = null, groupColor = false, colors = [] } = {}) => {
      if (!ids?.length) return;
      const points = (draw?.length ? draw.map(p => this.cam.toScreen(p[0], p[1])) : ids.map(center)).filter(Boolean);
      if (!points.length) return;
      const anchor = draw?.length ? draw[0] : World.areas[ids[0]]?.pts[0];
      const visualScale = anchor ? Math.min(1, this.cam.scaleAt(anchor[0], anchor[1]) / 2.5) : 1;

      const isOffensive = ['attack', 'breakthrough', 'envelop', 'counterattack'].includes(verb);
      const isDefensive = ['defend', 'withdraw', 'screen', 'delay'].includes(verb);
      if (arrowsOnly && !isOffensive) return;
      const lineWidth = width * 1.1 * visualScale;
      const bodyWidth = isOffensive ? Math.max(width * 1.5, 18) * 1.1 * visualScale : lineWidth;
      const splitColors = colors.length > 1 ? colors : null;

      c.save();
      if (isOffensive) {
        const pFirst = points[0], pLast = points.at(-1);
        let grad = color;
        if (!splitColors) {
          grad = c.createLinearGradient(pFirst.x, pFirst.y, pLast.x, pLast.y);
          if (groupColor) {
            grad.addColorStop(0, color);
            grad.addColorStop(1, color);
          } else if (verb === 'breakthrough') {
            grad.addColorStop(0, 'rgba(152, 28, 38, 0.72)');
            grad.addColorStop(1, 'rgba(224, 46, 58, 0.92)');
          } else {
            grad.addColorStop(0, 'rgba(182, 48, 42, 0.70)');
            grad.addColorStop(1, 'rgba(235, 78, 68, 0.90)');
          }
        }
        if (!arrowsOnly) {
        // ---- 1. HOI4 风格宽体进攻箭头 ----
        // 底层深色粗描边
        c.strokeStyle = '#220806';
        c.fillStyle = color;
        c.lineWidth = bodyWidth + 5.5 * visualScale;
        c.lineJoin = 'round';
        c.lineCap = 'round';
        c.globalAlpha = 0.85;
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.stroke();

        // 中层半透明进攻渐变箭身
        if (splitColors) splitStroke(points, bodyWidth, splitColors);
        else {
          c.strokeStyle = grad;
          c.lineWidth = bodyWidth;
          c.beginPath();
          points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
          c.stroke();
        }

        // 核心动态向前推进的流动虚线导轨
        c.strokeStyle = moving ? '#fff4b8' : 'rgba(255, 255, 255, 0.75)';
        c.lineWidth = splitColors ? Math.max(1.2 * visualScale, bodyWidth * 0.08) : Math.max(1.75 * visualScale, bodyWidth * 0.24);
        c.setLineDash([14 * visualScale, 8 * visualScale]);
        c.lineDashOffset = -(performance.now() / (moving ? 45 : 110)) % (22 * visualScale);
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.stroke();
        c.setLineDash([]);
        }

        // 箭头末端：大倾角宽箭头矛头 (HOI4 Broad Arrowhead)
        if (points.length > 1) {
          const a = points.at(-2), b = points.at(-1);
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const drawHead = (tip, headSize, wingSpan, recess, fill) => {
            const leftX = tip.x - headSize * Math.cos(angle) - wingSpan * Math.sin(angle);
            const leftY = tip.y - headSize * Math.sin(angle) + wingSpan * Math.cos(angle);
            const innerLeftX = tip.x - (headSize - recess) * Math.cos(angle) - (bodyWidth * 0.45) * Math.sin(angle);
            const innerLeftY = tip.y - (headSize - recess) * Math.sin(angle) + (bodyWidth * 0.45) * Math.cos(angle);
            const innerRightX = tip.x - (headSize - recess) * Math.cos(angle) + (bodyWidth * 0.45) * Math.sin(angle);
            const innerRightY = tip.y - (headSize - recess) * Math.sin(angle) - (bodyWidth * 0.45) * Math.cos(angle);
            const rightX = tip.x - headSize * Math.cos(angle) + wingSpan * Math.sin(angle);
            const rightY = tip.y - headSize * Math.sin(angle) - wingSpan * Math.cos(angle);

            const head = new Path2D();
            head.moveTo(tip.x, tip.y);
            head.lineTo(leftX, leftY);
            head.lineTo(innerLeftX, innerLeftY);
            head.lineTo(innerRightX, innerRightY);
            head.lineTo(rightX, rightY);
            head.closePath();
            if (splitColors) {
              const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
              const extent = Math.max(wingSpan, bodyWidth) * 2, depth = headSize + extent;
              c.save(); c.clip(head);
              splitColors.forEach((shade, lane) => {
                const hi = extent - lane * 2 * extent / splitColors.length;
                const lo = extent - (lane + 1) * 2 * extent / splitColors.length;
                c.fillStyle = shade; c.beginPath();
                c.moveTo(tip.x - ux * depth + nx * hi, tip.y - uy * depth + ny * hi);
                c.lineTo(tip.x + ux * depth + nx * hi, tip.y + uy * depth + ny * hi);
                c.lineTo(tip.x + ux * depth + nx * lo, tip.y + uy * depth + ny * lo);
                c.lineTo(tip.x - ux * depth + nx * lo, tip.y - uy * depth + ny * lo);
                c.closePath(); c.fill();
              });
              c.restore();
            } else { c.fillStyle = fill; c.fill(head); }
            c.strokeStyle = '#220806';
            c.lineWidth = 1.25 * visualScale;
            c.stroke(head);
          };

          const hSize = 12 * visualScale + bodyWidth * 0.85;
          const wSpan = 9 * visualScale + bodyWidth * 0.75;
          const rRecess = 4.5 * visualScale + bodyWidth * 0.2;
          drawHead(b, hSize, wSpan, rRecess, grad);

          // 若为纵深突破 (breakthrough)，带有 HOI4 标志性的双层突击矛头
          if (verb === 'breakthrough') {
            const offset = 10 * visualScale + bodyWidth * 0.4;
            const q = { x: b.x - offset * Math.cos(angle), y: b.y - offset * Math.sin(angle) };
            drawHead(q, hSize * 0.85, wSpan * 0.82, rRecess * 0.8, groupColor ? color : '#f75c50');
          }
        }
      } else if (isDefensive) {
        // ---- 2. HOI4 风格防线与密集防御工事齿线 ----
        const lineColor = verb === 'withdraw' && !groupColor ? '#3ea868' : color;
        // 底层深色粗边
        c.strokeStyle = '#0b1624';
        c.lineWidth = lineWidth + 4.4 * visualScale;
        c.lineJoin = 'round';
        c.globalAlpha = 0.85;
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.stroke();

        // 防线主线
        if (verb === 'withdraw') c.setLineDash([12 * visualScale, 6 * visualScale]);
        if (splitColors) splitStroke(points, lineWidth, splitColors);
        else {
          c.strokeStyle = lineColor; c.lineWidth = lineWidth;
          c.beginPath();
          points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
          c.stroke();
        }
        c.setLineDash([]);

        // 沿线向外（敌方方向）密集分布的防御工事齿线 (fortification hatch ticks)
        c.save();
        c.strokeStyle = splitColors ? splitColors[0] : lineColor;
        c.lineWidth = 1.1 * visualScale;
        c.lineCap = 'square';
        for (let i = 1; i < points.length; i++) {
          const p1 = points[i - 1], p2 = points[i];
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          const segLen = Math.hypot(dx, dy);
          if (segLen < 4) continue;
          const nx = -dy / segLen, ny = dx / segLen; // 向外法向量
          const ux = dx / segLen, uy = dy / segLen;   // 切向向量
          const step = 14;
          const numTicks = Math.max(1, Math.floor(segLen / step));
          const tickLen = 5 * visualScale + lineWidth * 0.25;
          const barHalf = 1.75 * visualScale;

          for (let k = 0; k < numTicks; k++) {
            const t = (k + 0.5) / numTicks;
            const px = p1.x + dx * t, py = p1.y + dy * t;
            const tx = px + nx * tickLen, ty = py + ny * tickLen;

            // 绘制齿线
            c.beginPath();
            c.moveTo(px, py);
            c.lineTo(tx, ty);
            // 末端 T 形工事横杠
            c.moveTo(tx - ux * barHalf, ty - uy * barHalf);
            c.lineTo(tx + ux * barHalf, ty + uy * barHalf);
            c.stroke();
          }
        }
        c.restore();
      } else {
        // 其余战术（集中/配合等）标准绘制
        c.strokeStyle = '#302421';
        c.fillStyle = splitColors ? splitColors[0] : color;
        c.lineWidth = lineWidth + 4.4 * visualScale;
        c.lineJoin = 'round';
        c.globalAlpha = 0.8;
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        c.stroke();
        c.globalAlpha = 0.72;
        if (verb === 'support') c.setLineDash([11 * visualScale, 7 * visualScale]);
        else if (moving) {
          c.setLineDash([12 * visualScale, 6 * visualScale]);
          c.lineDashOffset = -(performance.now() / 90) % (18 * visualScale);
        }
        if (splitColors) splitStroke(points, lineWidth, splitColors);
        else {
          c.strokeStyle = color; c.lineWidth = lineWidth;
          c.beginPath();
          points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
          c.stroke();
        }
        c.setLineDash([]);

        if (verb === 'concentrate') {
          const b = points.at(-1);
          c.beginPath();
          c.arc(b.x, b.y, 4.5 * visualScale, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#fff';
          c.lineWidth = visualScale;
          c.beginPath();
          c.arc(b.x, b.y, 7 * visualScale, 0, Math.PI * 2);
          c.stroke();
        }
      }
      c.restore();

      if (label && !arrowsOnly) {
        const lx = points[0].x + 8, ly = points[0].y - 30;
        E.drawParchment(lx - 5, ly - 17, Math.max(100, label.length * 15 + 14), 27, { fill: '#ddc492' });
        E.text(label, lx, ly, { size: 16, color: '#302216', bold: true });
      }
    };
    const activeOrders = (this.game.orders || []).filter(entry => !['cancelled','failed','achieved'].includes(entry.status));
    const groupFor = entry => entry.level === 'army' ? this.game.armyGroups.find(g => g.id === entry.targetId) : null;
    const lineKey = entry => {
      const group = groupFor(entry), order = entry.order;
      return group ? JSON.stringify([group.country, order.verb, order.from, order.to, order.path, order.line, order.axes, order.draw, order.supportOrderId]) : null;
    };
    const sharedLines = new Map();
    for (const entry of activeOrders) {
      const key = lineKey(entry);
      if (key) { if (!sharedLines.has(key)) sharedLines.set(key, []); sharedLines.get(key).push(entry); }
    }
    const paintedLines = new Set();
    for (const entry of activeOrders) {
      const key = lineKey(entry);
      if (key && paintedLines.has(key)) continue;
      if (key) paintedLines.add(key);
      const peers = key ? sharedLines.get(key) : [entry];
      const order=entry.order;
      const palette={attack:'#c64d43',breakthrough:'#8d272f',envelop:'#b63c4e',counterattack:'#d77d3e',defend:'#3679c7',delay:'#d4a34b',concentrate:'#4487d8',screen:'#4980b5',withdraw:'#ddbf55',support:'#9a9a9a'};
      const group=groupFor(entry)||this.game.theatres.find(t=>t.id===entry.targetId);
      const isGroup=entry.level==='army', color=isGroup&&group?(group.color||getGroupColor(group,this.game,group.country)):palette[order.verb]||(entry.level==='theater'?'#4b81ce':'#6eac66');
      const colors = peers.map(peer => groupFor(peer)).filter(Boolean).map(g => g.color || getGroupColor(g, this.game, g.country));
      const selected = peers.some(peer => this.selectedOrderTarget?.level === peer.level && this.selectedOrderTarget?.id === peer.targetId);
      const moving = peers.some(peer => peer.status === 'progressing');
      paint(order.path||order.line||order.axes?.[0]||[],color,selected?14:10,{verb:order.verb,label:entry.level==='theater'?group?.name||'':'',moving,draw:order.axes?null:order.draw,groupColor:isGroup,colors});
      if (order.axes) for(const axis of order.axes.slice(1)) paint(axis,color,10,{verb:order.verb,moving,groupColor:isGroup,colors});
      if(!arrowsOnly&&selected){
        const ids=order.path||order.line||order.axes?.[0]||[];
        for(const id of [ids[0],ids.at(-1)]){const pt=center(id);if(!pt)continue;c.save();c.fillStyle='#f2e4bd';c.strokeStyle='#302720';c.lineWidth=2;c.beginPath();c.arc(pt.x,pt.y,7,0,Math.PI*2);c.fill();c.stroke();c.restore();}
      }
      if(!arrowsOnly&&order.verb==='support'&&order.supportOrderId){
        const target=this.game.orders.find(o=>o.id===order.supportOrderId),toId=target?.order?.to;
        const fromId=Array.isArray(order.from)?order.from[0]:order.from;
        const dest=Array.isArray(toId)?toId.at(-1):toId;
        const a=center(fromId),b=center(dest);
        if(a&&b){c.save();c.strokeStyle='#a0a0a0';c.lineWidth=1;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.restore();}
      }
      if(!arrowsOnly&&selected)for(const id of (order.path||order.line||[])){const pt=center(id);if(pt)E.text(String(id),pt.x,pt.y-24,{size:12,align:'center',color:'#f7e9c2',stroke:'#302720',strokeW:2});}
    }
    // [任务二] 移除选中集团军/战区时在各单位地块中心持续闪烁的细圆环指示（原为战区#6ca6f4/集团军#88cb7b的arc描边）
    if (this.orderDrawing) {
      const ids=this.orderDrawing.points.map(p=>p.areaId);
      const previewColors={attack:'#c64d43',breakthrough:'#8d272f',envelop:'#b63c4e',counterattack:'#d77d3e',defend:'#3679c7',delay:'#d4a34b',concentrate:'#4487d8',screen:'#4980b5',withdraw:'#ddbf55',support:'#9a9a9a'};
      const previewGroups=this.orderTarget?.level==='army'?(this.orderTarget.ids||[this.orderTarget.id]).map(id=>this.game.armyGroups.find(g=>g.id===id)).filter(Boolean):[];
      const previewGroup=previewGroups[0];
      const previewGroupColors=previewGroups.map(g=>g.color||getGroupColor(g,this.game,g.country));
      const previewColor=previewGroup?(previewGroup.color||getGroupColor(previewGroup,this.game,previewGroup.country)):previewColors[this.orderDrawing.verb]||'#cb473b';
      paint(ids,previewColor,12,{verb:this.orderDrawing.verb,groupColor:!!previewGroup,colors:previewGroupColors});
      for(const axis of this.orderDrawing.axes)paint(axis.map(p=>p.areaId),previewColor,10,{verb:this.orderDrawing.verb,groupColor:!!previewGroup,colors:previewGroupColors});
      if (!arrowsOnly) {
        let sequence=0;for(const id of [...this.orderDrawing.axes.flat(),...this.orderDrawing.points].map(p=>p.areaId)){const pt=center(id);if(pt){sequence++;E.text(String(sequence),pt.x,pt.y-8,{size:18,bold:true,align:'center',color:'#f9e9cb',stroke:'#392019',strokeW:3});}}
        if(this.orderInvalid&&performance.now()-this.orderInvalid.at<900){const p=this.orderInvalid;c.save();c.strokeStyle='#dd2e23';c.lineWidth=4;c.beginPath();c.moveTo(p.x-10,p.y-10);c.lineTo(p.x+10,p.y+10);c.moveTo(p.x+10,p.y-10);c.lineTo(p.x-10,p.y+10);c.stroke();c.restore();}
      }
    }
  }
  drawOrderHint(c) {
    if (!this.orderDrawing) return;
    const target = this.orderTarget;
    const subject = target.level === 'theater' ? this.game.theatres.find(t => t.id === target.id) : this.game.armyGroups.find(g => g.id === target.id);
    const verbNames = { attack: '进攻', breakthrough: '纵深突破', envelop: '合围', defend: '固守', withdraw: '撤退', concentrate: '集结', screen: '牵制', support: '配合', delay: '迟滞', counterattack: '反突击' };
    const w = Math.min(E.W - 32, 760), h = 58, x = (E.W - w) / 2, y = 12;
    c.save();
    c.fillStyle = 'rgba(25, 29, 27, 0.96)'; c.strokeStyle = '#777b68'; c.lineWidth = 2;
    c.beginPath(); c.roundRect(x, y, w, h, 3); c.fill(); c.stroke();
    c.fillStyle = '#a34a3f'; c.fillRect(x + 2, y + 2, 5, h - 4);
    c.strokeStyle = 'rgba(212, 204, 169, 0.28)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 16, y + 31); c.lineTo(x + w - 16, y + 31); c.stroke();
    E.text((subject?.name || '作战计划') + ' · ' + (verbNames[this.orderDrawing.verb] || '下令') + (this.orderHint ? '  ' + this.orderHint : ''),
      E.W / 2, y + 21, { size: 16, bold: true, align: 'center', color: '#e5dfc8' });
    E.text('左键逐点画路线   双击/Enter 完成   Backspace 撤销一点   右键/Esc 取消',
      E.W / 2, y + 47, { size: 13, align: 'center', color: '#b8bcaa' });
    c.restore();
  }
  clickWorld(p) {
    this.cmdUI?.clearSelection();
    const w = this.cam.toWorld(p.x, p.y);
    if (!this.cam.contains(w.x, w.y)) return;
    let id = this.units.hitTest(p);
    if (id < 0) id = World.areaAt(w.x, w.y);
    if (this.game.fogOfWar && !this.game.bridgeSpectating && id >= 0 && !rememberVisibility(this.game, this.game.player).now.has(id)) {
      const known = countryGameView(this.game, this.game.player).stage.st(id)?.country;
      this.select(-1);
      if (known && this.game.stage.enabled.has(id) && this.cardTarget == null) this.inspectArea = id;
      return; // Remembered territory can be inspected, never ordered into through this path.
    }
    if (id < 0 || !this.game.stage.enabled.has(id)) { this.select(-1); return; }
    if (this.replayView||this.multiplayerSpectator||this.game.bridgeSpectating) { this.select(id === this.sel ? -1 : id); return; }
    if (this.cardTarget != null) {
      if ([22, 23, 24].includes(this.cardTarget) && this.panel.area(id)) { this.select(id); return; }
      const card = this.game.findCard(this.cardTarget);
      const isPending = !!this.cardPending;
      const result = this.game.apply({ type: 'useCard', card, target: id, pendingPurchase: isPending });
      if (result.ok) {
        if (isPending) E.playSfx('buy.wav');
        else E.playSfx('select.wav');
        this.select(-1);
        if (!isPending && (this.game.hand[this.cardTarget] || 0) > 0 && !(this.game.cardCooldowns[this.cardTarget] || 0)) {
          this.enterCardMode(this.cardTarget, false);
        } else if (isPending && !this.game.whyNot(card) && this.cardTargetsFor(card.id, true).length > 0) {
          // 刚买的卡部署完后，只要还买得起且还有合法落点，就接着部署下一张(不必重新打开商店)；Esc/右键/取消按钮可随时退出
          this.enterCardMode(card.id, true);
        } else {
          this.cancelCardMode();
        }
      }
      else this.notice({ 'illegal-target': '这个地块不能使用该卡片。', 'out-of-range': '目标超出卡片范围。', cooldown: '该卡片仍在冷却中。', 'no-card': '没有可用的卡片。', money: '资金不足。', industry: '工业值不足。', tech: '科技等级不足。', 'not-implemented': '这张卡片的使用效果尚未接入。' }[result.reason] || '无法使用这张卡片。');
      return;
    }
    const kind = this.sel >= 0 && this.map.targets.get(id);            // clicking an arrow target = order the selected army
    if (kind) { this.order(kind, this.sel, id); return; }
    this.select(id === this.sel ? -1 : id);
    if (this.sel >= 0) E.playSfx('select.wav');
  }

  // Move (blue arrow) / attack (red arrow, or yellow rocket range) with the selected area's front army.
  order(kind, from, to) {
    const army = this.game.stage.st(from).armies[0];
    const r = this.game.apply({ type: kind === TARGET.MOVE ? 'move' : 'attack', from, to, armyId: army.id });
    if (!r.ok) { E.playSfx('cancel.wav'); return; }
    // Nothing stays selected after a unit has changed area - by a move, or by advancing into the area it just emptied.
    // An attacker that stayed where it was keeps its selection.
    this.select(kind === TARGET.MOVE || !this.game.stage.st(from).armies.includes(army) ? -1 : from);
  }
  endTurn() {
    if(this.multiplayerSpectator)return;
    if (this.options.multiplayerRoom) {
      if (this.game.activeCountry === this.game.player && !this.mpTurnEnding) this.sendMultiplayerCommand({ type: 'endTurn' });
      return;
    }
    if (this.aiTurnRunner?.running) return;
    this.autoBannerStep=0;
    this.game.executeAutoOrders(this.game.player);
    this.aiTurnRunner.start();
    this.select(this.sel);                                             // arrows depend on movement points
  }

  showResult(result) {
    this.opening = null;
    this.select(-1);
    this.dialog = new ResultDialog(this.ui1, result, {
      review: () => { this.dialog = null; },
      replay: () => { this.replayView = new ReplayControls(this); },
      quit: () => E.go('home'),
    });
  }

  // An ally's general protests (rules decided it; the text is 'commander complain <variant>'). Shown once the unit has arrived.
  async queueComplaint(ev) {
    const portraits = { [ev.commander]: await loadPortrait(ev.commander) };
    this.talks.push({ wait: this.units.moveTime + 0.1, lines: [{ who: ev.commander, text: E.strings['commander complain ' + ev.variant] || '' }], portraits });
  }
  async queueStageDialogue() {
    const lines = takeStageDialogue(this.game);
    if (!lines.length) return;
    const portraits = {};
    await Promise.all([...new Set(lines.map(line => line.who))].map(async who => { portraits[who] = await loadPortrait(who); }));
    this.talks.push({ wait: 0, lines, portraits });
  }
  updateTalks(dt) {
    const t = this.talks[0]; if (!t) return;
    t.wait -= dt;
    if (t.wait <= 0 && !this.dialog && !this.opening) { this.talks.shift(); this.dialog = new TalkDialog(t.lines, t.portraits, () => { this.dialog = null; }); E.playSfx('pop.wav'); }
  }

  // ---- frame ----
  // 进行中对局的本地自动存档(只在轮到玩家、没有 AI 在跑时保存，保证恢复后停在玩家回合)；未手动存档的对局最多保留 3 天
  liveTick() {
    const g = this.game; if (!g || this.options.multiplayerRoom || this.multiplayerSpectator || this.replayView) return;
    const now = performance.now(); if (now < (this.liveNextAt || 0)) return; this.liveNextAt = now + 2000;
    if (g.phase === 'finished') {
      if (!this.liveRemoved) { this.liveRemoved = true; LiveGames.remove(g.gameId); }
      // 对局结束：通知桥，agent 的 wait_turn 会立刻得到 gameOver 并可以发表感言
      if (this.bridgeEnabled && !this.bridgeOverSent) { this.bridgeOverSent = true; this.bridgeController?.request('gameover', { gameId: g.gameId, round: g.round, result: typeof g.result === 'object' && g.result ? JSON.stringify(g.result) : String(g.result || '') }).catch(() => { this.bridgeOverSent = false; }); }
      return;
    }
    const r = this.aiTurnRunner; if (r?.running || r?.playerRunning || g.activeCountry !== g.player) return;
    const sig = [g.round, g.activeCountry, g.gameLog?.length || 0, this.orderUndoStack?.length || 0].join('|');
    if (sig === this.liveSig) return; this.liveSig = sig;
    let snap; try { snap = g.snapshot(); } catch (e) { return; }
    let opts = {}; try { opts = JSON.parse(JSON.stringify(this.options || {})); } catch (e) {}
    LiveGames.put({ gameId: g.gameId, stageName: this.stageName, options: opts, snapshot: snap });
  }
  autosaveTick() {
    const g = this.game;
    if (this.leaving || !g || this.options.multiplayerRoom || this.multiplayerSpectator || this.replayView || g.phase === 'finished') return;
    const now = performance.now();
    this.autosaveNextAt ??= now + 60000;
    if (now < this.autosaveNextAt || this.autosavePending) return;
    // Restore only at a stable player turn, not halfway through an AI/bridge replay.
    const runner = this.aiTurnRunner;
    if (runner?.running || runner?.playerRunning || runner?.active || this.opening || g.activeCountry !== g.player) return;
    this.autosavePending = true;
    this.autosaveNextAt = now + 60000;
    SaveStore.writeAutosave(g).catch(error => {
      console.error('自动存档失败', error);
      this.autosaveNextAt = performance.now() + 10000;
    }).finally(() => { this.autosavePending = false; });
  }
  update(dt) {
    this.game.spectating = !!this.replayView || !!this.multiplayerSpectator;
    this.liveTick();
    this.autosaveTick();
    if (!this.leaving) Danmaku.keepAlive();   // 离开(dispose)后到新场景显示前，旧场景还会 update，这期间不能把弹幕放回来
    if (this.replayView) {
      this.cam.update(dt); this.dialog?.update?.(dt); this.replayView.update(dt);
      const playing = this.replayView.playing && !this.dialog && !this.replayView.scrubbing;
      const elapsed = playing ? dt * this.replayView.speed : 0;
      this.map.update(elapsed); this.effects.update(elapsed); this.units.update(elapsed); return;
    }
    this.fps = (this.fps || 30) * 0.92 + 0.08 / Math.max(dt, 1e-3);
    if (!this.cmdUI?.touchBoxSelect && !this.cmdUI?.box) this.cam.update(dt);
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt);
    this.updateMultiplayerTurnWarning();
    const h = this.accHold;                                                 // long press on an accessory: pick it up
    if (h && !h.active && !this.dialog && performance.now() - h.t0 >= 450) {
      const w = this.cam.desk3d ? this.cam.toWorld3(E.pointer.x, E.pointer.y) : this.cam.toWorld(E.pointer.x, E.pointer.y), q = this.acc.pos(h.it);
      h.active = true; h.ox = w.x - q.x; h.oy = w.y - q.y;
      this.drag = null; this.press = null; this.isDragging = false;          // no map drag while carrying it
      this.acc.held = h.it; this.acc.toFront(h.it); E.playSfx('select.wav');
    }
    this.acc.update(dt); if (this.dialog && this.dialog.update) this.dialog.update(dt);
    if (!this.leaving && !this.replayView && !this.options.multiplayerRoom && !this.dialog && !this.opening && !this.mpRoom?.paused) this.aiTurnRunner?.startBridgedPlayer();
    if (this.aiTurnRunner?.active && !this.mpRoom?.paused) {
      const tAi = performance.now();
      this.aiTurnRunner.update(dt);
      Perf.mark('aiTurn', performance.now() - tAi);
    }
    if (!this.dialog && this.game.scenarioEvents?.pending?.length > 0) {
      // 发给桥接(LLM)接管国的待决外交提议不弹给人类玩家，留给接管方在自己的回合处理
      const bridged = new Set(this.bridgeEnabled ? this.bridgeCountries : []);
      const topEv = this.game.scenarioEvents.pending.find(e => (!e.targetCountry || e.targetCountry === this.game.player) && !(e.targetCountry && bridged.has(e.targetCountry)));
      if (topEv && topEv.type === 'decision' && this.openDecision) {
        this.openDecision(topEv);
      } else if (topEv) {
        this.openWarNotice(topEv);
      }
    }
    const bridgePlaybackSpeed = this.aiTurnRunner?.bridgeTurn?.status === 'ready' ? 2 * this.aiTurnRunner.speedMultiplier : 1;
    this.map.update(dt); this.effects.update(dt * bridgePlaybackSpeed); this.units.update(dt * bridgePlaybackSpeed); this.updateTalks(dt);
  }
  draw() {
    const t0 = performance.now(); this.ms = this.ms || {};
    if (!this.dialog?.hideHud && !this.photo && !E.exp('nohud')) this.hud.tileInfo.prepare(this.inspectArea ?? this.sel);
    Perf.mark('hudPrepare', performance.now() - t0);
    const c = E.ctx, v = this.cam.view(), fogVisible = (this.game.fogOfWar && !this.game.bridgeSpectating) ? rememberVisibility(this.game, this.game.player).now : null;
    const visible = World.areas.filter(a => a.x < v.x1 && a.x + a.w > v.x0 && a.y < v.y1 && a.y + a.h > v.y0 && (!fogVisible || fogVisible.has(a.id)));
    const desk3d = this.cam.desk3d && this.l3d, flashing = this.blink > 0;
    const focusedAreas = this.cmdUI?.visible() ? this.cmdUI.focusedAreaIds() : new Set();
    const terrainSel = focusedAreas.size ? new Set([...focusedAreas, ...(this.sel >= 0 ? [this.sel] : [])]) : this.sel;
    if (desk3d) {
      // the desk and the map lying on it, in the standing player's perspective: the flat map is painted top-down into a texture (only when something changed)
      const m = this.map, st = this.game.stage;
      // The selected/flashing areas have a separate overlay. Do not rebuild and
      // upload the world-sized base texture on each selection change.
      m.zoneLayers();
      // the base map only changes with ownership / loaded images (NOT with the selection)
      const key = [m._layerKey, m.loads, E.state.desktopRatio, E.state.desktopTexture].join(',');
      const vis = flat => { const fv = flat.view(); return World.areas.filter(a => a.x < fv.x1 && a.x + a.w > fv.x0 && a.y < fv.y1 && a.y + a.h > fv.y0); };
      const box = id => { const a = World.areas[id]; return { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h }; };
      const union = (bs, pad) => ({ x0: Math.min(...bs.map(b => b.x0)) - pad, y0: Math.min(...bs.map(b => b.y0)) - pad, x1: Math.max(...bs.map(b => b.x1)) + pad, y1: Math.max(...bs.map(b => b.y1)) + pad });
      // the layers over the base, each on a small canvas covering only what it draws: the selection flash (painted once per selection, pulsing by
      // alpha) and the movement arrows / airport range (repainted while the arrow tip grows)
      let over = null;
       if ((flashing || this.sel >= 0 || focusedAreas.size) && !E.exp('noflash')) {
         const flashIds = terrainSel instanceof Set ? [...terrainSel] : this.sel >= 0 ? [this.sel] : [];
         over = { flash: { key: [flashIds.slice().sort((a,b)=>a-b).join(','), flashing, m._layerKey, m.loads].join(','), bounds: flashing ? null : union(flashIds.map(box), 30), alpha: m.flashAlpha(),
           paint: (g, flat) => this.map.drawTerrain(g, { sel: terrainSel, flashing, visible: [], cam: flat, desk: false, part: 'flash', flashAlpha: 1 }) } };
      }
      if (this.sel >= 0 && m.targets.size) {
        const bs = [box(this.sel), ...[...m.targets.keys()].map(box)], s0 = st.st(this.sel);
        if (s0 && s0.construction === 'airport') { const r = this.game.airstrikeRadius(E.state.medalLevels), p = World.areas[this.sel].pts[2]; bs.push({ x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r }); }
        over = over || {};
        over.arrows = { key: this.sel + '|' + m.targets.size + '|' + m.arrowT, bounds: union(bs, 80), paint: (g, flat) => this.map.drawTopGround(g, this.sel, flat) };
      }
      const tg = performance.now();
      this.l3d.renderGround(c, {
        base: (g, flat) => this.map.drawTerrain(g, { sel: this.sel, flashing, visible: vis(flat), cam: flat, desk: false, part: 'base' }),
      }, key, over);
      this.ms.ground = performance.now() - tg; Perf.mark('ground', this.ms.ground); const ta = performance.now();
      if (!E.exp('nomarshal')) for (const L of this.leaders) drawLeader(c, this.cam, this.acc.desk(), L);
      if (!E.exp('noacc')) this.acc.drawWarped(c);
      this.ms.acc = performance.now() - ta; Perf.mark('acc', this.ms.acc);
    } else {
      const tg = performance.now();
      this.map.drawTerrain(c, { sel: terrainSel, flashing, visible });
      Perf.mark('ground', performance.now() - tg);
      const ta = performance.now(); this.acc.draw(c);
      Perf.mark('acc', performance.now() - ta);
    }
    const tu = performance.now();
    if (this.hud && this.hud.layoutButtons) {
      this.hud.layoutButtons();
      this.units.setHudOccluders(this.replayView?.hudAlpha === 0 ? [] : [...this.hud.cornerRects(), ...(this.cmdUI ? this.cmdUI.occluders() : [])]);
    }
    const to = performance.now(); this.drawOrderLines(c); Perf.mark('orderLines', performance.now() - to);
    this.units.selectedUnitIds = this.cmdUI?.visible() ? this.cmdUI.glowingUnits() : null;
    const tUnits = performance.now(); if (!E.exp('nounits')) this.units.draw(visible); Perf.mark('unitSprites', performance.now() - tUnits);
    const tMapUi = performance.now();
    this.drawOrderLines(c, true);                                                // offensive arrowheads stay above unit models
    this.cmdUI?.drawMap(c);                                                       // army-group banners and the Shift+drag box
    Perf.mark('mapUI', performance.now() - tMapUi);
    this.ms.units = performance.now() - tu; Perf.mark('units', this.ms.units);
    const tHud = performance.now();
    if (desk3d) { if (!E.exp('notop')) this.map.drawTopScreen(c); } else this.map.drawTop(c, this.sel);
    if (!E.exp('noeffects')) this.effects.draw(c, !this.replayView);
    if (!this.dialog?.hideHud && !this.photo && !E.exp('nohud')) {
      if (!this.replayView) this.panel.draw(this.sel);
      c.save(); c.globalAlpha *= this.replayView?.hudAlpha ?? 1;
      if (c.globalAlpha > 0) { const tileArea = this.inspectArea ?? this.sel; this.hud.draw(c, tileArea, true); this.cmdUI?.draw(c); this.hud.drawTileInfo(tileArea); }   // 地块信息面板始终盖在战区指挥部之上
      c.restore();
      // no hover hint: a country's relation / diplomacy is shown only for the SELECTED unit or area (user request)
    }
    if (this.opening) this.opening.draw(c, this.game.labels);
    if (this.replayView) this.replayView.draw(c);
    if (this.portraitMenu?.menu && !this.dialog) { this.portraitMenu.hits=[]; this.portraitMenu.drawMenu(this.portraitMenu.menu,{scale:1}); }
    if (this.dialog) this.dialog.draw();
    else if (this.shopPreview) this.shopPreview.draw();
    if (this.dialog instanceof CardShop && !this.replayView) this.panel.draw(this.sel);
    if (!this.dialog && !this.opening && !this.photo && this.aiTurnRunner?.active) this.aiTurnRunner.draw(c);
    if (this.game.bridgeSpectating && !this.photo) E.text('Agent 对战 · 全局观战', E.W / 2, E.H - 24, { size: 20, color: '#f4ecd6', stroke: '#2a1d12', strokeW: 4, align: 'center' });
    if (!this.dialog && !this.photo) this.drawOrderHint(c);                        // draw above units, effects and the HUD
    Perf.mark('hudEffects', performance.now() - tHud);
    this.ms.total = performance.now() - t0; Perf.mark('battleDraw', this.ms.total);
    if (this.showPerf && !this.photo) this.drawPerf(c);
    if (this.photo && performance.now() < this.photoHintUntil) {                                 // a brief reminder on entering, then nothing
      const a = Math.min(1, (this.photoHintUntil - performance.now()) / 700);
      c.save(); c.globalAlpha = a; E.text('摄影模式：四击屏幕' + (E.hotkeys.of('photo') ? ' 或按 ' + E.hotkeys.pretty(E.hotkeys.of('photo')) : '') + ' 退出', E.W / 2, E.H - 60, { size: 26, bold: true, color: '#fff', stroke: 'rgba(0,0,0,.75)', strokeW: 6, align: 'center' }); c.restore();
    }
  }
  // A live tuning panel (a plain DOM overlay) for the marshal's fit: drag the sliders in a real battle, read off the numbers, tell me to fix them.
  marshalTuner() {
    if (document.getElementById('marshalTuner')) return;
    const T = E.marshalTune || (E.marshalTune = { ...LEADER });
    if (this.want3d && !this.cam.desk3d) this.toggleMode();                                // the marshal only shows in 3D
    const CT = E.camTune || (E.camTune = { pitch: null });
    if (CT.pitch == null) CT.pitch = Math.round(this.cam.pitch() * 180 / Math.PI);          // start the pitch slider at the current angle
    const box = document.createElement('div'); box.id = 'marshalTuner';
    box.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99999;background:rgba(20,16,10,.9);color:#f0e7d4;font:13px/1.5 "Microsoft YaHei",sans-serif;padding:12px 14px;border:1px solid #b8935a;border-radius:10px;width:260px;user-select:none;max-height:92vh;overflow:auto';
    // key: which tune object it writes to ('M' = marshal, 'C' = camera), field, label, min, max, step
    const rows = [
      ['C', 'pitch', '3D 俯角（度）', 15, 75, 1],
      ['M', 'topMM', '领袖头顶离桌面高度（毫米，真实尺寸）', 400, 900, 5],
      ['M', 'inMM', '对面座位：身体截面在桌沿内多少（毫米）', 0, 300, 5],
      ['M', 'sideMM', '左右座位：手伸进桌沿多少（毫米）', 0, 400, 5],
      ['M', 'dxMM', '对面座位：左右偏移（毫米）', -400, 400, 5],
      ['M', 'sideAt', '左右座位：沿桌边位置（0=远端 1=近端）', 0, 1, 0.01],
    ];
    box.innerHTML = '<div style="font-weight:700;margin-bottom:8px">元帅 / 视角调试（物理尺寸）</div>';
    const out = document.createElement('div'); out.style.cssText = 'font-family:Consolas,monospace;background:#000;color:#8fd;padding:6px 8px;border-radius:6px;margin-top:8px;word-break:break-all';
    const sync = () => { out.textContent = `pitch=${CT.pitch} | topMM=${T.topMM} inMM=${T.inMM} sideMM=${T.sideMM} sideAt=${T.sideAt} dxMM=${T.dxMM}`; };
    for (const [obj, key, label, min, max, step] of rows) {
      const O = obj === 'C' ? CT : T;
      const row = document.createElement('label'); row.style.cssText = 'display:block;margin:6px 0';
      const cap = document.createElement('div'); cap.textContent = label;
      const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = O[key]; r.style.width = '100%';
      r.oninput = () => { O[key] = +r.value; sync(); };
      row.append(cap, r); box.append(row);
    }
    const reset = document.createElement('button'); reset.textContent = '俯角恢复默认 39°'; reset.style.cssText = 'margin-top:6px;width:100%;padding:5px;background:#5a4a2a;border:0;border-radius:6px;color:#f0e7d4;cursor:pointer';
    reset.onclick = () => { CT.pitch = null; box.remove(); this.marshalTuner(); };
    box.append(reset);
    const hint = document.createElement('div'); hint.style.cssText = 'margin-top:8px;color:#b6a888;font-size:12px'; hint.textContent = '拖动找到最佳位置，把下面这行数值发给我：';
    const btn = document.createElement('button'); btn.textContent = '复制数值'; btn.style.cssText = 'margin-top:8px;width:100%;padding:6px;background:#b8935a;border:0;border-radius:6px;color:#fff;font-weight:700;cursor:pointer';
    btn.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(out.textContent); btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = '复制数值', 1200); };
    box.append(hint, out, btn); sync(); document.body.append(box);
  }
  // performance panel (P): frame rate, JS time per part of the draw (canvas work is queued, so it can hide GPU cost), 3D layer activity
  drawPerf(c) {
    const L = this.l3d, m = this.ms, r = L && L.region, n = x => (x || 0).toFixed(1);
    const rep = L ? L.repaints || 0 : 0, gl = L ? L.glRenders || 0 : 0, now = performance.now();
    if (!this._pf || now - this._pf.t > 1000) { const p = this._pf; this._pf = { t: now, rep, gl, repS: p ? (rep - p.rep) * 1000 / (now - p.t) : 0, glS: p ? (gl - p.gl) * 1000 / (now - p.t) : 0 }; }
    const lines = [`FPS ${this.fps.toFixed(0)}   screen ${E.cv.width}x${E.cv.height}  ${this.cam.desk3d ? '3D' : 'flat'}`,
      `draw JS ${n(m.total)} ms: ground ${n(m.ground)}  acc ${n(m.acc)}  units ${n(m.units)}`,
      L ? `map repaints ${this._pf.repS.toFixed(1)}/s  GL renders ${this._pf.glS.toFixed(1)}/s  texture ${r ? r.cw + 'x' + r.ch : '-'}  ppu ${r ? r.ppu.toFixed(2) : '-'}` : '3D layer off',
      L ? 'GPU: ' + L.glInfo() : '',
      (() => { const st = Perf.stats(), sl = Perf.slow[Perf.slow.length - 1]; return `frame p50 ${st.p50} / p95 ${st.p95} / max ${st.max} ms` + (sl ? `   last slow: ${sl.interval}ms = JS ${sl.js} + other ${sl.otherWait}  (events ${sl.events})` : ''); })()].filter(Boolean);
    c.save(); c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(8, 96, 700, lines.length * 24 + 12);
    lines.forEach((l, i) => E.text(l, 18, 114 + i * 24, { size: 17, color: '#9ff59f' })); c.restore();
  }
}
