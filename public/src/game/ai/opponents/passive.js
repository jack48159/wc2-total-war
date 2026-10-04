import { Controller } from '../../controller_base.js';

export class PassiveAi extends Controller {
  commandsForTurn(game, country, blocked = new Set()) {
    return [];
  }
}
