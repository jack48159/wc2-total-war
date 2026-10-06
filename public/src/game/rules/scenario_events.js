import { sandboxAction } from '../sandbox_actions.js';
import { isSandbox } from '../sandbox_policy.js';
// Port of formwork's Scenario Events system (scenario_events/ Notices.cpp, Execution.cpp, Actions.cpp, Conditions.cpp)
// Handles event notices and branching decisions.

import { register } from '../commands.js';
import { evaluateSandboxCondition } from '../sandbox_conditions.js';
import { EV } from '../events.js';

export function initScenarioEvents(config = null) {
  return {
    definitions: Array.isArray(config?.definitions) ? JSON.parse(JSON.stringify(config.definitions)) : [],
    history: Array.isArray(config?.history) ? [...config.history] : [],
    variables: { ...(config?.variables || {}) },
    scheduled: structuredClone(config?.scheduled||[]),
    occurrences: { ...(config?.occurrences || {}) },
    pending: Array.isArray(config?.pending) ? JSON.parse(JSON.stringify(config.pending)) : [],
  };
}

export function evaluateCondition(game, cond) {
  if (!cond) return true;
  if(Array.isArray(cond.areas)){const values=cond.areas.map(area=>evaluateCondition(game,{...cond,area,areas:undefined}));return values.length>0&&(cond.areaMatch==='any'?values.some(Boolean):values.every(Boolean));}
  const sandboxResult = evaluateSandboxCondition(game, cond);
  if (sandboxResult !== null) return sandboxResult;
  if (cond.type === 'any' && Array.isArray(cond.conditions)) {
    return cond.conditions.some(c => evaluateCondition(game, c));
  }
  if (cond.type === 'all' && Array.isArray(cond.conditions)) {
    return cond.conditions.every(c => evaluateCondition(game, c));
  }
  if (cond.type === 'round') {
    const r = game.round;
    const target = cond.value;
    const op = cond.op || 'eq';
    if (op === 'eq') return r === target;
    if (op === 'gte') return r >= target;
    if (op === 'lte') return r <= target;
    if (op === 'gt') return r > target;
    if (op === 'lt') return r < target;
  }
  if (cond.type === 'variable') {
    const val = game.scenarioEvents?.variables[cond.key];
    const op = cond.op || 'eq';
    if (op === 'eq') return val === cond.value;
    if (op === 'ne') return val !== cond.value;
  }
  if (cond.type === 'areaOwner') {
    const area = game.stage.st(cond.area);
    return area && (area.transitOwner||area.country) === cond.country;
  }
  if (cond.type === 'areaOwnerNot') {
    const area = game.stage.st(cond.area);
    return area && (area.transitOwner||area.country) !== cond.country;
  }
  if (cond.type === 'areaOwnerIn') {
    const area = game.stage.st(cond.area);
    return area && Array.isArray(cond.countries) && cond.countries.includes(area.transitOwner||area.country);
  }
  if (cond.type === 'areaOwnerAlliedWith') {
    const area = game.stage.st(cond.area);
    if (!area || !area.country) return false;
    return (area.transitOwner||area.country) === cond.country || game.areDiplomaticAllies(area.transitOwner||area.country, cond.country);
  }
  if (cond.type === 'countryDefeated') {
    const c = game.stage.countries.get(cond.country);
    if(c?.dormant&&!game.sandboxState?.activated?.[cond.country])return false;
    if (!c || c.eliminated) return true;
    if (isSandbox(game) && game.stage.data.sandboxFeatures?.countryDefeats?.[cond.country]?.enabled) return false;
    const lands = game.stage.areas.filter(a => (a.transitOwner||a.country) === cond.country && !a.sea).length;
    return lands === 0;
  }
  if (cond.type === 'diplomaticRelation') {
    const rel = game.getDiplomaticRelation(cond.first, cond.second);
    const targetState = typeof cond.state === 'number' ? cond.state : (cond.state === 'war' ? 1 : cond.state === 'peace' ? 2 : 3);
    return rel === targetState;
  }
  if (cond.type === 'stabilityBelow') {
    if (isSandbox(game)) return false;
    const country = cond.country || game.player;
    const stab = game.getStability ? game.getStability(country) : 100;
    return stab < (cond.value ?? 30);
  }
  if (cond.type === 'capitalLost') {
    const fallen = game.diplomacy?.capitalFallen?.[cond.country];
    return !!fallen;
  }
  if (cond.type === 'hasPact') {
    const pact = game.diplomacy?.pacts?.[ [cond.first, cond.second].sort().join('_') ];
    return !!(pact && (!cond.pact || pact.type === cond.pact));
  }
  if (cond.type === 'atWar') {
    const st = game.stage;
    for (const other of st.countries.values()) {
      if (!other || other.id === cond.country || other.eliminated) continue;
      if (game.getDiplomaticRelation(cond.country, other.id) === 1) return true;
    }
    return false;
  }
  return true;
}

