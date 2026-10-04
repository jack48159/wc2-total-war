// Import every rule module here so that their commands get registered.
import './economy.js';      // buyCard
import './movement.js';     // move     (native default entry cost is 1 point)
import './combat.js';       // attack   (outcome from combatModel.js)
import './turn.js';         // endTurn  (country queue, income, recovery)
import './cardEffects.js';
import './diplomacy.js';    // diplomacy system port
import './scenario_events.js'; // war events & decisions
// victory.js is called after state-changing commands by Game.apply.
