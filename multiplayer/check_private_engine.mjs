import { gameModule } from './runtime.mjs';

if (!gameModule('game.js').includes('/multiplayer/engine/')) {
  throw new Error('Server is still using the public frontend tree');
}
const { Game } = await import(gameModule('game.js'));
const game = await Game.create('battle_axis1', null, { player: 'de2', logEnabled: false });
if (game.player !== 'de2' || !game.stage.areas.length) {
  throw new Error('Private game data did not load');
}
console.log(`Private rule engine loaded ${game.stage.areas.length} areas`);