export function evaluateEvents(game, triggerType = 'roundBegin') {
  if(game._evaluatingScenarioEvents)return [];
  game._evaluatingScenarioEvents=true;
  try{return evaluateEventsPass(game,triggerType);}finally{game._evaluatingScenarioEvents=false;}
}
function evaluateEventsPass(game, triggerType = 'roundBegin') {
  if(triggerType==='roundBegin'&&game.scenarioEvents?.scheduled){const due=game.scenarioEvents.scheduled.filter(e=>e.round<=game.round);game.scenarioEvents.scheduled=game.scenarioEvents.scheduled.filter(e=>e.round>game.round);for(const e of due)for(const action of e.actions)applyAction(game,action);}
  const se = game.scenarioEvents;
  if (!se || !se.definitions || !se.definitions.length) return [];

  const newlyTriggered = [];
  for (const def of se.definitions) {
    if (se.history.includes(def.id) && !def.repeatable) continue;
    if (def.trigger && def.trigger !== triggerType && (!Array.isArray(def.trigger) || !def.trigger.includes(triggerType))) continue;

    let match = true;
    if (def.conditions && Array.isArray(def.conditions)) {
      for (const cond of def.conditions) {
        if (!evaluateCondition(game, cond)) {
          match = false;
          break;
        }
      }
    }
    if (match) {
      if (def.silent || def.type === 'report') {
        if (!se.history.includes(def.id)) {
          se.history.push(def.id);
        }
        if (def.actions && Array.isArray(def.actions)) {
          for (const act of def.actions) {
            applyAction(game, act);
          }
        }
        newlyTriggered.push(def);
        game.emit(EV.SCENARIO_EVENT, {
          event: def,
          phase: 'resolved',
          decision: null,
        });
      } else {
        // Add to pending queue if not already pending
        if (!se.pending.some(p => p.id === def.id)) {
          se.pending.push(JSON.parse(JSON.stringify(def)));
          newlyTriggered.push(def);
          game.emit(EV.SCENARIO_EVENT, {
            event: def,
            phase: 'triggered',
          });
        }
      }
    }
  }
  return newlyTriggered;
}

export function applyAction(game, action) {
  if(Array.isArray(action.areas)){for(const area of action.areas)applyAction(game,{...action,area,areas:undefined});return;}
  if (!action) return;
  const st = game.stage;
  if(sandboxAction(game,action))return;

  if (action.type === 'changeMoney') {
    const targetCountry = action.country || game.player;
    if (targetCountry === game.player) {
      game.money = Math.max(0, game.money + (action.amount || 0));
    } else {
      const c = st.countries.get(targetCountry);
      if (c) c.money = Math.max(0, (c.money || 0) + (action.amount || 0));
    }
  } else if (action.type === 'changeIndustry') {
    const targetCountry = action.country || game.player;
    if (targetCountry === game.player) {
      game.industry = Math.max(0, game.industry + (action.amount || 0));
    } else {
      const c = st.countries.get(targetCountry);
      if (c) c.industry = Math.max(0, (c.industry || 0) + (action.amount || 0));
    }
  } else if (action.type === 'spawnArmy') {
    const area = st.st(action.area);
    if (area && action.armyType && area.country===(action.country||area.country) && area.armies.length<st.maxArmies(area) && ['destroyer','cruiser','battleship','aircraftcarrier'].includes(action.armyType)===!!area.sea) {
      const army = game.spawnArmy(area, action.armyType, action.templateId);
      if (action.level) {army.level = action.level;army.hp=army.maxHp=Math.round(army.maxHp*(1+.15*action.level));}
      if (action.morale) army.morale = action.morale;
      army.active = false;
      game.emit(EV.UNIT_DEPLOYED, {
        area: area.id,
        armyId: army.id,
        armyType: army.type,
        country: area.country,
      });
    }
  } else if (action.type === 'captureArea') {
    const area = st.st(action.area);
    if (area && action.country && (area.transitOwner||area.country) !== action.country) {
      const prev = area.transitOwner||area.country;
      delete area.transitOwner;delete area.transitCountry;
      area.country = action.country;
      game.emit(EV.AREA_CAPTURED, { area: area.id, from: prev, to: action.country, cause: 'eventAction' });
    }
  } else if (action.type === 'setVariable') {
    if (action.key) {
      game.scenarioEvents.variables[action.key] = action.value;
    }
  } else if (action.type === 'setDiplomacy') {
    if (action.first && action.second && action.state) {
      game.setDiplomaticRelation(action.first, action.second, action.state, action.reason || 'event_action');
    }
  } else if (action.type === 'changeStability') {
    const targetCountry = action.country || game.player;
    if (game.changeStability) game.changeStability(targetCountry, action.amount || 0, action.reason || 'event_action');
  } else if (action.type === 'setPact') {
    if (action.first && action.second && game.proposeDiplomacy) {
      game.proposeDiplomacy(action.first, action.second, action.pact || 'nap', action.reason || 'event_action');
    }
  } else if (action.type === 'respondWarInvitation' || action.type === 'respondCoalitionPeace') {
    game.apply(action);
  } else if (action.type === 'rejectPeaceOffer') {
    // 拒绝是被提议方(second)的表态，归属到它名下(否则会被记成人类玩家的命令，桥接提交校验会判越权)
    game.apply({ country: action.second, ...action });
  }
}

// Command: resolve pure notice event
register('resolveEventNotice', {
  validate(game, cmd) {
    const pIdx = game.scenarioEvents?.pending?.findIndex(p => p.id === cmd.eventId);
    if (pIdx == null || pIdx < 0) return 'event-not-pending';
    return null;
  },
  execute(game, cmd) {
    const se = game.scenarioEvents;
    const pIdx = se.pending.findIndex(p => p.id === cmd.eventId);
    const event = se.pending.splice(pIdx, 1)[0];
    if (!se.history.includes(event.id)) {
      se.history.push(event.id);
    }
    // Execute actions
    const prev = game._inScenarioEvent;
    game._inScenarioEvent = true;
    try {
      if (event.actions && Array.isArray(event.actions)) {
        for (const act of event.actions) {
          applyAction(game, act);
        }
      }
    } finally {
      game._inScenarioEvent = prev;
    }
    game.emit(EV.SCENARIO_EVENT, {
      event,
      phase: 'resolved',
      decision: null,
    });
  },
});

// Command: resolve branching decision event
register('resolveEventDecision', {
  validate(game, cmd) {
    const se = game.scenarioEvents;
    const ev = se?.pending?.find(p => p.id === cmd.eventId);
    if (!ev) return 'event-not-pending';
    if (ev.targetCountry && ev.targetCountry !== (cmd.country || game.activeCountry)) return 'not-event-recipient';
    if (!ev.choices || !ev.choices.some(c => c.id === cmd.choiceId)) return 'invalid-choice';
    return null;
  },
  execute(game, cmd) {
    const se = game.scenarioEvents;
    const pIdx = se.pending.findIndex(p => p.id === cmd.eventId);
    const event = se.pending.splice(pIdx, 1)[0];
    const choice = event.choices.find(c => c.id === cmd.choiceId);

    if (!se.history.includes(event.id)) {
      se.history.push(event.id);
    }
    se.variables['decision_' + event.id] = choice.id;

    // Apply choice actions
    const prev = game._inScenarioEvent;
    game._inScenarioEvent = true;
    try {
      if (choice.actions && Array.isArray(choice.actions)) {
        for (const act of choice.actions) {
          applyAction(game, act);
          if (choice.id === 'accept' && act.type === 'setDiplomacy' && act.reason === 'player_accepted_offer') {
            game.emit(EV.DIPLOMACY_OFFER_RESOLVED, {
              first: act.first, second: act.second, action: act.state, accepted: true, reason: act.reason,
            });
          }
        }
      }
    } finally {
      game._inScenarioEvent = prev;
    }

    game.emit(EV.SCENARIO_EVENT, {
      event,
      phase: 'resolved',
      decision: choice.id,
      choiceText: choice.text,
    });
  },
});
